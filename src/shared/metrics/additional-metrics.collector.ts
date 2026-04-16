import { Inject, Injectable, Optional } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import type { Gauge } from 'prom-client'
import type { RedisClientType } from 'redis'
import { getToken } from '@willsoto/nestjs-prometheus'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { CacheService } from 'src/shared/cache.service'
import { MONITORED_CACHE_NAMESPACES } from 'src/constant/cache.constant'
import { LoggerService } from 'src/shared/logger/logger.service'
import { REDIS_MEMORY_USAGE, CACHE_HIT_RATIO, WS_ACTIVE_CONNECTIONS } from './additional-metrics.constants'

@Injectable()
export class AdditionalMetricsCollector {
  private wsConnectionCountFn?: () => Promise<number>

  constructor(
    @Inject(getToken(REDIS_MEMORY_USAGE)) private readonly redisMemoryGauge: Gauge,
    @Inject(getToken(CACHE_HIT_RATIO)) private readonly cacheHitRatioGauge: Gauge,
    @Inject(getToken(WS_ACTIVE_CONNECTIONS)) private readonly wsConnectionsGauge: Gauge,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly cacheService: CacheService,
    @Optional() private readonly logger?: LoggerService,
  ) {}

  /** Register an external async function to query WS connection count */
  registerWsConnectionCountFn(fn: () => Promise<number>) {
    this.wsConnectionCountFn = fn
  }

  @Interval(30_000)
  async collectAll() {
    await Promise.allSettled([this.collectRedisMemory(), this.collectCacheHitRatio(), this.collectWsConnections()])
  }

  private async collectRedisMemory() {
    try {
      const info = await (this.redis as RedisClientType).sendCommand(['INFO', 'memory'])
      const match = String(info).match(/used_memory:(\d+)/)
      if (match) {
        this.redisMemoryGauge.set(Number(match[1]))
      }
    } catch (error) {
      this.logger?.warn?.(`Failed to collect redis memory metrics: ${error}`, AdditionalMetricsCollector.name)
    }
  }

  private async collectCacheHitRatio() {
    try {
      const metrics = await this.cacheService.getNamespaceMetrics([...MONITORED_CACHE_NAMESPACES])
      for (const m of metrics) {
        if (m.hitRate != null) {
          this.cacheHitRatioGauge.labels(m.namespace).set(m.hitRate)
        }
      }
    } catch (error) {
      this.logger?.warn?.(`Failed to collect cache hit ratio metrics: ${error}`, AdditionalMetricsCollector.name)
    }
  }

  private async collectWsConnections() {
    try {
      if (this.wsConnectionCountFn) {
        const count = await this.wsConnectionCountFn()
        this.wsConnectionsGauge.set(count)
      }
    } catch (error) {
      this.logger?.warn?.(`Failed to collect ws connection metrics: ${error}`, AdditionalMetricsCollector.name)
    }
  }
}
