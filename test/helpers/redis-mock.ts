/**
 * Redis Mock 工厂
 *
 * 基于内存 Map 模拟常用 Redis 命令，足够应对测试场景。
 *
 * 使用方式：
 *   const redis = createMockRedis()
 *   redis.set('key', 'value')
 *   await redis.get('key') // => 'value'
 */
export function createMockRedis() {
  const store = new Map<string, string>()
  const expiry = new Map<string, number>() // timestamp ms

  const isExpired = (key: string) => {
    const exp = expiry.get(key)
    if (!exp) return false
    if (Date.now() > exp) {
      store.delete(key)
      expiry.delete(key)
      return true
    }
    return false
  }

  return {
    get: jest.fn(async (key: string) => {
      if (isExpired(key)) return null
      return store.get(key) ?? null
    }),
    set: jest.fn(async (key: string, value: string, opts?: { EX?: number; NX?: boolean }) => {
      if (opts?.NX && store.has(key) && !isExpired(key)) return null
      store.set(key, value)
      if (opts?.EX) expiry.set(key, Date.now() + opts.EX * 1000)
      return 'OK'
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0
      for (const k of keys.flat()) {
        if (store.delete(k)) count++
        expiry.delete(k)
      }
      return count
    }),
    exists: jest.fn(async (...keys: string[]) => {
      return keys.flat().filter((k) => store.has(k) && !isExpired(k)).length
    }),
    keys: jest.fn(async (pattern: string) => {
      // 只支持 * 通配
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return [...store.keys()].filter((k) => !isExpired(k) && regex.test(k))
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      if (!store.has(key)) return 0
      expiry.set(key, Date.now() + seconds * 1000)
      return 1
    }),
    ttl: jest.fn(async (key: string) => {
      if (!store.has(key) || isExpired(key)) return -2
      const exp = expiry.get(key)
      if (!exp) return -1
      return Math.ceil((exp - Date.now()) / 1000)
    }),
    flushAll: jest.fn(async () => {
      store.clear()
      expiry.clear()
      return 'OK'
    }),
    // 供测试直接访问内部状态
    _store: store,
  }
}

export type MockRedis = ReturnType<typeof createMockRedis>
