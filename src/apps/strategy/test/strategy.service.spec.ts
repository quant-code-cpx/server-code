/**
 * StrategyService — 单元测试
 *
 * 覆盖要点：
 * - create: 策略上限、标签上限、重复名称、schema 校验失败
 * - list: 分页结构、strategyType 过滤、keyword 过滤
 * - detail: 找到返回、找不到抛 BusinessException
 * - update: 找不到抛异常、成功调用 prisma.update
 * - delete: 找不到抛异常、成功调用 prisma.delete
 * - clone: 新名称格式、策略上限保护
 * - run: 调用 backtestRunService.createRun
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
    strategyConfig: { topN: 20 },
    backtestDefaults: null,
    tags: [],
    version: 1,
    isPublic: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
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
      findFirst: jest.fn(async () => null),
    },
  }
}

function buildBacktestRunServiceMock() {
  return { createRun: jest.fn() }
}

function buildSchemaValidatorMock() {
  return {
    validate: jest.fn((type: string, config: Record<string, unknown>) => config),
    getAllSchemas: jest.fn(() => []),
  }
}

function createService(
  prisma = buildPrismaMock(),
  backtestRunService = buildBacktestRunServiceMock(),
  schemaValidator = buildSchemaValidatorMock(),
): StrategyService {
  // @ts-ignore 局部 mock，绕过依赖注入
  return new StrategyService(prisma as any, backtestRunService as any, schemaValidator as any)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('StrategyService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('正常创建 → 调用 prisma.strategy.create', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(0)
      const created = buildStrategy()
      prisma.strategy.create.mockResolvedValue(created)
      const svc = createService(prisma)

      const result = await svc.create(1, {
        name: '测试策略',
        strategyType: 'FACTOR_RANKING',
        strategyConfig: { topN: 20 },
      })

      expect(prisma.strategy.create).toHaveBeenCalled()
      expect(result).toHaveProperty('id', 'strat-1')
    })

    it('count >= 50 时抛 BusinessException（STRATEGY_LIMIT_EXCEEDED）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(50)
      const svc = createService(prisma)

      await expect(
        svc.create(1, { name: '策略', strategyType: 'FACTOR_RANKING', strategyConfig: {} }),
      ).rejects.toThrow(BusinessException)
    })

    it('标签数量 > 10 时抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`)
      await expect(
        svc.create(1, { name: '策略', strategyType: 'FACTOR_RANKING', strategyConfig: {}, tags }),
      ).rejects.toThrow(BusinessException)
    })

    it('名称重复（P2002）→ 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(0)
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      prisma.strategy.create.mockRejectedValue(p2002)
      const svc = createService(prisma)

      await expect(
        svc.create(1, { name: '重复名称', strategyType: 'FACTOR_RANKING', strategyConfig: {} }),
      ).rejects.toThrow(BusinessException)
    })

    it('schema 校验失败 → 抛出错误', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(0)
      const schemaValidator = buildSchemaValidatorMock()
      schemaValidator.validate.mockImplementation(() => {
        throw new BusinessException('策略配置不合法')
      })
      const svc = createService(prisma, buildBacktestRunServiceMock(), schemaValidator)

      await expect(
        svc.create(1, { name: '策略', strategyType: 'FACTOR_RANKING', strategyConfig: { bad: true } }),
      ).rejects.toThrow(BusinessException)
    })
  })

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('返回 { strategies, total, page, pageSize }', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findMany.mockResolvedValue([buildStrategy()])
      prisma.strategy.count.mockResolvedValue(1)
      const svc = createService(prisma)

      const result = await svc.list(1, { page: 1, pageSize: 20 })

      expect(result).toHaveProperty('strategies')
      expect(result).toHaveProperty('total', 1)
      expect(result).toHaveProperty('page', 1)
      expect(result).toHaveProperty('pageSize', 20)
    })

    it('按 strategyType 过滤时 where 中包含 strategyType', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findMany.mockResolvedValue([])
      prisma.strategy.count.mockResolvedValue(0)
      const svc = createService(prisma)

      await svc.list(1, { strategyType: 'FACTOR_RANKING' })

      const callArgs = (prisma.strategy.findMany.mock.calls as any)[0][0]
      expect(callArgs.where).toHaveProperty('strategyType', 'FACTOR_RANKING')
    })

    it('按 keyword 过滤时 where.OR 被设置', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findMany.mockResolvedValue([])
      prisma.strategy.count.mockResolvedValue(0)
      const svc = createService(prisma)

      await svc.list(1, { keyword: '动量' })

      const callArgs = (prisma.strategy.findMany.mock.calls as any)[0][0]
      expect(callArgs.where).toHaveProperty('OR')
      expect(Array.isArray(callArgs.where.OR)).toBe(true)
    })
  })

  // ── detail() ──────────────────────────────────────────────────────────────

  describe('detail()', () => {
    it('找到策略 → 返回策略对象', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      const svc = createService(prisma)

      const result = await svc.detail(1, 'strat-1')
      expect(result).toHaveProperty('id', 'strat-1')
    })

    it('找不到 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.detail(1, 'nonexistent')).rejects.toThrow(BusinessException)
    })
  })

  // ── update() ──────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.update(1, { id: 'nonexistent', name: '新名' })).rejects.toThrow(BusinessException)
    })

    it('成功更新 → 调用 prisma.strategy.update', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      const updated = buildStrategy({ name: '新名称' })
      prisma.strategy.update.mockResolvedValue(updated)
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', name: '新名称' })

      expect(prisma.strategy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'strat-1' } }),
      )
    })

    it('更新 strategyConfig 时调用 schemaValidator.validate', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.update.mockResolvedValue(buildStrategy())
      const schemaValidator = buildSchemaValidatorMock()
      const svc = createService(prisma, buildBacktestRunServiceMock(), schemaValidator)

      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 30 } })

      expect(schemaValidator.validate).toHaveBeenCalled()
    })
  })

  // ── delete() ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.delete(1, 'nonexistent')).rejects.toThrow(BusinessException)
    })

    it('成功删除 → 调用 prisma.strategy.delete', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.delete.mockResolvedValue(buildStrategy())
      const svc = createService(prisma)

      await svc.delete(1, 'strat-1')

      expect(prisma.strategy.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'strat-1' } }),
      )
    })
  })

  // ── clone() ───────────────────────────────────────────────────────────────

  describe('clone()', () => {
    it('无 newName 时新策略名称格式为 "<原名> (副本)"', async () => {
      const source = buildStrategy({ name: '原始策略' })
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(source)
      prisma.strategy.count.mockResolvedValue(0)
      const cloned = buildStrategy({ id: 'strat-2', name: '原始策略 (副本)' })
      prisma.strategy.create.mockResolvedValue(cloned)
      const svc = createService(prisma)

      const result = await svc.clone(1, 'strat-1')

      const createCall = prisma.strategy.create.mock.calls[0][0]
      expect(createCall.data.name).toBe('原始策略 (副本)')
      expect(result).toHaveProperty('id', 'strat-2')
    })

    it('指定 newName 时使用自定义名称', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ name: '原始策略' }))
      prisma.strategy.count.mockResolvedValue(0)
      prisma.strategy.create.mockResolvedValue(buildStrategy({ name: '自定义名称' }))
      const svc = createService(prisma)

      await svc.clone(1, 'strat-1', '自定义名称')

      const createCall = prisma.strategy.create.mock.calls[0][0]
      expect(createCall.data.name).toBe('自定义名称')
    })

    it('源策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.clone(1, 'nonexistent')).rejects.toThrow(BusinessException)
    })

    it('用户策略数量已达上限 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.count.mockResolvedValue(50)
      const svc = createService(prisma)

      await expect(svc.clone(1, 'strat-1')).rejects.toThrow(BusinessException)
    })
  })

  // ── run() ─────────────────────────────────────────────────────────────────

  describe('run()', () => {
    const runDto = {
      strategyId: 'strat-1',
      startDate: '20230101',
      endDate: '20231231',
      initialCapital: 1_000_000,
    }

    it('策略不存在 → 抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.run(1, runDto)).rejects.toThrow(BusinessException)
    })

    it('成功 → 调用 backtestRunService.createRun 并传入正确参数', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      const backtestRunService = buildBacktestRunServiceMock()
      backtestRunService.createRun.mockResolvedValue({
        runId: 'run-1',
        jobId: 'job-1',
        status: 'QUEUED',
      })
      const svc = createService(prisma, backtestRunService)

      const result = await svc.run(1, runDto)

      expect(backtestRunService.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyType: 'FACTOR_RANKING',
          startDate: '20230101',
          endDate: '20231231',
          initialCapital: 1_000_000,
        }),
        1,
      )
      expect(result).toHaveProperty('runId', 'run-1')
    })
  })

  // ── getSchemas() ──────────────────────────────────────────────────────────

  describe('getSchemas()', () => {
    it('委托给 schemaValidator.getAllSchemas', () => {
      const schemaValidator = buildSchemaValidatorMock()
      schemaValidator.getAllSchemas.mockReturnValue([{ type: 'FACTOR_RANKING', schema: {} }])
      const svc = createService(buildPrismaMock(), buildBacktestRunServiceMock(), schemaValidator)

      const result = svc.getSchemas()

      expect(schemaValidator.getAllSchemas).toHaveBeenCalled()
      expect(result).toHaveLength(1)
    })
  })
})
