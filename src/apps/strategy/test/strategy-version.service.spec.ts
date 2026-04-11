/**
 * StrategyService — 版本管理功能单元测试（OPT-2.4）
 *
 * 覆盖要点：
 * - update: strategyConfig 变更时创建 StrategyVersion 快照
 * - listVersions: 策略不存在抛异常、正常返回历史版本+当前版本
 * - compareVersions: 策略不存在抛异常、versionA >= versionB 抛异常
 * - compareVersions: 正确解析版本配置、diff、关联回测指标
 */
import { BusinessException } from 'src/common/exceptions/business.exception'
import { StrategyService } from '../strategy.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildStrategy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'strat-1',
    userId: 1,
    name: '测试策略',
    description: null,
    strategyType: 'FACTOR_RANKING',
    strategyConfig: { topN: 20, threshold: 0.5 },
    backtestDefaults: null,
    tags: [],
    version: 3,
    isPublic: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    ...overrides,
  }
}

function buildPrismaMock() {
  return {
    strategy: {
      create: jest.fn(),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(async () => 0),
    },
    strategyVersion: {
      create: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(),
    },
    backtestRun: {
      findFirst: jest.fn(async () => null),
    },
  }
}

function buildSchemaValidatorMock() {
  return {
    validate: jest.fn((type: string, config: Record<string, unknown>) => config),
    getAllSchemas: jest.fn(() => []),
  }
}

function createService(
  prisma = buildPrismaMock(),
  schemaValidator = buildSchemaValidatorMock(),
): StrategyService {
  const backtestRunService = { createRun: jest.fn() }
  // @ts-ignore 局部 mock，绕过 NestJS DI
  return new StrategyService(prisma as any, backtestRunService as any, schemaValidator as any)
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategyService — 版本管理 (OPT-2.4)', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── update() 版本快照 ────────────────────────────────────────────────────

  describe('update() 版本快照', () => {
    it('strategyConfig 未变更时 → 不创建 StrategyVersion 快照', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.update.mockResolvedValue(buildStrategy())
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', name: '新名称' })

      expect(prisma.strategyVersion.create).not.toHaveBeenCalled()
    })

    it('strategyConfig 变更时 → 快照旧版本到 StrategyVersion', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 2 }))
      prisma.strategy.update.mockResolvedValue(buildStrategy({ version: 3 }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 30, threshold: 0.6 } })

      expect(prisma.strategyVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            strategyId: 'strat-1',
            version: 2, // 保存旧版本号
          }),
        }),
      )
    })
  })

  // ── listVersions() ───────────────────────────────────────────────────────

  describe('listVersions()', () => {
    it('策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.listVersions(1, 'no-strat')).rejects.toThrow(BusinessException)
    })

    it('无历史快照时 → 只返回当前版本（isCurrent=true）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 1 }))
      prisma.strategyVersion.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.listVersions(1, 'strat-1')

      expect(result).toHaveLength(1)
      expect(result[0].version).toBe(1)
      expect(result[0].isCurrent).toBe(true)
    })

    it('有 2 个历史快照 + 当前版本 → 返回 3 条，当前版本 isCurrent=true', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 3 }))
      prisma.strategyVersion.findMany.mockResolvedValue([
        { version: 1, strategyConfig: { topN: 10 }, backtestDefaults: null, changelog: null, createdAt: new Date('2025-01-01') },
        { version: 2, strategyConfig: { topN: 15 }, backtestDefaults: null, changelog: null, createdAt: new Date('2025-03-01') },
      ])
      const svc = createService(prisma)

      const result = await svc.listVersions(1, 'strat-1')

      expect(result).toHaveLength(3)
      const current = result.find((r) => r.isCurrent)
      expect(current?.version).toBe(3)
      expect(result[0].isCurrent).toBe(false)
    })
  })

  // ── compareVersions() ────────────────────────────────────────────────────

  describe('compareVersions()', () => {
    it('策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.compareVersions(1, { strategyId: 'x', versionA: 1, versionB: 2 })).rejects.toThrow(
        BusinessException,
      )
    })

    it('versionA >= versionB → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      const svc = createService(prisma)

      await expect(svc.compareVersions(1, { strategyId: 'strat-1', versionA: 2, versionB: 2 })).rejects.toThrow(
        BusinessException,
      )
    })

    it('版本 A 不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 3 }))
      prisma.strategyVersion.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.compareVersions(1, { strategyId: 'strat-1', versionA: 1, versionB: 3 })).rejects.toThrow(
        BusinessException,
      )
    })

    it('正常比较两版本 → diff 正确、metricsA/B 为 null（无回测记录）', async () => {
      const prisma = buildPrismaMock()
      const strategyV3 = buildStrategy({ version: 3, strategyConfig: { topN: 30, threshold: 0.6 } })
      prisma.strategy.findFirst.mockResolvedValue(strategyV3)
      prisma.strategyVersion.findUnique.mockResolvedValue({
        strategyConfig: { topN: 20, threshold: 0.5 },
        backtestDefaults: null,
      })
      // metricsA/B → no run found
      prisma.backtestRun.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      const result = await svc.compareVersions(1, { strategyId: 'strat-1', versionA: 2, versionB: 3 })

      expect(result.versionA).toBe(2)
      expect(result.versionB).toBe(3)
      // configA = strategyVersion snapshot (topN=20), configB = current (topN=30)
      expect(result.configA.topN).toBe(20)
      expect(result.configB.topN).toBe(30)
      // diff: topN 20→30, threshold 0.5→0.6
      expect(result.diff).toHaveLength(2)
      expect(result.diff.every((d) => d.changeType === 'CHANGED')).toBe(true)
      expect(result.metricsA).toBeNull()
      expect(result.metricsB).toBeNull()
    })

    it('找到关联回测 → metricsA 包含 runId 和指标', async () => {
      const prisma = buildPrismaMock()
      const strategyV2 = buildStrategy({ version: 2, strategyConfig: { topN: 30 } })
      prisma.strategy.findFirst.mockResolvedValue(strategyV2)
      prisma.strategyVersion.findUnique.mockResolvedValue({
        strategyConfig: { topN: 20 },
        backtestDefaults: null,
      })
      prisma.backtestRun.findFirst
        .mockResolvedValueOnce({
          id: 'run-a',
          totalReturn: 0.15,
          annualizedReturn: 0.12,
          sharpeRatio: 1.2,
          maxDrawdown: -0.08,
          sortinoRatio: 1.8,
        })
        .mockResolvedValueOnce({
          id: 'run-b',
          totalReturn: 0.20,
          annualizedReturn: 0.16,
          sharpeRatio: 1.5,
          maxDrawdown: -0.06,
          sortinoRatio: 2.1,
        })
      const svc = createService(prisma)

      const result = await svc.compareVersions(1, { strategyId: 'strat-1', versionA: 1, versionB: 2 })

      expect(result.metricsA?.runId).toBe('run-a')
      expect(result.metricsA?.sharpeRatio).toBe(1.2)
      expect(result.metricsB?.runId).toBe('run-b')
      expect(result.metricsB?.totalReturn).toBe(0.20)
    })
  })
})
