import { createServer, type Server as HttpServer } from 'node:http'
import type { INestApplicationContext } from '@nestjs/common'
import { io, type Socket as ClientSocket } from 'socket.io-client'
import type { Server as IoServer } from 'socket.io'
import { SocketIoRedisPublisher } from '../socket-io-redis.publisher'
import { RedisIoAdapter } from '../redis-io.adapter'

const integrationDescribe = process.env.RUN_SOCKET_REDIS_INTEGRATION === 'true' ? describe : describe.skip

integrationDescribe('RedisIoAdapter - 双 API 实例集成测试', () => {
  let httpA: HttpServer
  let httpB: HttpServer
  let ioA: IoServer
  let ioB: IoServer
  let adapterA: RedisIoAdapter
  let adapterB: RedisIoAdapter
  let publisher: SocketIoRedisPublisher
  let client: ClientSocket

  beforeAll(async () => {
    const redisUrl = resolveLocalRedisUrl()
    const redis = toRedisConfig(redisUrl)
    const env = toSocketRedisEnvironment(redisUrl)
    const logger = { log: jest.fn(), error: jest.fn() }

    httpA = createServer()
    httpB = createServer()
    adapterA = new RedisIoAdapter(httpA as unknown as INestApplicationContext, redis, logger as never, env)
    adapterB = new RedisIoAdapter(httpB as unknown as INestApplicationContext, redis, logger as never, env)
    publisher = new SocketIoRedisPublisher(redis, { apiEnabled: false } as never, logger as never)
    await Promise.all([adapterA.connectToRedis(), adapterB.connectToRedis()])
    await publisher.onModuleInit()

    ioA = adapterA.createIOServer(0) as IoServer
    ioB = adapterB.createIOServer(0) as IoServer
    ioA.of('/ws').on('connection', (socket) => socket.join('user:1'))

    await Promise.all([listen(httpA), listen(httpB)])
    client = io(`${toBaseUrl(httpA)}/ws`, { transports: ['websocket'], forceNew: true, timeout: 5_000 })
    await once(client, 'connect')
  }, 20_000)

  afterAll(async () => {
    client?.close()
    await publisher?.onModuleDestroy()
    await Promise.all([ioA ? adapterA.close(ioA) : undefined, ioB ? adapterB.close(ioB) : undefined])
    await Promise.all([adapterA?.dispose(), adapterB?.dispose()])
    await Promise.all([closeIfListening(httpA), closeIfListening(httpB)])
  })

  it('B 实例可向 A 实例用户房间发送事件', async () => {
    const received = once(client, 'cross_instance_event')

    ioB.of('/ws').to('user:1').emit('cross_instance_event', { source: 'api-b', sequence: 1 })

    await expect(received).resolves.toEqual([{ source: 'api-b', sequence: 1 }])
  }, 10_000)

  it('无 HTTP server 的 scheduler/worker publisher 可向 API 用户房间发送事件', async () => {
    const received = once(client, 'background_event')

    publisher.emitToRoom('user:1', 'background_event', { source: 'scheduler', sequence: 2 })

    await expect(received).resolves.toEqual([{ source: 'scheduler', sequence: 2 }])
  }, 10_000)
})

function resolveLocalRedisUrl(): string {
  const redisUrl = process.env.SOCKET_REDIS_URL ?? 'redis://127.0.0.1:16379'
  const parsed = new URL(redisUrl)
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('SOCKET_REDIS_URL 必须使用 redis:// 或 rediss://')
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('Socket Redis 集成测试默认只允许本机 Redis')
  }
  return redisUrl
}

function toRedisConfig(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    url,
  }
}

function toSocketRedisEnvironment(url: string) {
  const parsed = new URL(url)
  return {
    REDIS_SOCKET_USERNAME: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    REDIS_SOCKET_PASSWORD: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  }
}

async function listen(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

function toBaseUrl(server: HttpServer): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP test server 未监听')
  return `http://127.0.0.1:${address.port}`
}

async function once<T>(socket: ClientSocket, event: string): Promise<T[]> {
  return await new Promise<T[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 Socket.IO 事件超时: ${event}`)), 5_000)
    socket.once(event, (...args: T[]) => {
      clearTimeout(timer)
      resolve(args)
    })
  })
}

async function closeIfListening(server?: HttpServer): Promise<void> {
  if (!server?.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
