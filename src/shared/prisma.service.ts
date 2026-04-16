import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import type { Counter, Histogram } from 'prom-client'
import { LoggerService } from './logger/logger.service'
import { PRISMA_QUERY_DURATION_TOKEN, PRISMA_QUERY_TOTAL_TOKEN } from './metrics/metrics.constants'

const DEFAULT_PRISMA_CONNECTION_LIMIT = 30
const DEFAULT_PRISMA_POOL_TIMEOUT_SECONDS = 20
const DEFAULT_PRISMA_CONNECT_TIMEOUT_SECONDS = 10
const DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000
const DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS = 30_000

const SLOW_QUERY_THRESHOLD_MS = readPositiveIntegerEnv('PRISMA_SLOW_QUERY_THRESHOLD_MS', 500)

/**
 * PrismaService — 数据库访问层的核心服务。
 *
 * 继承 PrismaClient 并与 NestJS 生命周期集成：
 *   - 模块初始化时自动建立数据库连接
 *   - 模块销毁时自动断开连接，避免连接泄漏
 *
 * 本服务通过 SharedModule（@Global）全局注册，无需在各功能模块中重复导入。
 * 使用方式：在构造函数中注入 PrismaService，然后通过 this.prisma.<model> 访问数据。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly logger: LoggerService,
    @Optional() @Inject(PRISMA_QUERY_DURATION_TOKEN) private readonly queryDuration?: Histogram,
    @Optional() @Inject(PRISMA_QUERY_TOTAL_TOKEN) private readonly queryTotal?: Counter,
  ) {
    const metricsEnabled = !!queryDuration || !!queryTotal
    const datasourceUrl = buildPrismaDatasourceUrl(process.env.DATABASE_URL)

    super({
      ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
      transactionOptions: {
        maxWait: readPositiveIntegerEnv('PRISMA_TRANSACTION_MAX_WAIT_MS', DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS),
        timeout: readPositiveIntegerEnv('PRISMA_TRANSACTION_TIMEOUT_MS', DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS),
      },
      ...(metricsEnabled ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}),
    })
  }

  /** 应用启动时由 NestJS 的模块初始化流程调用，建立 PostgreSQL 连接池。 */
  async onModuleInit() {
    // Prisma v6 移除了 $use；改用 $on('query') 监听查询事件
    if (this.queryDuration || this.queryTotal) {
      // Prisma v6: $on is available when log emit is configured.
      // Cast to unknown first to satisfy TypeScript's strict type-check.
      ;(this as unknown as { $on(event: string, cb: (e: { duration: number; query: string }) => void): void }).$on(
        'query',
        (e: { duration: number; query: string }) => {
          this.recordQueryMetrics(e.duration)
        },
      )
    }

    await this.$connect()
  }

  /** 应用关闭时由 NestJS 的模块销毁流程调用，优雅地释放数据库连接。 */
  async onModuleDestroy() {
    await this.$disconnect()
  }

  private recordQueryMetrics(durationMs: number) {
    const durationSec = durationMs / 1000

    this.queryDuration?.observe(durationSec)
    this.queryTotal?.inc()

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      this.logger.warn(
        {
          message: `慢查询检测: 耗时 ${durationMs.toFixed(1)}ms`,
          durationMs: Math.round(durationMs),
          threshold: SLOW_QUERY_THRESHOLD_MS,
        },
        'PrismaSlowQuery',
      )
    }
  }
}

/** @internal Exported for unit testing only */
export function buildPrismaDatasourceUrl(databaseUrl?: string): string | undefined {
  if (!databaseUrl) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error(
      `DATABASE_URL 格式无效，无法解析连接池参数。请检查 .env 中的 DATABASE_URL 是否包含正确的协议头（如 postgresql://）。`,
    )
  }

  setSearchParamIfMissing(
    url,
    'connection_limit',
    readPositiveIntegerEnv('PRISMA_CONNECTION_LIMIT', DEFAULT_PRISMA_CONNECTION_LIMIT).toString(),
  )
  setSearchParamIfMissing(
    url,
    'pool_timeout',
    readPositiveIntegerEnv('PRISMA_POOL_TIMEOUT', DEFAULT_PRISMA_POOL_TIMEOUT_SECONDS).toString(),
  )
  setSearchParamIfMissing(
    url,
    'connect_timeout',
    readPositiveIntegerEnv('PRISMA_CONNECT_TIMEOUT', DEFAULT_PRISMA_CONNECT_TIMEOUT_SECONDS).toString(),
  )

  return url.toString()
}

function setSearchParamIfMissing(url: URL, key: string, value: string) {
  if (!url.searchParams.has(key)) {
    url.searchParams.set(key, value)
  }
}

/** @internal Exported for unit testing only */
export function readPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
