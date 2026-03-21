import { createClient } from 'redis'
import type { Provider } from '@nestjs/common'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { ConfigService } from '@nestjs/config'
import { AllConfigType } from 'src/config'
import { LoggerService } from './logger/logger.service'

/**
 * Redis 客户端依赖注入令牌。
 *
 * 使用字符串常量作为自定义提供者的标识，
 * 在需要注入 Redis 客户端的地方使用：
 *
 * @example
 * constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}
 */
export const REDIS_CLIENT = 'REDIS_CLIENT'

/**
 * RedisProvider — Redis 客户端的工厂提供者。
 *
 * 基于应用配置（redis.config.ts）创建 redis 客户端实例并建立连接。
 * 连接错误会通过 LoggerService 输出日志但不主动抛异常，
 * 避免单次网络抛动导致整个应用崩溃。
 *
 * 通过 SharedModule 全局注册并导出。
 */
export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: async (configService: ConfigService<AllConfigType>, loggerService: LoggerService) => {
    const { url } = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
    // Prefer explicit username/password options in addition to URL to avoid
    // potential parsing/auth issues in some environments.
    const username = process.env.REDIS_USERNAME || undefined
    const password = process.env.REDIS_PASSWORD || undefined
    const client = createClient({ url, username, password }).on('error', (err) => {
      loggerService.error('Redis client error', err?.message, 'RedisProvider')
    })
    await client.connect()
    return client
  },
  inject: [ConfigService, LoggerService],
} as const
