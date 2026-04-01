import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

const DEFAULT_PRISMA_CONNECTION_LIMIT = 15
const DEFAULT_PRISMA_POOL_TIMEOUT_SECONDS = 20
const DEFAULT_PRISMA_CONNECT_TIMEOUT_SECONDS = 10
const DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000
const DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS = 30_000

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
  constructor() {
    const datasourceUrl = buildPrismaDatasourceUrl(process.env.DATABASE_URL)

    super({
      ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
      transactionOptions: {
        maxWait: readPositiveIntegerEnv('PRISMA_TRANSACTION_MAX_WAIT_MS', DEFAULT_PRISMA_TRANSACTION_MAX_WAIT_MS),
        timeout: readPositiveIntegerEnv('PRISMA_TRANSACTION_TIMEOUT_MS', DEFAULT_PRISMA_TRANSACTION_TIMEOUT_MS),
      },
    })
  }

  /** 应用启动时由 NestJS 的模块初始化流程调用，建立 PostgreSQL 连接池。 */
  async onModuleInit() {
    await this.$connect()
  }

  /** 应用关闭时由 NestJS 的模块销毁流程调用，优雅地释放数据库连接。 */
  async onModuleDestroy() {
    await this.$disconnect()
  }
}

function buildPrismaDatasourceUrl(databaseUrl?: string): string | undefined {
  if (!databaseUrl) {
    return undefined
  }

  const url = new URL(databaseUrl)
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

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
