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
 *   - backtest_progress   回测进度 { jobId, progress, state }
 *   - backtest_completed  回测完成 { jobId, result }
 *   - backtest_failed     回测失败 { jobId, reason }
 *   - notification        通用通知消息
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

  afterInit() {
    this.logger.log('WebSocket gateway initialized on namespace /ws')
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`)
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
  emitBacktestCompleted(jobId: string, result: any) {
    this.server.to(`backtest:${jobId}`).emit('backtest_completed', { jobId, result })
  }

  /** 推送回测失败信息 */
  emitBacktestFailed(jobId: string, reason: string) {
    this.server.to(`backtest:${jobId}`).emit('backtest_failed', { jobId, reason })
  }

  /** 向所有在线客户端广播通知 */
  broadcastNotification(message: string, data?: any) {
    this.server.emit('notification', { message, data })
  }
}
