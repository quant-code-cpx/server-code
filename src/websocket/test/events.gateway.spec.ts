import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { EventsGateway } from '../events.gateway'
import { Server, Socket } from 'socket.io'

// ── Mock Socket 工厂 ──────────────────────────────────────────────────────────

function makeMockSocket(overrides: Partial<Socket> = {}): jest.Mocked<Socket> {
  return {
    id: 'socket-1',
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    handshake: { auth: {}, headers: {} },
    ...overrides,
  } as unknown as jest.Mocked<Socket>
}

// ── Mock Server ───────────────────────────────────────────────────────────────

function makeMockServer() {
  const room = { emit: jest.fn() }
  const server = {
    emit: jest.fn(),
    to: jest.fn(() => room),
    _room: room,
  }
  return server
}

describe('EventsGateway', () => {
  let gateway: EventsGateway
  let jwtService: jest.Mocked<JwtService>

  beforeEach(async () => {
    jwtService = {
      decode: jest.fn(),
      sign: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [EventsGateway, { provide: JwtService, useValue: jwtService }],
    }).compile()

    gateway = module.get(EventsGateway)
    // 注入 mock server
    gateway.server = makeMockServer() as unknown as Server
  })

  afterEach(() => jest.clearAllMocks())

  // ── 初始化 ────────────────────────────────────────────────────────────────

  it('afterInit — 初始化不抛出', () => {
    expect(() => gateway.afterInit()).not.toThrow()
  })

  // ── 连接 ─────────────────────────────────────────────────────────────────

  it('handleConnection — 无 token → 不加入 user:X 房间', () => {
    jwtService.verify.mockReturnValue(null)
    const socket = makeMockSocket()
    gateway.handleConnection(socket)
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('handleConnection — 有效 token → 加入 user:1 房间', () => {
    jwtService.verify.mockReturnValue({ id: 1 })
    const socket = makeMockSocket({ handshake: { auth: { token: 'valid-jwt' }, headers: {} } as unknown as Socket['handshake'] })
    gateway.handleConnection(socket)
    expect(socket.join).toHaveBeenCalledWith('user:1')
  })

  it('handleConnection — token 解析抛出 → 不崩溃，不加入房间', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid')
    })
    const socket = makeMockSocket({ handshake: { auth: { token: 'bad' }, headers: {} } as unknown as Socket['handshake'] })
    expect(() => gateway.handleConnection(socket)).not.toThrow()
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('handleDisconnect — 不抛出', () => {
    const socket = makeMockSocket()
    expect(() => gateway.handleDisconnect(socket)).not.toThrow()
  })

  // ── 订阅 / 取消订阅 回测 ─────────────────────────────────────────────────

  it('handleSubscribeBacktest — 加入 backtest:job-1 房间', () => {
    const socket = makeMockSocket()
    const result = gateway.handleSubscribeBacktest(socket, { jobId: 'job-1' })
    expect(socket.join).toHaveBeenCalledWith('backtest:job-1')
    expect(result).toEqual({ event: 'subscribed', room: 'backtest:job-1' })
  })

  it('handleUnsubscribeBacktest — 离开 backtest:job-1 房间', () => {
    const socket = makeMockSocket()
    const result = gateway.handleUnsubscribeBacktest(socket, { jobId: 'job-1' })
    expect(socket.leave).toHaveBeenCalledWith('backtest:job-1')
    expect(result).toEqual({ event: 'unsubscribed', room: 'backtest:job-1' })
  })

  // ── 服务端推送方法 ─────────────────────────────────────────────────────────

  it('emitBacktestProgress — 向 backtest:job-1 推送进度', () => {
    gateway.emitBacktestProgress('job-1', 50, 'running')
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('backtest:job-1')
    expect(server._room.emit).toHaveBeenCalledWith('backtest_progress', { jobId: 'job-1', progress: 50, state: 'running' })
  })

  it('emitBacktestCompleted — 向 backtest:job-1 推送完成', () => {
    gateway.emitBacktestCompleted('job-1', { runId: 'run-1' })
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('backtest:job-1')
    expect(server._room.emit).toHaveBeenCalledWith('backtest_completed', { jobId: 'job-1', result: { runId: 'run-1' } })
  })

  it('emitBacktestFailed — 向 backtest:job-1 推送失败', () => {
    gateway.emitBacktestFailed('job-1', 'engine error')
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('backtest:job-1')
    expect(server._room.emit).toHaveBeenCalledWith('backtest_failed', { jobId: 'job-1', reason: 'engine error' })
  })

  it('broadcastNotification — emit 到所有客户端', () => {
    gateway.broadcastNotification('系统通知', { level: 'info' })
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('notification', { message: '系统通知', data: { level: 'info' } })
  })

  it('broadcastSyncStarted — emit tushare_sync_started', () => {
    gateway.broadcastSyncStarted('cron', 'incremental')
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('tushare_sync_started', { trigger: 'cron', mode: 'incremental' })
  })

  it('broadcastSyncCompleted — emit tushare_sync_completed', () => {
    const payload = {
      trigger: 'manual',
      mode: 'full',
      executedTasks: ['daily'],
      skippedTasks: [],
      failedTasks: [],
      targetTradeDate: '2026-04-09',
      elapsedSeconds: 42,
    }
    gateway.broadcastSyncCompleted(payload)
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('tushare_sync_completed', payload)
  })

  it('broadcastSyncFailed — emit tushare_sync_failed', () => {
    gateway.broadcastSyncFailed('cron', 'full', 'timeout')
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('tushare_sync_failed', { trigger: 'cron', mode: 'full', reason: 'timeout' })
  })

  it('emitToUser — 向指定用户房间推送', () => {
    gateway.emitToUser(42, 'custom_event', { msg: 'hello' })
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('user:42')
    expect(server._room.emit).toHaveBeenCalledWith('custom_event', { msg: 'hello' })
  })

  it('broadcastDataQualityCompleted — emit data_quality_completed', () => {
    const summary = { total: 5, passed: 4, failed: 1, issues: [] } as never
    gateway.broadcastDataQualityCompleted(summary)
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('data_quality_completed', summary)
  })

  it('broadcastAutoRepairQueued — emit auto_repair_queued', () => {
    const summary = { total: 2, queued: 2 } as never
    gateway.broadcastAutoRepairQueued(summary)
    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('auto_repair_queued', summary)
  })

  // ── [SEC] Token 提取边界 ───────────────────────────────────────────────────

  it('[SEC] Authorization header 中的 Bearer token 提取 → 正确去掉前缀后 verify', () => {
    jwtService.verify.mockReturnValue({ id: 5 })
    const socket = makeMockSocket({
      handshake: {
        auth: {},
        headers: { authorization: 'Bearer valid-jwt-xxx' },
      } as unknown as Socket['handshake'],
    })

    gateway.handleConnection(socket)

    // 验证 verify 被调用且使用了去掉前缀的 token
    expect(jwtService.verify).toHaveBeenCalledWith('valid-jwt-xxx')
    expect(socket.join).toHaveBeenCalledWith('user:5')
  })

  it('[SEC] 空字符串 token → 不调用 verify，不加入房间', () => {
    const socket = makeMockSocket({
      handshake: { auth: { token: '' }, headers: {} } as unknown as Socket['handshake'],
    })

    gateway.handleConnection(socket)

    expect(jwtService.verify).not.toHaveBeenCalled()
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('[SEC] verify 返回无 id 字段的 payload（如 { sub: "user" }）→ 不加入用户房间', () => {
    jwtService.verify.mockReturnValue({ sub: 'user' })
    const socket = makeMockSocket({
      handshake: { auth: { token: 'some-jwt' }, headers: {} } as unknown as Socket['handshake'],
    })

    gateway.handleConnection(socket)

    expect(socket.join).not.toHaveBeenCalled()
  })

  it('签名验证（已修复 P5-B15）→ verify 失败时拒绝加入用户房间', () => {
    // 修复后：使用 jwtService.verify() 验证签名，签名无效时抛出异常
    // catch 块捕获异常并 return null → socket 不加入任何用户房间
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt signature is invalid')
    })
    const socket = makeMockSocket({
      handshake: { auth: { token: 'forged.payload.nosig' }, headers: {} } as unknown as Socket['handshake'],
    })

    gateway.handleConnection(socket)

    // 修复后行为：伪造 token 无法加入用户房间
    expect(socket.join).not.toHaveBeenCalled()
  })

  // ── [EDGE] 订阅参数边界 ───────────────────────────────────────────────────

  it('[EDGE] handleSubscribeBacktest 空 jobId → 房间名为 "backtest:"', () => {
    const socket = makeMockSocket()
    const result = gateway.handleSubscribeBacktest(socket, { jobId: '' })

    expect(socket.join).toHaveBeenCalledWith('backtest:')
    expect(result).toEqual({ event: 'subscribed', room: 'backtest:' })
  })

  // ── [BIZ] broadcastSyncProgress + broadcastSyncOverallProgress payload ────

  it('[BIZ] broadcastSyncProgress — 验证完整 payload 结构', () => {
    const payload = {
      task: 'daily',
      label: '日线数据',
      category: 'stock',
      completedItems: 50,
      totalItems: 100,
      percentage: 50,
      currentKey: '20260101',
      elapsedMs: 1000,
      estimatedRemainingMs: 1000,
    }

    gateway.broadcastSyncProgress(payload)

    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('tushare_sync_progress', payload)
  })

  it('[BIZ] broadcastSyncOverallProgress — 验证完整 payload 结构', () => {
    const payload = {
      completedTasks: 3,
      totalTasks: 10,
      percentage: 30,
      elapsedMs: 5000,
      estimatedRemainingMs: 12000,
    }

    gateway.broadcastSyncOverallProgress(payload)

    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.emit).toHaveBeenCalledWith('tushare_sync_overall_progress', payload)
  })
})

