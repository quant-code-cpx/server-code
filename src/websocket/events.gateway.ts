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
  cors: { origin: '*' },
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
    this.logger.log(`Client disconnected: ${client.id}`)
  }

  private extractUserId(client: Socket): number | null {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '')
      if (!token) return null
      const payload = this.jwtService.decode(token) as { id?: number } | null
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
   * 向指定用户推送消息（通过 user:${userId} 房间）。
   * 客户端连接时自动加入该房间（若携带有效 JWT token）。
   */
  emitToUser(userId: number, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data)
  }
}
