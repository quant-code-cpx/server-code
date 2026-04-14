import { HealthCheckError, HealthCheckService, HealthIndicatorStatus } from '@nestjs/terminus'
import { PrismaHealthIndicator } from '../prisma.health'
import { RedisHealthIndicator } from '../redis.health'
import { HealthController } from '../health.controller'
import { PrismaService } from '../../prisma.service'

// ── PrismaHealthIndicator ─────────────────────────────────────────────────────

describe('PrismaHealthIndicator', () => {
  let mockPrisma: jest.Mocked<Pick<PrismaService, '$queryRaw'>>
  let indicator: PrismaHealthIndicator

  beforeEach(() => {
    mockPrisma = { $queryRaw: jest.fn() } as unknown as jest.Mocked<Pick<PrismaService, '$queryRaw'>>
    indicator = new PrismaHealthIndicator(mockPrisma as unknown as PrismaService)
  })

  it('[BIZ] SELECT 1 成功 → 返回 { database: { status: "up" } }', async () => {
    ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }])

    const result = await indicator.isHealthy('database')

    expect(result.database.status).toBe<HealthIndicatorStatus>('up')
  })

  it('[ERR] SELECT 1 失败（连接拒绝）→ 抛出 HealthCheckError', async () => {
    ;(mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('connection refused'))

    await expect(indicator.isHealthy('database')).rejects.toThrow(HealthCheckError)
  })

  it('[ERR] HealthCheckError 的 causes 包含错误信息', async () => {
    ;(mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'))

    const err = await indicator.isHealthy('database').catch((e) => e as HealthCheckError)

    expect(err).toBeInstanceOf(HealthCheckError)
    // HealthCheckError.causes 包含 indicator result
    const causes = (err as HealthCheckError).causes as Record<string, { status: string; message?: string }>
    expect(causes.database.status).toBe('down')
    expect(causes.database.message).toBe('ECONNREFUSED')
  })
})

// ── RedisHealthIndicator ──────────────────────────────────────────────────────

describe('RedisHealthIndicator', () => {
  let mockRedis: { ping: jest.Mock }
  let indicator: RedisHealthIndicator

  beforeEach(() => {
    mockRedis = { ping: jest.fn() }
    indicator = new RedisHealthIndicator(mockRedis as never)
  })

  it('[BIZ] PING → 响应 "PONG" → 返回 { redis: { status: "up" } }', async () => {
    mockRedis.ping.mockResolvedValue('PONG')

    const result = await indicator.isHealthy('redis')

    expect(result.redis.status).toBe<HealthIndicatorStatus>('up')
  })

  it('[EDGE] PING → 响应非 "PONG"（如 "LOADING"）→ 抛出 HealthCheckError', async () => {
    // Redis 在持久化/加载时会返回 LOADING 而非 PONG
    mockRedis.ping.mockResolvedValue('LOADING')

    await expect(indicator.isHealthy('redis')).rejects.toThrow(HealthCheckError)
  })

  it('[ERR] PING 超时抛出异常 → HealthCheckError', async () => {
    mockRedis.ping.mockRejectedValue(new Error('timeout'))

    const err = await indicator.isHealthy('redis').catch((e) => e as HealthCheckError)

    expect(err).toBeInstanceOf(HealthCheckError)
    const causes = (err as HealthCheckError).causes as Record<string, { status: string; message?: string }>
    expect(causes.redis.status).toBe('down')
    expect(causes.redis.message).toBe('timeout')
  })

  it('[ERR] "LOADING" 响应时 HealthCheckError 包含具体错误信息', async () => {
    mockRedis.ping.mockResolvedValue('LOADING')

    const err = await indicator.isHealthy('redis').catch((e) => e as HealthCheckError)

    expect(err).toBeInstanceOf(HealthCheckError)
    const causes = (err as HealthCheckError).causes as Record<string, { status: string; message?: string }>
    expect(causes.redis.message).toContain('LOADING')
  })
})

// ── HealthController ──────────────────────────────────────────────────────────

describe('HealthController', () => {
  let mockHealth: { check: jest.Mock }
  let mockPrismaHealth: { isHealthy: jest.Mock }
  let mockRedisHealth: { isHealthy: jest.Mock }
  let controller: HealthController

  beforeEach(() => {
    mockHealth = { check: jest.fn().mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} }) }
    mockPrismaHealth = { isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }) }
    mockRedisHealth = { isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }) }
    controller = new HealthController(
      mockHealth as unknown as HealthCheckService,
      mockPrismaHealth as unknown as PrismaHealthIndicator,
      mockRedisHealth as unknown as RedisHealthIndicator,
    )
  })

  it('[BIZ] liveness → 调用 health.check([])，无 indicator 检查', async () => {
    await controller.liveness()

    expect(mockHealth.check).toHaveBeenCalledWith([])
    expect(mockPrismaHealth.isHealthy).not.toHaveBeenCalled()
    expect(mockRedisHealth.isHealthy).not.toHaveBeenCalled()
  })

  it('[BIZ] readiness → health.check 传入两个 indicator 函数', async () => {
    await controller.readiness()

    expect(mockHealth.check).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
    )
    expect(mockHealth.check.mock.calls[0][0]).toHaveLength(2)
  })

  it('[BIZ] readiness indicator 函数调用 prismaHealth.isHealthy("database")', async () => {
    const checkArgs = jest.fn(async (indicators: (() => Promise<unknown>)[]) => {
      // 调用所有 indicator 函数
      for (const indicator of indicators) await indicator()
      return { status: 'ok' }
    })
    mockHealth.check = checkArgs

    await controller.readiness()

    expect(mockPrismaHealth.isHealthy).toHaveBeenCalledWith('database')
    expect(mockRedisHealth.isHealthy).toHaveBeenCalledWith('redis')
  })
})
