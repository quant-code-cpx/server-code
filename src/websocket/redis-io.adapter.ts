import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient, type RedisClientOptions } from 'redis'
import type { ServerOptions } from 'socket.io'
import type { IRedisConfig } from 'src/config/redis.config'
import { LoggerService } from 'src/shared/logger/logger.service'

export interface SocketRedisEnvironment {
  REDIS_SOCKET_USERNAME?: string
  REDIS_SOCKET_PASSWORD?: string
  REDIS_USERNAME?: string
  REDIS_PASSWORD?: string
}

type SocketRedisClient = ReturnType<typeof createClient>

export function resolveSocketRedisOptions(
  redis: IRedisConfig,
  env: SocketRedisEnvironment = process.env,
): RedisClientOptions {
  return {
    url: redis.url,
    username: env.REDIS_SOCKET_USERNAME || env.REDIS_USERNAME || undefined,
    password: env.REDIS_SOCKET_PASSWORD || env.REDIS_PASSWORD || undefined,
  }
}

/** Socket.IO adapter backed by dedicated Redis pub/sub connections. */
export class RedisIoAdapter extends IoAdapter {
  private pubClient?: SocketRedisClient
  private subClient?: SocketRedisClient

  constructor(
    app: INestApplicationContext,
    private readonly redis: IRedisConfig,
    private readonly logger: LoggerService,
    env: SocketRedisEnvironment = process.env,
  ) {
    super(app)
    this.clientOptions = resolveSocketRedisOptions(redis, env)
  }

  private readonly clientOptions: RedisClientOptions

  async connectToRedis(): Promise<void> {
    if (this.pubClient?.isOpen && this.subClient?.isOpen) return

    this.pubClient = createClient(this.clientOptions)
    this.subClient = this.pubClient.duplicate()
    this.pubClient.on('error', (error) => this.logRedisError('publisher', error))
    this.subClient.on('error', (error) => this.logRedisError('subscriber', error))

    try {
      await Promise.all([this.pubClient.connect(), this.subClient.connect()])
      this.logger.log({ operation: 'websocket.redisAdapter.connected' }, RedisIoAdapter.name)
    } catch (error) {
      await this.disconnectRedis()
      throw error
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    if (!this.pubClient?.isOpen || !this.subClient?.isOpen) {
      throw new Error('[WebSocket] RedisIoAdapter 必须在 connectToRedis 后使用')
    }
    const server = super.createIOServer(port, options)
    server.adapter(
      createAdapter(this.pubClient, this.subClient, {
        key: 'quant:socket.io',
        publishOnSpecificResponseChannel: true,
      }),
    )
    return server
  }

  async dispose(): Promise<void> {
    await this.disconnectRedis()
  }

  private async disconnectRedis(): Promise<void> {
    const clients = [this.subClient, this.pubClient]
    this.subClient = undefined
    this.pubClient = undefined
    await Promise.all(
      clients.map(async (client) => {
        if (client?.isOpen) await client.quit()
      }),
    )
  }

  private logRedisError(client: 'publisher' | 'subscriber', error: unknown): void {
    this.logger.error(
      {
        operation: 'websocket.redisAdapter.error',
        client,
        message: error instanceof Error ? error.message : String(error),
      },
      undefined,
      RedisIoAdapter.name,
    )
  }
}
