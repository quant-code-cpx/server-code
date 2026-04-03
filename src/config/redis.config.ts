import { ConfigType, registerAs } from '@nestjs/config'

export const REDIS_CONFIG_TOKEN = 'redis'

export const RedisConfig = registerAs(REDIS_CONFIG_TOKEN, () => {
  const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_USERNAME } = process.env

  // 非开发环境要求必须配置 Redis 密码（Docker 容器内 Redis 启用了 ACL 认证）
  if (process.env.NODE_ENV !== 'development' && !REDIS_PASSWORD) {
    throw new Error(
      '[Security] 非开发环境必须配置 REDIS_PASSWORD 环境变量。' +
        '请在 .env 中设置 REDIS_PASSWORD，确保与 Docker Redis ACL 配置一致。',
    )
  }

  const auth = REDIS_PASSWORD ? `${REDIS_USERNAME || 'default'}:${REDIS_PASSWORD}@` : ''
  return {
    host: REDIS_HOST || '127.0.0.1',
    port: parseInt(REDIS_PORT, 10) || 6379,
    url: `redis://${auth}${REDIS_HOST || '127.0.0.1'}:${REDIS_PORT || 6379}`,
  }
})

export type IRedisConfig = ConfigType<typeof RedisConfig>
