import { WsException } from '@nestjs/websockets'
import { UserRole } from '@prisma/client'
import { Socket } from 'socket.io'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { EventsGateway, isWebSocketOriginAllowed } from '../events.gateway'

function makeMockSocket(overrides: Partial<Socket> = {}): jest.Mocked<Socket> {
  return {
    id: 'socket-1',
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    rooms: new Set(['socket-1']),
    handshake: { auth: {}, headers: {} },
    ...overrides,
  } as unknown as jest.Mocked<Socket>
}

function makeMockServer() {
  const room = { emit: jest.fn() }
  return {
    emit: jest.fn(),
    to: jest.fn(() => room),
    fetchSockets: jest.fn(async () => []),
    _room: room,
  }
}

describe('EventsGateway', () => {
  let gateway: EventsGateway
  let tokenService: jest.Mocked<Pick<TokenService, 'verifyAccessToken' | 'isAccessTokenBlacklisted'>>
  let prisma: {
    backtestRun: { findFirst: jest.Mock }
    backtestWalkForwardRun: { findFirst: jest.Mock }
  }

  beforeEach(() => {
    tokenService = {
      verifyAccessToken: jest.fn().mockResolvedValue({
        id: 1,
        account: 'user-1',
        nickname: 'User One',
        role: UserRole.USER,
        jti: 'access-jti-1',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
      isAccessTokenBlacklisted: jest.fn().mockResolvedValue(false),
    }
    prisma = {
      backtestRun: { findFirst: jest.fn().mockResolvedValue(null) },
      backtestWalkForwardRun: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    gateway = new EventsGateway(tokenService as unknown as TokenService, prisma as unknown as PrismaService)
    gateway.server = makeMockServer() as never
  })

  afterEach(() => jest.clearAllMocks())

  it('生产 Origin gate 仅允许显式 CORS_ORIGIN，开发环境保留本机调试', () => {
    expect(
      isWebSocketOriginAllowed('https://app.example.com', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com,https://admin.example.com',
      }),
    ).toBe(true)
    expect(
      isWebSocketOriginAllowed('https://attacker.example.com', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com',
      }),
    ).toBe(false)
    expect(
      isWebSocketOriginAllowed(undefined, { NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example.com' }),
    ).toBe(false)
    expect(isWebSocketOriginAllowed(undefined, { NODE_ENV: 'development' })).toBe(true)
  })

  it('有效 access token 建立服务端身份并加入自己的 user 房间', async () => {
    const socket = makeMockSocket({
      handshake: { auth: { token: 'valid-jwt' }, headers: {} } as unknown as Socket['handshake'],
    })

    await gateway.handleConnection(socket)

    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('valid-jwt')
    expect(tokenService.isAccessTokenBlacklisted).toHaveBeenCalledWith('access-jti-1')
    expect(socket.join).toHaveBeenCalledWith('user:1')
    expect(socket.data.identity).toEqual(
      expect.objectContaining({ userId: 1, role: UserRole.USER, tokenExpiresAt: expect.any(Number) }),
    )
    clearTimeout(socket.data.identity.expiresTimer)
  })

  it('管理员 access token 同时加入管理员房间', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      id: 9,
      account: 'admin',
      nickname: 'Admin',
      role: UserRole.ADMIN,
      jti: 'admin-jti',
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    const socket = makeMockSocket({
      handshake: { auth: { token: 'admin-jwt' }, headers: {} } as unknown as Socket['handshake'],
    })

    await gateway.handleConnection(socket)

    expect(socket.join).toHaveBeenCalledWith('user:9')
    expect(socket.join).toHaveBeenCalledWith('role:admin')
    clearTimeout(socket.data.identity.expiresTimer)
  })

  it('缺少 token 时立即断连且不调用 token 校验', async () => {
    const socket = makeMockSocket()

    await gateway.handleConnection(socket)

    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled()
    expect(socket.join).not.toHaveBeenCalled()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('签名无效 token 时立即断连', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new Error('jwt signature is invalid'))
    const socket = makeMockSocket({
      handshake: { auth: { token: 'forged.payload.nosig' }, headers: {} } as unknown as Socket['handshake'],
    })

    await gateway.handleConnection(socket)

    expect(socket.join).not.toHaveBeenCalled()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('blacklist 中的有效签名 token 仍立即断连', async () => {
    tokenService.isAccessTokenBlacklisted.mockResolvedValue(true)
    const socket = makeMockSocket({
      handshake: { auth: { token: 'revoked-jwt' }, headers: {} } as unknown as Socket['handshake'],
    })

    await gateway.handleConnection(socket)

    expect(socket.join).not.toHaveBeenCalled()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('Bearer Authorization header 可作为握手 token', async () => {
    const socket = makeMockSocket({
      handshake: {
        auth: {},
        headers: { authorization: 'Bearer valid-jwt-xxx' },
      } as unknown as Socket['handshake'],
    })

    await gateway.handleConnection(socket)

    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('valid-jwt-xxx')
    clearTimeout(socket.data.identity.expiresTimer)
  })

  it('订阅本人 Backtest job 才加入 backtest 房间', async () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() + 60_000 },
      },
    })
    prisma.backtestRun.findFirst.mockResolvedValue({ id: 'run-1' })

    await expect(gateway.handleSubscribeBacktest(socket, { jobId: 'job-1' })).resolves.toEqual({
      event: 'subscribed',
      room: 'backtest:job-1',
    })

    expect(prisma.backtestRun.findFirst).toHaveBeenCalledWith({
      where: { jobId: 'job-1', userId: 1, deletedAt: null },
      select: { id: true },
    })
    expect(socket.join).toHaveBeenCalledWith('backtest:job-1')
  })

  it('不能订阅他人或不存在的 Backtest job', async () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() + 60_000 },
      },
    })

    await expect(gateway.handleSubscribeBacktest(socket, { jobId: 'other-users-job' })).rejects.toMatchObject({
      message: '回测任务不存在',
    })

    expect(socket.join).not.toHaveBeenCalled()
  })

  it('本人 WalkForward job 也可订阅', async () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() + 60_000 },
      },
    })
    prisma.backtestWalkForwardRun.findFirst.mockResolvedValue({ id: 'wf-1' })

    await gateway.handleSubscribeBacktest(socket, { jobId: 'wf-job-1' })

    expect(prisma.backtestWalkForwardRun.findFirst).toHaveBeenCalledWith({
      where: { jobId: 'wf-job-1', userId: 1, deletedAt: null },
      select: { id: true },
    })
    expect(socket.join).toHaveBeenCalledWith('backtest:wf-job-1')
  })

  it('空 jobId 不能形成 backtest: 公共房间', async () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() + 60_000 },
      },
    })

    await expect(gateway.handleSubscribeBacktest(socket, { jobId: ' ' })).rejects.toBeInstanceOf(WsException)

    expect(prisma.backtestRun.findFirst).not.toHaveBeenCalled()
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('未认证 client 不能取消订阅', () => {
    const socket = makeMockSocket()

    expect(() => gateway.handleUnsubscribeBacktest(socket, { jobId: 'job-1' })).toThrow(WsException)

    expect(socket.leave).not.toHaveBeenCalled()
  })

  it('已认证 client 可幂等取消订阅', () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() + 60_000 },
      },
    })

    expect(gateway.handleUnsubscribeBacktest(socket, { jobId: 'job-1' })).toEqual({
      event: 'unsubscribed',
      room: 'backtest:job-1',
    })
    expect(socket.leave).toHaveBeenCalledWith('backtest:job-1')
  })

  it('连接 token 到期后断开 client 且拒绝订阅', async () => {
    const socket = makeMockSocket({
      data: {
        identity: { userId: 1, role: UserRole.USER, authenticatedAt: Date.now(), tokenExpiresAt: Date.now() - 1 },
      },
    })

    await expect(gateway.handleSubscribeBacktest(socket, { jobId: 'job-1' })).rejects.toMatchObject({
      message: 'WebSocket 登录已过期',
    })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('服务端事件按用户与回测房间定向发送', () => {
    gateway.emitBacktestProgress('job-1', 50, 'running')
    gateway.emitBacktestCompleted('job-1', { runId: 'run-1' })
    gateway.emitBacktestFailed('job-1', 'engine error')
    gateway.emitToUser(42, 'notification', { id: 7 })

    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('backtest:job-1')
    expect(server.to).toHaveBeenCalledWith('user:42')
    expect(server._room.emit).toHaveBeenCalledWith('backtest_progress', {
      jobId: 'job-1',
      progress: 50,
      state: 'running',
    })
    expect(server._room.emit).toHaveBeenCalledWith('backtest_completed', { jobId: 'job-1', result: { runId: 'run-1' } })
    expect(server._room.emit).toHaveBeenCalledWith('backtest_failed', { jobId: 'job-1', reason: 'engine error' })
  })

  it('管理员同步事件只写入管理员房间', () => {
    gateway.broadcastSyncStarted('cron', 'incremental')
    gateway.broadcastSyncFailed('cron', 'incremental', 'timeout')

    const server = gateway.server as unknown as ReturnType<typeof makeMockServer>
    expect(server.to).toHaveBeenCalledWith('role:admin')
    expect(server._room.emit).toHaveBeenCalledWith('tushare_sync_started', { trigger: 'cron', mode: 'incremental' })
    expect(server._room.emit).toHaveBeenCalledWith('tushare_sync_failed', {
      trigger: 'cron',
      mode: 'incremental',
      reason: 'timeout',
    })
  })

  it('无本地 Socket.IO server 时通过 Redis publisher 转发事件', () => {
    const publisher = {
      emitToRoom: jest.fn(),
      broadcast: jest.fn(),
    }
    gateway = new EventsGateway(
      tokenService as unknown as TokenService,
      prisma as unknown as PrismaService,
      publisher as never,
    )

    gateway.emitBacktestProgress('job-1', 50, 'running')
    gateway.broadcastNotification('queued', { jobId: 'job-1' })

    expect(publisher.emitToRoom).toHaveBeenCalledWith('backtest:job-1', 'backtest_progress', {
      jobId: 'job-1',
      progress: 50,
      state: 'running',
    })
    expect(publisher.broadcast).toHaveBeenCalledWith('notification', { message: 'queued', data: { jobId: 'job-1' } })
  })
})
