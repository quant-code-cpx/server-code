import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import type { createClient } from 'redis'
import { REDIS_CLIENT } from './redis.provider'
import { LoggerService } from './logger/logger.service'

/**
 * RedisShutdownService — 优雅关闭时断开 Redis 连接。
 *
 * NestJS 的 enableShutdownHooks() 会在收到 SIGTERM / SIGINT 信号时
 * 依次调用各模块的 onApplicationShutdown 方法。
 * 本服务确保 Redis 客户端在进程退出前主动断开连接，
 * 避免连接泄漏或 Redis 连接数持续增长。
 */
@Injectable()
export class RedisShutdownService implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: ReturnType<typeof createClient>,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Closing Redis connection (signal: ${signal ?? 'unknown'})...`, 'RedisShutdownService')
    try {
      if (this.redis?.isOpen) {
        await this.redis.quit()
      }
    } catch (err) {
      this.logger.error('Error closing Redis connection', err?.message, 'RedisShutdownService')
    }
  }
}
