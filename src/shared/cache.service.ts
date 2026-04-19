import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { RedisClientType } from 'redis'
import type { CacheNamespace } from 'src/constant/cache.constant'
import { REDIS_CLIENT } from './redis.provider'
import { LoggerService } from './logger/logger.service'

const ISO_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

interface RememberJsonOptions<T> {
  namespace: CacheNamespace
  key: string
  ttlSeconds: number
  loader: () => Promise<T>
  /** 返回 true 时跳过缓存写入（例如空结果不应被长期缓存） */
  skipCacheIf?: (value: T) => boolean
}

export interface CacheNamespaceMetrics {
  namespace: string
  keyCount: number
  hits: number
  misses: number
  writes: number
  invalidations: number
  hitRate: number | null
  lastHitAt: string | null
  lastMissAt: string | null
  lastWriteAt: string | null
  lastInvalidatedAt: string | null
}

@Injectable()
export class CacheService {
  private static readonly NAMESPACE_KEY_PREFIX = 'cache:namespace:'
  private static readonly METRICS_KEY_PREFIX = 'cache:metrics:'
  private static readonly SCAN_COUNT = Number(process.env.CACHE_SCAN_COUNT) || 200
  private static readonly DELETE_CHUNK_SIZE = Number(process.env.CACHE_DELETE_CHUNK_SIZE) || 200

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly logger: LoggerService,
  ) {}

  buildKey(prefix: string, payload?: unknown): string {
    if (payload === undefined) {
      return prefix
    }

    const digest = createHash('sha1').update(stableStringify(payload)).digest('hex')
    return `${prefix}:${digest}`
  }

  async rememberJson<T>({ namespace, key, ttlSeconds, loader, skipCacheIf }: RememberJsonOptions<T>): Promise<T> {
    try {
      const cached = await this.redis.get(key)
      if (cached !== null) {
        const parsed = this.parseCacheValue<T>(cached)
        if ('error' in parsed) {
          const parseError = parsed.error
          this.logger.warn(`缓存数据解析失败，已回源重建: ${key} (${parseError.message})`, CacheService.name)
          await Promise.allSettled([this.redis.del(key), this.recordCacheMiss(namespace)])
        } else {
          await this.recordCacheHit(namespace)
          return parsed.value
        }
      } else {
        await this.recordCacheMiss(namespace)
      }
    } catch (error) {
      this.logger.warn(`缓存读取失败，已回源数据库: ${key} (${this.formatError(error)})`, CacheService.name)
    }

    const value = await loader()

    try {
      if (skipCacheIf?.(value)) return value
      const serialized = JSON.stringify(value ?? null)
      await this.redis.setEx(key, ttlSeconds, serialized)
      await this.redis.sAdd(this.getNamespaceKey(namespace), key)
      await this.recordCacheWrite(namespace)
    } catch (error) {
      this.logger.warn(`缓存写入失败，已直接返回结果: ${key} (${this.formatError(error)})`, CacheService.name)
    }

    return value
  }

  async invalidateNamespaces(namespaces: string[]): Promise<number> {
    let deletedCount = 0

    for (const namespace of uniqueStrings(namespaces)) {
      deletedCount += await this.invalidateNamespace(namespace)
    }

    return deletedCount
  }

  async invalidateByPrefixes(prefixes: string[]): Promise<number> {
    const allKeys = new Set<string>()

    for (const prefix of uniqueStrings(prefixes)) {
      try {
        const matched = await this.scanKeys(`${prefix}*`)
        matched.forEach((key) => allKeys.add(key))
      } catch (error) {
        this.logger.warn(`缓存前缀扫描失败: ${prefix} (${this.formatError(error)})`, CacheService.name)
      }
    }

    return this.deleteKeys([...allKeys])
  }

  async getNamespaceMetrics(namespaces: string[]): Promise<CacheNamespaceMetrics[]> {
    const metrics: CacheNamespaceMetrics[] = []

    for (const namespace of uniqueStrings(namespaces)) {
      metrics.push(await this.getSingleNamespaceMetrics(namespace))
    }

    return metrics
  }

  private async invalidateNamespace(namespace: string): Promise<number> {
    try {
      const setKey = this.getNamespaceKey(namespace)
      const keys = await this.redis.sMembers(setKey)
      const deletedCount = await this.deleteKeys(keys)

      await this.redis.del(setKey)
      await this.recordCacheInvalidation(namespace)

      return deletedCount
    } catch (error) {
      this.logger.warn(`缓存命名空间失效失败: ${namespace} (${this.formatError(error)})`, CacheService.name)
      return 0
    }
  }

  private async getSingleNamespaceMetrics(namespace: string): Promise<CacheNamespaceMetrics> {
    try {
      const [rawMetrics, keyCount] = await Promise.all([
        this.redis.hGetAll(this.getMetricsKey(namespace)),
        this.redis.sCard(this.getNamespaceKey(namespace)),
      ])

      const hits = readMetricNumber(rawMetrics.hits)
      const misses = readMetricNumber(rawMetrics.misses)
      const totalReads = hits + misses

      return {
        namespace,
        keyCount,
        hits,
        misses,
        writes: readMetricNumber(rawMetrics.writes),
        invalidations: readMetricNumber(rawMetrics.invalidations),
        hitRate: totalReads > 0 ? Number(((hits / totalReads) * 100).toFixed(2)) : null,
        lastHitAt: rawMetrics.lastHitAt ?? null,
        lastMissAt: rawMetrics.lastMissAt ?? null,
        lastWriteAt: rawMetrics.lastWriteAt ?? null,
        lastInvalidatedAt: rawMetrics.lastInvalidatedAt ?? null,
      }
    } catch (error) {
      this.logger.warn(`读取缓存命中率指标失败: ${namespace} (${this.formatError(error)})`, CacheService.name)
      return {
        namespace,
        keyCount: 0,
        hits: 0,
        misses: 0,
        writes: 0,
        invalidations: 0,
        hitRate: null,
        lastHitAt: null,
        lastMissAt: null,
        lastWriteAt: null,
        lastInvalidatedAt: null,
      }
    }
  }

  private async recordCacheHit(namespace: string) {
    await this.recordMetric(namespace, 'hits', 'lastHitAt')
  }

  private async recordCacheMiss(namespace: string) {
    await this.recordMetric(namespace, 'misses', 'lastMissAt')
  }

  private async recordCacheWrite(namespace: string) {
    await this.recordMetric(namespace, 'writes', 'lastWriteAt')
  }

  private async recordCacheInvalidation(namespace: string) {
    await this.recordMetric(namespace, 'invalidations', 'lastInvalidatedAt')
  }

  private async recordMetric(namespace: string, field: string, timestampField: string) {
    try {
      await this.redis.hIncrBy(this.getMetricsKey(namespace), field, 1)
      await this.redis.hSet(this.getMetricsKey(namespace), timestampField, new Date().toISOString())
    } catch (error) {
      this.logger.warn(`更新缓存指标失败: ${namespace}.${field} (${this.formatError(error)})`, CacheService.name)
    }
  }

  private async deleteKeys(keys: string[]): Promise<number> {
    const uniqueKeys = uniqueStrings(keys)
    if (uniqueKeys.length === 0) {
      return 0
    }

    let deletedCount = 0
    for (let index = 0; index < uniqueKeys.length; index += CacheService.DELETE_CHUNK_SIZE) {
      const chunk = uniqueKeys.slice(index, index + CacheService.DELETE_CHUNK_SIZE)
      deletedCount += await this.redis.del(chunk)
    }

    return deletedCount
  }

  private async scanKeys(matchPattern: string): Promise<string[]> {
    const keys: string[] = []
    let cursor = 0

    do {
      const result = await this.redis.scan(cursor, {
        MATCH: matchPattern,
        COUNT: CacheService.SCAN_COUNT,
      })
      cursor = Number(result.cursor)
      keys.push(...result.keys)
    } while (cursor !== 0)

    return keys
  }

  private parseCacheValue<T>(value: string): { ok: true; value: T } | { ok: false; error: Error } {
    try {
      return { ok: true, value: JSON.parse(value, reviveDateValue) as T }
    } catch (error) {
      return { ok: false, error: error as Error }
    }
  }

  private getNamespaceKey(namespace: string) {
    return `${CacheService.NAMESPACE_KEY_PREFIX}${namespace}`
  }

  private getMetricsKey(namespace: string) {
    return `${CacheService.METRICS_KEY_PREFIX}${namespace}`
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }
}

function reviveDateValue(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_TIME_REGEX.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableHash(value))
}

function normalizeForStableHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableHash(item))
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForStableHash(item)]),
    )
  }

  return value
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function readMetricNumber(value: string | undefined): number {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) ? numericValue : 0
}
