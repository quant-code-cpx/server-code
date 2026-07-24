import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Logger, Optional } from '@nestjs/common'
import { WsException } from '@nestjs/websockets'
import { UserRole } from '@prisma/client'
import { Server, Socket } from 'socket.io'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import type { QualityCheckSummary } from 'src/tushare/sync/quality/data-quality.service'
import type { RepairSummary } from 'src/tushare/sync/quality/auto-repair.service'
import { SocketIoRedisPublisher } from './socket-io-redis.publisher'

/** 管理员专属 WebSocket 房间（ADMIN + SUPER_ADMIN 均可加入） */
const ADMIN_ROOM = 'role:admin'
const MAX_BACKTEST_JOB_ID_LENGTH = 128

interface SocketIdentity {
  userId: number
  role: UserRole
  authenticatedAt: number
  tokenExpiresAt: number
  expiresTimer?: NodeJS.Timeout
}

type AuthenticatedSocket = Socket & { data: { identity?: SocketIdentity } }

export function isWebSocketOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true
  if (!origin) return false
  const allowedOrigins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowedOrigins.includes(origin)
}

/**
 * WebSocket 网关
 *
 * 连接地址: ws://host:PORT/ws
 * 支持事件:
 *   - subscribe_backtest  订阅某个回测任务的进度推送
 *   - unsubscribe_backtest 取消订阅
 *
 * 服务端主动推送事件:
 *   - backtest_progress      回测进度 { jobId, progress, state }
 *   - backtest_completed     回测完成 { jobId, result }
 *   - backtest_failed        回测失败 { jobId, reason }
 *   - tushare_sync_started   Tushare 同步开始 { trigger, mode }
 *   - tushare_sync_completed Tushare 同步完成 { trigger, mode, executedTasks, skippedTasks, failedTasks, targetTradeDate, elapsedSeconds }
 *   - tushare_sync_failed    Tushare 同步异常 { trigger, mode, reason }
 *   - notification           通用通知消息
 *   - screener_subscription_alert  条件订阅命中新股票 { subscriptionId, name, tradeDate, newEntryCodes, exitCodes, totalMatch }
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (origin, callback) => callback(null, isWebSocketOriginAllowed(origin)),
    credentials: true,
  },
  allowRequest: (request, callback) => callback(null, isWebSocketOriginAllowed(request.headers.origin)),
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(EventsGateway.name)

  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    @Optional() private readonly publisher?: SocketIoRedisPublisher,
  ) {}

  afterInit() {
    this.logger.log('WebSocket gateway initialized on namespace /ws')
  }

  async handleConnection(client: Socket): Promise<void> {
    const identity = await this.authenticate(client)
    if (!identity) {
      client.disconnect(true)
      this.logger.warn(`Rejected unauthenticated WebSocket client: ${client.id}`)
      return
    }

    const authenticatedClient = client as AuthenticatedSocket
    authenticatedClient.data.identity = identity
    identity.expiresTimer = setTimeout(() => client.disconnect(true), identity.tokenExpiresAt - Date.now())
    client.join(`user:${identity.userId}`)
    this.logger.debug(`Client ${client.id} joined user:${identity.userId}`)
    if (identity.role === UserRole.ADMIN || identity.role === UserRole.SUPER_ADMIN) {
      client.join(ADMIN_ROOM)
      this.logger.debug(`Client ${client.id} joined ${ADMIN_ROOM} (role=${identity.role})`)
    }
  }

  handleDisconnect(client: Socket) {
    const identity = (client as AuthenticatedSocket).data?.identity
    if (identity?.expiresTimer) clearTimeout(identity.expiresTimer)
    // 退出所有已加入的房间，避免长期累积空房间
    const rooms = client.rooms ? [...client.rooms].filter((r) => r !== client.id) : []
    for (const room of rooms) {
      client.leave(room)
    }
    this.logger.log(`Client disconnected: ${client.id}, left ${rooms.length} rooms`)
  }

  private async authenticate(client: Socket): Promise<SocketIdentity | null> {
    try {
      const token = this.extractAccessToken(client)
      if (!token) return null
      const payload = await this.tokenService.verifyAccessToken(token)
      if (
        !Number.isSafeInteger(payload.id) ||
        payload.id <= 0 ||
        !payload.jti ||
        !Number.isFinite(payload.exp) ||
        !Object.values(UserRole).includes(payload.role)
      ) {
        return null
      }
      if (await this.tokenService.isAccessTokenBlacklisted(payload.jti)) return null
      return {
        userId: payload.id,
        role: payload.role,
        authenticatedAt: Date.now(),
        tokenExpiresAt: payload.exp * 1000,
      }
    } catch {
      return null
    }
  }

  private extractAccessToken(client: Socket): string | null {
    const handshakeToken = client.handshake.auth?.token
    if (typeof handshakeToken === 'string' && handshakeToken.trim()) return handshakeToken.trim()

    const authorization = client.handshake.headers?.authorization
    if (typeof authorization !== 'string') return null
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    return match?.[1]?.trim() || null
  }

  private getIdentity(client: Socket): SocketIdentity {
    const identity = (client as AuthenticatedSocket).data?.identity
    if (!identity) throw new WsException('未认证的 WebSocket 连接')
    if (identity.tokenExpiresAt <= Date.now()) {
      client.disconnect(true)
      throw new WsException('WebSocket 登录已过期')
    }
    return identity
  }

  private async assertBacktestJobOwner(userId: number, jobId: string): Promise<void> {
    const backtestRun = await this.prisma.backtestRun.findFirst({
      where: { jobId, userId, deletedAt: null },
      select: { id: true },
    })
    if (backtestRun) return

    const walkForwardRun = await this.prisma.backtestWalkForwardRun.findFirst({
      where: { jobId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!walkForwardRun) throw new WsException('回测任务不存在')
  }

  // ---------- 客户端 -> 服务端 ----------

  /** 订阅指定回测任务的进度消息 */
  @SubscribeMessage('subscribe_backtest')
  async handleSubscribeBacktest(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId?: string }) {
    const identity = this.getIdentity(client)
    const jobId = data?.jobId?.trim()
    if (!jobId || jobId.length > MAX_BACKTEST_JOB_ID_LENGTH) {
      throw new WsException('回测任务标识无效')
    }
    await this.assertBacktestJobOwner(identity.userId, jobId)
    const room = `backtest:${jobId}`
    client.join(room)
    this.logger.log(`Client ${client.id} subscribed to ${room}`)
    return { event: 'subscribed', room }
  }

  /** 取消订阅 */
  @SubscribeMessage('unsubscribe_backtest')
  handleUnsubscribeBacktest(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId?: string }) {
    this.getIdentity(client)
    const jobId = data?.jobId?.trim()
    if (!jobId || jobId.length > MAX_BACKTEST_JOB_ID_LENGTH) {
      throw new WsException('回测任务标识无效')
    }
    const room = `backtest:${jobId}`
    client.leave(room)
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`)
    return { event: 'unsubscribed', room }
  }

  // ---------- 服务端 -> 客户端（供其他 Service 调用） ----------

  /** 向订阅了指定 jobId 的客户端推送进度 */
  emitBacktestProgress(jobId: string, progress: number, state: string) {
    this.emitToRoom(`backtest:${jobId}`, 'backtest_progress', { jobId, progress, state })
  }

  /** 推送回测完成结果 */
  emitBacktestCompleted(jobId: string, result: unknown) {
    this.emitToRoom(`backtest:${jobId}`, 'backtest_completed', { jobId, result })
  }

  /** 推送回测失败信息 */
  emitBacktestFailed(jobId: string, reason: string) {
    this.emitToRoom(`backtest:${jobId}`, 'backtest_failed', { jobId, reason })
  }

  /** 向所有在线客户端广播通知 */
  broadcastNotification(message: string, data?: unknown) {
    this.broadcast('notification', { message, data })
  }

  /** 向管理员推送 Tushare 同步已开始 */
  broadcastSyncStarted(trigger: string, mode: string) {
    this.emitToRoom(ADMIN_ROOM, 'tushare_sync_started', { trigger, mode })
  }

  /** 向管理员推送 Tushare 同步已完成 */
  broadcastSyncCompleted(result: {
    trigger: string
    mode: string
    executedTasks: string[]
    skippedTasks: string[]
    failedTasks: string[]
    targetTradeDate: string | null
    elapsedSeconds: number
  }) {
    this.emitToRoom(ADMIN_ROOM, 'tushare_sync_completed', result)
  }

  /** 向管理员推送 Tushare 同步异常终止 */
  broadcastSyncFailed(trigger: string, mode: string, reason: string) {
    this.emitToRoom(ADMIN_ROOM, 'tushare_sync_failed', { trigger, mode, reason })
  }

  /**
   * 向管理员推送单个任务的同步进度（节流由调用方控制）。
   * 前端事件名: tushare_sync_progress
   */
  broadcastSyncProgress(payload: {
    task: string
    label: string
    category: string
    completedItems: number
    totalItems: number
    percentage: number
    currentKey?: string
    elapsedMs: number
    estimatedRemainingMs?: number
  }) {
    this.emitToRoom(ADMIN_ROOM, 'tushare_sync_progress', payload)
  }

  /**
   * 向管理员推送全局同步总体进度（各任务等权聚合）。
   * 前端事件名: tushare_sync_overall_progress
   */
  broadcastSyncOverallProgress(payload: {
    completedTasks: number
    totalTasks: number
    percentage: number
    elapsedMs: number
    estimatedRemainingMs?: number
  }) {
    this.emitToRoom(ADMIN_ROOM, 'tushare_sync_overall_progress', payload)
  }

  /**
   * 向指定用户推送消息（通过 user:${userId} 房间）。
   * 客户端连接时自动加入该房间（若携带有效 JWT token）。
   */
  emitToUser(userId: number, event: string, data: unknown) {
    this.emitToRoom(`user:${userId}`, event, data)
  }

  /** 向管理员推送数据质量检查完成 */
  broadcastDataQualityCompleted(summary: QualityCheckSummary): void {
    this.emitToRoom(ADMIN_ROOM, 'data_quality_completed', summary)
  }

  /** 向管理员推送自动补数任务入队 */
  broadcastAutoRepairQueued(summary: RepairSummary): void {
    this.emitToRoom(ADMIN_ROOM, 'auto_repair_queued', summary)
  }

  /** 获取当前 WebSocket 连接数（供 Prometheus 指标采集） */
  async getConnectionCount(): Promise<number> {
    if (!this.server) return 0
    const sockets = await this.server.fetchSockets()
    return sockets.length
  }

  private emitToRoom(room: string, event: string, data: unknown): void {
    if (this.server) {
      this.server.to(room).emit(event, data)
      return
    }
    this.publisher?.emitToRoom(room, event, data)
  }

  private broadcast(event: string, data: unknown): void {
    if (this.server) {
      this.server.emit(event, data)
      return
    }
    this.publisher?.broadcast(event, data)
  }
}
