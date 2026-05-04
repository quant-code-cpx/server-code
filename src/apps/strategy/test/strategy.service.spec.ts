/**
 * StrategyService — 单元测试
 *
 * 覆盖要点：
 * - create: 策略上限、标签上限、重复名称、schema 校验失败
 * - list: 分页结构、strategyType 过滤、keyword 过滤
 * - detail: 找到返回、找不到抛 BusinessException
 * - update: 找不到抛异常、成功调用 prisma.update；更新 config 时 version 自增 + 存快照
 * - delete: 找不到抛异常、成功调用 prisma.delete
 * - clone: 新名称格式、策略上限保护、名称冲突（P2002）、私有策略越权克隆
 * - run: 调用 backtestRunService.createRun
 * Phase 2 新增：[BIZ] count=49 时可创建第 50 个；[SEC] 跨用户克隆私有策略；
 *               [BIZ] 更新 config 时 version+1 + 写快照；[BIZ] 克隆时名称冲突返回 BusinessException
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
  const mock = {
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
      findUnique: jest.fn(async () => null),
    },
    backtestRun: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
    },
    tradingSignal: {
      count: jest.fn(async () => 0),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  }
  return mock
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

      await expect(svc.create(1, { name: '策略', strategyType: 'FACTOR_RANKING', strategyConfig: {} })).rejects.toThrow(
        BusinessException,
      )
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

      expect(prisma.strategy.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'strat-1' } }))
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

      expect(prisma.strategy.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'strat-1' } }))
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

  // ── Phase 2 新增：边界、越权、版本控制 ────────────────────────────────────

  describe('[BIZ] create() — off-by-one 边界', () => {
    it('[BIZ] count=49 时可成功创建第 50 个策略', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(49) // 49 < 50，应通过
      const created = buildStrategy({ name: '第50个' })
      prisma.strategy.create.mockResolvedValue(created)
      const svc = createService(prisma)

      const result = await svc.create(1, { name: '第50个', strategyType: 'FACTOR_RANKING', strategyConfig: {} })

      expect(result).toHaveProperty('id', 'strat-1')
      expect(prisma.strategy.create).toHaveBeenCalledTimes(1)
    })

    it('[BIZ] count=50 时创建第 51 个策略应抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.count.mockResolvedValue(50)
      const svc = createService(prisma)

      await expect(
        svc.create(1, { name: '第51个', strategyType: 'FACTOR_RANKING', strategyConfig: {} }),
      ).rejects.toThrow(BusinessException)
      expect(prisma.strategy.create).not.toHaveBeenCalled()
    })
  })

  describe('[BIZ] update() — config 变更时版本号自增并写快照', () => {
    it('[BIZ] 更新 strategyConfig 时 version 自增 1 并调用 strategyVersion.create', async () => {
      const prisma = buildPrismaMock()
      const strategy = buildStrategy({ version: 3, strategyConfig: { topN: 20 } })
      prisma.strategy.findFirst.mockResolvedValue(strategy)
      prisma.strategy.update.mockResolvedValue(buildStrategy({ version: 4 }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 30 } })

      // 应写入版本快照
      expect(prisma.strategyVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            strategyId: 'strat-1',
            version: 3, // 旧版本号存入快照
          }),
        }),
      )
      // 应自增版本
      expect(prisma.strategy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        }),
      )
    })

    it('[BIZ] 只更新 name（不更新 config）时不写版本快照', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.update.mockResolvedValue(buildStrategy({ name: '新名' }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', name: '新名' })

      expect(prisma.strategyVersion.create).not.toHaveBeenCalled()
      expect(prisma.strategy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ version: { increment: 1 } }),
        }),
      )
    })
  })

  describe('[SEC] clone() — 越权与名称冲突', () => {
    it('[SEC] 克隆其他用户的私有策略（非公开）应抛 BusinessException', async () => {
      const prisma = buildPrismaMock()
      // findFirst 查询条件：userId=1 OR isPublic=true；userId=2 的私有策略返回 null
      prisma.strategy.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      // userId=1 试图克隆 userId=2 的私有策略
      await expect(svc.clone(1, 'strat-other-user')).rejects.toThrow(BusinessException)
    })

    it('[BIZ] 公开策略可被任意用户克隆', async () => {
      const prisma = buildPrismaMock()
      const publicStrategy = buildStrategy({ userId: 2, isPublic: true, name: '公开策略' })
      prisma.strategy.findFirst.mockResolvedValue(publicStrategy)
      prisma.strategy.count.mockResolvedValue(0)
      prisma.strategy.create.mockResolvedValue(buildStrategy({ id: 'new-clone' }))
      const svc = createService(prisma)

      const result = await svc.clone(1, 'strat-public')

      expect(result).toHaveProperty('id', 'new-clone')
    })

    it('[BIZ] 克隆时名称与现有策略冲突（P2002）→ 抛 BusinessException（STRATEGY_NAME_EXISTS）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ name: '策略A' }))
      prisma.strategy.count.mockResolvedValue(1)
      const p2002 = Object.assign(new Error('Unique constraint violated'), { code: 'P2002' })
      prisma.strategy.create.mockRejectedValue(p2002)
      const svc = createService(prisma)

      await expect(svc.clone(1, 'strat-1', '策略A')).rejects.toThrow(BusinessException)
    })

    it('[BIZ] 克隆时策略数量恰好到达上限（count=49→50 成功）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      prisma.strategy.count.mockResolvedValue(49) // 49 < 50，应允许
      prisma.strategy.create.mockResolvedValue(buildStrategy({ id: 'clone-50' }))
      const svc = createService(prisma)

      const result = await svc.clone(1, 'strat-1')
      expect(result).toHaveProperty('id', 'clone-50')
    })
  })

  // ── backtestDefaults 变更现在留版本痕迹（B11 已修复）───────────────────────

  describe('[B11] update() — backtestDefaults 变更写版本快照（已修复）', () => {
    it('只更新 backtestDefaults 时写版本快照并递增 version', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 2 }))
      prisma.strategy.update.mockResolvedValue(
        buildStrategy({ version: 3, backtestDefaults: { benchmarkTsCode: '399001.SZ' } }),
      )
      const svc = createService(prisma)

      await svc.update(1, {
        id: 'strat-1',
        backtestDefaults: { benchmarkTsCode: '399001.SZ' },
        // strategyConfig 未传
      })

      // 修复后：backtestDefaults 变更也写快照并递增版本
      expect(prisma.strategyVersion.create).toHaveBeenCalledTimes(1)
      const updateCall = (prisma.strategy.update.mock.calls as any)[0][0]
      expect(updateCall.data).toHaveProperty('version', { increment: 1 })
    })
  })

  // ── Phase 2：compareVersions 边界 ────────────────────────────────────────

  // 业务规则：versionA 必须 < versionB，版本号必须存在
  // diffConfigs 必须正确识别新增/删除/变更字段

  describe('[BIZ] compareVersions() — 版本对比边界', () => {
    it('[BIZ] versionA >= versionB 时抛出 BusinessException', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 5 }))
      const svc = createService(prisma)

      // versionA === versionB
      await expect(svc.compareVersions(1, { strategyId: 'strat-1', versionA: 3, versionB: 3 })).rejects.toThrow(
        BusinessException,
      )

      // versionA > versionB
      await expect(svc.compareVersions(1, { strategyId: 'strat-1', versionA: 4, versionB: 2 })).rejects.toThrow(
        BusinessException,
      )
    })

    it('[BIZ] versionA 对应快照不存在时抛出 BusinessException', async () => {
      const prisma = buildPrismaMock()
      // strategy.version=5，所以 versionB=5 直接用 strategyConfig，不查 DB
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 5, strategyConfig: { topN: 30 } }))
      // versionA=1 的快照不存在
      ;(prisma as any).strategyVersion = {
        ...prisma.strategyVersion,
        findUnique: jest.fn(async () => null), // version=1 快照不存在
      }
      ;(prisma as any).backtestRun = { findFirst: jest.fn(async () => null) }
      const svc = createService(prisma)

      // versionA=1 < versionB=5 满足顺序要求，但 version=1 的快照不存在
      await expect(svc.compareVersions(1, { strategyId: 'strat-1', versionA: 1, versionB: 5 })).rejects.toThrow(
        BusinessException,
      )
    })
  })

  // ── Phase 2：diffConfigs 语义验证 ─────────────────────────────────────────

  // 业务规则：diff 应正确识别 3 种变更类型
  // ADDED：只在 B 中存在；REMOVED：只在 A 中存在；CHANGED：两者都有但值不同

  describe('[BIZ] diffConfigs() — diff 语义', () => {
    it('[BIZ] 新增字段 → ADDED；无变化字段 → 不在 diff 中', () => {
      const svc = createService()
      const configA = { topN: 20, factor: 'pe' }
      const configB = { topN: 20, factor: 'pe', newFlag: true }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diff = (svc as any).diffConfigs(configA, configB)

      // 手算：topN 和 factor 未变 → 不在 diff；newFlag 新增 → ADDED
      expect(diff).toHaveLength(1)
      expect(diff[0]).toMatchObject({ path: 'newFlag', changeType: 'ADDED', newValue: true })
    })

    it('[BIZ] 删除字段 → REMOVED；修改字段 → CHANGED', () => {
      const svc = createService()
      const configA = { topN: 20, factor: 'pe', oldField: 'x' }
      const configB = { topN: 30, factor: 'pe' }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diff = (svc as any).diffConfigs(configA, configB)

      // 手算：topN 20→30 CHANGED；oldField 被删 REMOVED；factor 未变不在 diff
      expect(diff).toHaveLength(2)
      const changed = diff.find((d: { changeType: string }) => d.changeType === 'CHANGED')
      const removed = diff.find((d: { changeType: string }) => d.changeType === 'REMOVED')
      expect(changed).toMatchObject({ path: 'topN', oldValue: 20, newValue: 30 })
      expect(removed).toMatchObject({ path: 'oldField', oldValue: 'x', newValue: undefined })
    })

    it('[BIZ] 嵌套对象通过 JSON.stringify 比较，整体嵌套变更算 CHANGED', () => {
      const svc = createService()
      const configA = { filters: { minMV: 10, maxPE: 50 } }
      const configB = { filters: { minMV: 20, maxPE: 50 } } // 内层 minMV 变化

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diff = (svc as any).diffConfigs(configA, configB)

      // 手算：JSON.stringify({ minMV:10, maxPE:50 }) != JSON.stringify({ minMV:20, maxPE:50 })
      // → filters CHANGED
      expect(diff).toHaveLength(1)
      expect(diff[0].changeType).toBe('CHANGED')
      expect(diff[0].path).toBe('filters')
    })

    it('[BIZ] 两个完全相同的 config → diff 为空数组', () => {
      const svc = createService()
      const config = { topN: 20, rebalance: 'MONTHLY' }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diff = (svc as any).diffConfigs(config, { ...config })

      expect(diff).toHaveLength(0)
    })
  })

  // ── Phase 2：update tags 边界 ────────────────────────────────────────────

  // 业务规则：tags 最多 10 个，空数组合法（清空标签）

  describe('[BIZ] update() — tags 边界', () => {
    it('[BIZ] tags.length = 11 时抛出 BusinessException（标签最多 10 个）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy())
      const svc = createService(prisma)

      await expect(svc.update(1, { id: 'strat-1', tags: Array(11).fill('tag') })).rejects.toThrow(BusinessException)
    })

    it('[BIZ] tags = [] 清空标签时应正常调用 prisma.strategy.update', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ tags: ['old-tag'] }))
      prisma.strategy.update.mockResolvedValue(buildStrategy({ tags: [] }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', tags: [] })

      const updateCall = (prisma.strategy.update.mock.calls as any)[0][0]
      expect(updateCall.data.tags).toEqual([])
    })
  })

  // ── 版本快照在事务内执行（B5 已修复）────────────────────────────────────
  //
  // 修复后：findFirst + strategyVersion.create + strategy.update 在同一 $transaction 内。
  // 单元测试中 $transaction 是 pass-through mock，无法模拟真实数据库串行化，
  // 但可验证快照和递增在同一回调中执行（不会因 OOM 等原因出现半写状态）。

  describe('[B5] update() — 版本快照+递增在事务内执行（已修复）', () => {
    it('更新 strategyConfig 时 $transaction 被调用（快照+递增原子化）', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 3 }))
      prisma.strategy.update.mockResolvedValue(buildStrategy({ version: 4 }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 25 } })

      // 验证 $transaction 被调用 —— 说明快照写入和版本递增在同一事务中
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      // 验证快照写入和版本递增都发生
      expect(prisma.strategyVersion.create).toHaveBeenCalledTimes(1)
      const updateCall = (prisma.strategy.update.mock.calls as any)[0][0]
      expect(updateCall.data.version).toEqual({ increment: 1 })
    })

    it('两次串行更新 strategyConfig 时各自写一次快照', async () => {
      const prisma = buildPrismaMock()
      prisma.strategy.findFirst.mockResolvedValue(buildStrategy({ version: 3 }))
      prisma.strategy.update.mockResolvedValue(buildStrategy({ version: 4 }))
      const svc = createService(prisma)

      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 25 } })
      await svc.update(1, { id: 'strat-1', strategyConfig: { topN: 30 } })

      // 两次调用各写一次快照
      expect(prisma.strategyVersion.create).toHaveBeenCalledTimes(2)
      // 注：单元 mock 不模拟 DB 串行化，真实并发保护由 $transaction 提供
    })
  })
})
