import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from '../cache.service'

function buildRedisMock() {
  return {
    get: jest.fn(async () => null),
    setEx: jest.fn(async () => 'OK'),
    sAdd: jest.fn(async () => 1),
    hIncrBy: jest.fn(async () => 1),
    hSet: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
  }
}

function buildLoggerMock() {
  return { warn: jest.fn() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('CacheService', () => {
  it('returns an explicit cacheHit marker without invoking the loader on a valid hit', async () => {
    const redis = buildRedisMock()
    redis.get.mockResolvedValueOnce(JSON.stringify({ value: 1 }))
    const service = new CacheService(redis as never, buildLoggerMock() as never)
    const loader = jest.fn()

    await expect(
      service.rememberJsonWithStatus({
        namespace: CACHE_NAMESPACE.FACTOR_ANALYSIS,
        key: 'factor:ic:hit',
        ttlSeconds: 60,
        loader,
      }),
    ).resolves.toEqual({ value: { value: 1 }, cacheHit: true })
    expect(loader).not.toHaveBeenCalled()
  })

  it('builds canonical SHA-256 cache keys independent of object property order', () => {
    const service = new CacheService(buildRedisMock() as never, buildLoggerMock() as never)

    const first = service.buildSha256Key('technical-signal:test', { tsCode: '000001.SZ', horizons: [1, 5] })
    const second = service.buildSha256Key('technical-signal:test', { horizons: [1, 5], tsCode: '000001.SZ' })

    expect(first).toBe(second)
    expect(first).toMatch(/^technical-signal:test:[a-f0-9]{64}$/)
  })

  it('同 key 并发 miss → 只执行一次 loader，两个调用共享结果', async () => {
    const redis = buildRedisMock()
    const service = new CacheService(redis as never, buildLoggerMock() as never)
    const pending = deferred<{ value: number }>()
    const loader = jest.fn(() => pending.promise)

    const opts = {
      namespace: CACHE_NAMESPACE.FACTOR_ANALYSIS,
      key: 'factor:ic:test',
      ttlSeconds: 60,
      loader,
    }

    const first = service.rememberJson(opts)
    const second = service.rememberJson(opts)
    await flushPromises()

    expect(loader).toHaveBeenCalledTimes(1)

    pending.resolve({ value: 1 })
    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 1 }])
    expect(redis.setEx).toHaveBeenCalledTimes(1)
    expect(redis.sAdd).toHaveBeenCalledTimes(1)
  })

  it('loader 失败后清理 in-flight，下一次请求可重新回源', async () => {
    const redis = buildRedisMock()
    const service = new CacheService(redis as never, buildLoggerMock() as never)
    const loader = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ value: 2 })

    const opts = {
      namespace: CACHE_NAMESPACE.FACTOR_ANALYSIS,
      key: 'factor:ic:retry',
      ttlSeconds: 60,
      loader,
    }

    await expect(service.rememberJson(opts)).rejects.toThrow('boom')
    await expect(service.rememberJson(opts)).resolves.toEqual({ value: 2 })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
