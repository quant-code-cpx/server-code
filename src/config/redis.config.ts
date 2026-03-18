import { ConfigType, registerAs } from '@nestjs/config'

export const REDIS_CONFIG_TOKEN = 'redis'

export const RedisConfig = registerAs(REDIS_CONFIG_TOKEN, () => {
  const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_USERNAME } = process.env
  const auth = REDIS_PASSWORD ? `${REDIS_USERNAME || 'default'}:${REDIS_PASSWORD}@` : ''
  return {
    host: REDIS_HOST || '127.0.0.1',
    port: parseInt(REDIS_PORT, 10) || 6379,
    url: `redis://${auth}${REDIS_HOST || '127.0.0.1'}:${REDIS_PORT || 6379}`,
  }
})

export type IRedisConfig = ConfigType<typeof RedisConfig>
