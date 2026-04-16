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
import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Server, Socket } from 'socket.io'
import type { QualityCheckSummary } from 'src/tushare/sync/quality/data-quality.service'
import type { RepairSummary } from 'src/tushare/sync/quality/auto-repair.service'

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
    origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? ['http://localhost:5173'],
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(EventsGateway.name)

  constructor(private readonly jwtService: JwtService) {}

  afterInit() {
    this.logger.log('WebSocket gateway initialized on namespace /ws')
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`)
    // 尝试从 token 中解析 userId，加入用户专属房间
    const userId = this.extractUserId(client)
    if (userId) {
      client.join(`user:${userId}`)
      this.logger.debug(`Client ${client.id} joined user:${userId}`)
    }
  }

  handleDisconnect(client: Socket) {
    // 退出所有已加入的房间，避免长期累积空房间
    const rooms = [...client.rooms].filter((r) => r !== client.id)
    for (const room of rooms) {
      client.leave(room)
    }
    this.logger.log(`Client disconnected: ${client.id}, left ${rooms.length} rooms`)
  }

  private extractUserId(client: Socket): number | null {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '')
      if (!token) return null
      const payload = this.jwtService.verify<{ id?: number }>(token)
      return payload?.id ?? null
    } catch {
      return null
    }
  }

  // ---------- 客户端 -> 服务端 ----------

  /** 订阅指定回测任务的进度消息 */
  @SubscribeMessage('subscribe_backtest')
  handleSubscribeBacktest(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId: string }) {
    const room = `backtest:${data.jobId}`
    client.join(room)
    this.logger.log(`Client ${client.id} subscribed to ${room}`)
    return { event: 'subscribed', room }
  }

  /** 取消订阅 */
  @SubscribeMessage('unsubscribe_backtest')
  handleUnsubscribeBacktest(@ConnectedSocket() client: Socket, @MessageBody() data: { jobId: string }) {
    const room = `backtest:${data.jobId}`
    client.leave(room)
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`)
    return { event: 'unsubscribed', room }
  }

  // ---------- 服务端 -> 客户端（供其他 Service 调用） ----------

  /** 向订阅了指定 jobId 的客户端推送进度 */
  emitBacktestProgress(jobId: string, progress: number, state: string) {
    this.server.to(`backtest:${jobId}`).emit('backtest_progress', { jobId, progress, state })
  }

  /** 推送回测完成结果 */
  emitBacktestCompleted(jobId: string, result: unknown) {
    this.server.to(`backtest:${jobId}`).emit('backtest_completed', { jobId, result })
  }

  /** 推送回测失败信息 */
  emitBacktestFailed(jobId: string, reason: string) {
    this.server.to(`backtest:${jobId}`).emit('backtest_failed', { jobId, reason })
  }

  /** 向所有在线客户端广播通知 */
  broadcastNotification(message: string, data?: unknown) {
    this.server.emit('notification', { message, data })
  }

  /** 广播 Tushare 同步已开始 */
  broadcastSyncStarted(trigger: string, mode: string) {
    this.server.emit('tushare_sync_started', { trigger, mode })
  }

  /** 广播 Tushare 同步已完成 */
  broadcastSyncCompleted(result: {
    trigger: string
    mode: string
    executedTasks: string[]
    skippedTasks: string[]
    failedTasks: string[]
    targetTradeDate: string | null
    elapsedSeconds: number
  }) {
    this.server.emit('tushare_sync_completed', result)
  }

  /** 广播 Tushare 同步异常终止 */
  broadcastSyncFailed(trigger: string, mode: string, reason: string) {
    this.server.emit('tushare_sync_failed', { trigger, mode, reason })
  }

  /**
   * 广播单个任务的同步进度（节流由调用方控制）。
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
    this.server.emit('tushare_sync_progress', payload)
  }

  /**
   * 广播全局同步总体进度（各任务等权聚合）。
   * 前端事件名: tushare_sync_overall_progress
   */
  broadcastSyncOverallProgress(payload: {
    completedTasks: number
    totalTasks: number
    percentage: number
    elapsedMs: number
    estimatedRemainingMs?: number
  }) {
    this.server.emit('tushare_sync_overall_progress', payload)
  }

  /**
   * 向指定用户推送消息（通过 user:${userId} 房间）。
   * 客户端连接时自动加入该房间（若携带有效 JWT token）。
   */
  emitToUser(userId: number, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data)
  }

  /** 广播数据质量检查完成 */
  broadcastDataQualityCompleted(summary: QualityCheckSummary): void {
    this.server.emit('data_quality_completed', summary)
  }

  /** 广播自动补数任务入队 */
  broadcastAutoRepairQueued(summary: RepairSummary): void {
    this.server.emit('auto_repair_queued', summary)
  }

  /** 获取当前 WebSocket 连接数（供 Prometheus 指标采集） */
  async getConnectionCount(): Promise<number> {
    if (!this.server) return 0
    const sockets = await this.server.fetchSockets()
    return sockets.length
  }
}
