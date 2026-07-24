import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient, type RedisClientOptions } from 'redis'
import { Namespace, Server } from 'socket.io'
import { IProcessRoleConfig, ProcessRoleConfig } from 'src/config/process-role.config'
import { IRedisConfig, RedisConfig } from 'src/config/redis.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { resolveSocketRedisOptions } from './redis-io.adapter'

type SocketRedisClient = ReturnType<typeof createClient>

/**
 * Publishes to the API Socket.IO namespace from processes which do not host an
 * HTTP server, such as scheduler and workers. API processes use RedisIoAdapter
 * directly and therefore do not open these extra Redis connections.
 */
@Injectable()
export class SocketIoRedisPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly clientOptions: RedisClientOptions
  private pubClient?: SocketRedisClient
  private subClient?: SocketRedisClient
  private io?: Server
  private namespace?: Namespace

  constructor(
    @Inject(RedisConfig.KEY) private readonly redis: IRedisConfig,
    @Inject(ProcessRoleConfig.KEY) private readonly processRole: IProcessRoleConfig,
    private readonly logger: LoggerService,
  ) {
    this.clientOptions = resolveSocketRedisOptions(redis)
  }

  async onModuleInit(): Promise<void> {
    if (this.processRole.apiEnabled) return
    await this.connect()
  }

  emitToRoom(room: string, event: string, data: unknown): void {
    this.namespace?.to(room).emit(event, data)
  }

  broadcast(event: string, data: unknown): void {
    this.namespace?.emit(event, data)
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose()
  }

  private async connect(): Promise<void> {
    if (this.namespace) return

    this.pubClient = createClient(this.clientOptions)
    this.subClient = this.pubClient.duplicate()
    this.pubClient.on('error', (error) => this.logRedisError('publisher', error))
    this.subClient.on('error', (error) => this.logRedisError('subscriber', error))

    try {
      await Promise.all([this.pubClient.connect(), this.subClient.connect()])
      this.io = new Server({ serveClient: false })
      this.io.adapter(
        createAdapter(this.pubClient, this.subClient, {
          key: 'quant:socket.io',
          publishOnSpecificResponseChannel: true,
        }),
      )
      this.namespace = this.io.of('/ws')
      this.logger.log({ operation: 'websocket.redisPublisher.connected' }, SocketIoRedisPublisher.name)
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  private async dispose(): Promise<void> {
    this.namespace = undefined
    // This Server intentionally has no HTTP listener. Calling Server.close()
    // assumes an Engine.IO instance exists, while quitting pub/sub clients is
    // sufficient to release this publisher's only external resources.
    this.io = undefined

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
        operation: 'websocket.redisPublisher.error',
        client,
        message: error instanceof Error ? error.message : String(error),
      },
      undefined,
      SocketIoRedisPublisher.name,
    )
  }
}
