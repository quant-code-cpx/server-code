import { resolveSocketRedisOptions } from '../redis-io.adapter'

describe('RedisIoAdapter', () => {
  const redis = { host: 'redis', port: 6379, url: 'redis://api:api-password@redis:6379' }

  it('使用独立 socket ACL 凭据，不复用 API 凭据', () => {
    expect(
      resolveSocketRedisOptions(redis, {
        REDIS_USERNAME: 'api',
        REDIS_PASSWORD: 'api-password',
        REDIS_SOCKET_USERNAME: 'socket',
        REDIS_SOCKET_PASSWORD: 'socket-password',
      }),
    ).toEqual({
      url: redis.url,
      username: 'socket',
      password: 'socket-password',
    })
  })

  it('开发环境未配置 socket ACL 时回退默认 Redis 凭据', () => {
    expect(resolveSocketRedisOptions(redis, { REDIS_USERNAME: 'default', REDIS_PASSWORD: 'dev-password' })).toEqual({
      url: redis.url,
      username: 'default',
      password: 'dev-password',
    })
  })
})
