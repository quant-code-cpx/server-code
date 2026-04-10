/**
 * BacktestRunService — 单元测试
 *
 * 覆盖要点：
 * - createRun: 正常创建、日期范围非法、返回结构
 * - assertValidDateRange: 合法区间、开始 >= 结束抛异常、YYYYMMDD 解析
 * - listRuns: 分页结构、按 status 过滤
 * - cancelRun: 找不到抛 NotFoundException、成功取消
 * - validateRun: 调用 dataReadinessService.checkReadiness 并返回结果
 */
import { NotFoundException } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { BacktestRunService } from '../services/backtest-run.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    userId: 1,
    name: '测试回测',
    strategyType: 'FACTOR_RANKING',
    strategyConfig: { topN: 20 },
    status: 'QUEUED',
    progress: 0,
    jobId: null,
    failedReason: null,
    startDate: new Date('2023-01-01'),
    endDate: new Date('2023-12-31'),
    benchmarkTsCode: '000300.SH',
    universe: 'ALL_A',
    initialCapital: 1_000_000,
    rebalanceFrequency: 'MONTHLY',
    priceMode: 'NEXT_OPEN',
    commissionRate: 0.0003,
    stampDutyRate: 0.0005,
    minCommission: 5,
    slippageBps: 5,
    totalReturn: null,
    annualizedReturn: null,
    maxDrawdown: null,
    sharpeRatio: null,
    createdAt: new Date('2025-01-01'),
    completedAt: null,
    ...overrides,
  }
}

function buildPrismaMock() {
  const mockPrisma = {
    backtestRun: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      delete: jest.fn(),
    },
    backtestDailyNav: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    backtestTrade: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    backtestPosition: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    $transaction: jest.fn(async (fn: unknown) =>
      typeof fn === 'function' ? fn(mockPrisma) : fn,
    ),
  }
  return mockPrisma
}

function buildDataReadinessMock() {
  return {
    checkReadiness: jest.fn(async () => ({
      isValid: true,
      warnings: [],
      errors: [],
      dataReadiness: {},
      stats: {},
    })),
  }
}

function buildStrategyRegistryMock() {
  return {
    validateStrategyConfig: jest.fn((type: string, config: Record<string, unknown>) => config),
    getSupportedTypes: jest.fn(() => []),
  }
}

function buildQueueMock() {
  return {
    add: jest.fn(async () => ({ id: 'job-1' })),
    getJob: jest.fn(),
    removeJobs: jest.fn(async () => {}),
  }
}

function createService(
  prisma = buildPrismaMock(),
  dataReadiness = buildDataReadinessMock(),
  strategyRegistry = buildStrategyRegistryMock(),
  queue = buildQueueMock(),
): BacktestRunService {
  // @ts-ignore 局部 mock，绕过 @InjectQueue 依赖注入
  return new BacktestRunService(prisma as any, dataReadiness as any, strategyRegistry as any, queue as any)
}

const baseCreateDto = {
  name: '测试回测',
  strategyType: 'FACTOR_RANKING' as const,
  strategyConfig: { topN: 20 },
  startDate: '20230101',
  endDate: '20231231',
  initialCapital: 1_000_000,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestRunService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── createRun() ───────────────────────────────────────────────────────────

  describe('createRun()', () => {
    it('正常创建 → 调用 prisma.backtestRun.create 和 queue.add', async () => {
      const prisma = buildPrismaMock()
      const queue = buildQueueMock()
      const run = buildRunRecord()
      prisma.backtestRun.create.mockResolvedValue(run)
      prisma.backtestRun.update.mockResolvedValue({ ...run, jobId: 'job-1' })
      const svc = createService(prisma, buildDataReadinessMock(), buildStrategyRegistryMock(), queue)

      await svc.createRun(baseCreateDto, 1)

      expect(prisma.backtestRun.create).toHaveBeenCalled()
      expect(queue.add).toHaveBeenCalled()
    })

    it('返回 { runId, jobId, status: "QUEUED" }', async () => {
      const prisma = buildPrismaMock()
      const queue = buildQueueMock()
      prisma.backtestRun.create.mockResolvedValue(buildRunRecord())
      prisma.backtestRun.update.mockResolvedValue(buildRunRecord({ jobId: 'job-1' }))
      const svc = createService(prisma, buildDataReadinessMock(), buildStrategyRegistryMock(), queue)

      const result = await svc.createRun(baseCreateDto, 1)

      expect(result).toHaveProperty('runId', 'run-1')
      expect(result).toHaveProperty('jobId', 'job-1')
      expect(result).toHaveProperty('status', 'QUEUED')
    })

    it('开始日期 >= 结束日期 → 抛 BusinessException', async () => {
      const svc = createService()

      await expect(
        svc.createRun({ ...baseCreateDto, startDate: '20231231', endDate: '20230101' }, 1),
      ).rejects.toThrow(BusinessException)
    })

    it('开始日期 = 结束日期 → 抛 BusinessException', async () => {
      const svc = createService()

      await expect(
        svc.createRun({ ...baseCreateDto, startDate: '20230101', endDate: '20230101' }, 1),
      ).rejects.toThrow(BusinessException)
    })

    it('prisma.backtestRun.update 写入 jobId', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.create.mockResolvedValue(buildRunRecord())
      prisma.backtestRun.update.mockResolvedValue(buildRunRecord({ jobId: 'job-1' }))
      const svc = createService(prisma)

      await svc.createRun(baseCreateDto, 1)

      expect(prisma.backtestRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-1' }, data: { jobId: 'job-1' } }),
      )
    })
  })

  // ── assertValidDateRange() (私有方法) ──────────────────────────────────────

  describe('assertValidDateRange() [private]', () => {
    let svc: BacktestRunService

    beforeEach(() => {
      svc = createService()
    })

    it('合法区间 → 返回 { startDate, endDate } Date 对象', () => {
      const result = (svc as any).assertValidDateRange('20230101', '20231231')
      expect(result.startDate).toBeInstanceOf(Date)
      expect(result.endDate).toBeInstanceOf(Date)
    })

    it('YYYYMMDD 格式正确解析（startDate 为 2023-01-01）', () => {
      const { startDate } = (svc as any).assertValidDateRange('20230101', '20231231')
      expect(startDate.getFullYear()).toBe(2023)
      expect(startDate.getMonth()).toBe(0) // 一月
      expect(startDate.getDate()).toBe(1)
    })

    it('开始 > 结束 → 抛 BusinessException', () => {
      expect(() => (svc as any).assertValidDateRange('20231231', '20230101')).toThrow(BusinessException)
    })

    it('开始 = 结束 → 抛 BusinessException', () => {
      expect(() => (svc as any).assertValidDateRange('20230101', '20230101')).toThrow(BusinessException)
    })
  })

  // ── listRuns() ────────────────────────────────────────────────────────────

  describe('listRuns()', () => {
    it('返回 { total, items, page, pageSize }', async () => {
      const prisma = buildPrismaMock()
      const runRow = {
        id: 'run-1',
        name: '测试回测',
        strategyType: 'FACTOR_RANKING',
        status: 'COMPLETED',
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-12-31'),
        benchmarkTsCode: '000300.SH',
        totalReturn: 0.1,
        annualizedReturn: 0.1,
        maxDrawdown: -0.05,
        sharpeRatio: 1.2,
        progress: 100,
        createdAt: new Date('2023-01-01'),
        completedAt: new Date('2023-12-31'),
      }
      prisma.backtestRun.count.mockResolvedValue(1)
      prisma.backtestRun.findMany.mockResolvedValue([runRow])
      const svc = createService(prisma)

      const result = await svc.listRuns({ page: 1, pageSize: 20 }, 1)

      expect(result).toHaveProperty('total', 1)
      expect(result).toHaveProperty('page', 1)
      expect(result).toHaveProperty('pageSize', 20)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toHaveProperty('runId', 'run-1')
    })

    it('按 status 过滤时 where.status 被设置', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.count.mockResolvedValue(0)
      prisma.backtestRun.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.listRuns({ status: 'COMPLETED' as any, page: 1, pageSize: 20 }, 1)

      const countCall = prisma.backtestRun.count.mock.calls[0][0]
      expect(countCall.where).toHaveProperty('status', 'COMPLETED')
    })

    it('默认分页 page=1, pageSize=20', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.count.mockResolvedValue(0)
      prisma.backtestRun.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.listRuns({}, 1)

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  // ── cancelRun() ───────────────────────────────────────────────────────────

  describe('cancelRun()', () => {
    it('回测任务不存在 → 抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.cancelRun('nonexistent')).rejects.toThrow(NotFoundException)
    })

    it('已完成状态不能取消 → 抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRunRecord({ status: 'COMPLETED' }))
      const svc = createService(prisma)

      await expect(svc.cancelRun('run-1')).rejects.toThrow()
    })

    it('QUEUED 状态可以取消 → 更新状态为 CANCELLED', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRunRecord({ status: 'QUEUED' }))
      prisma.backtestRun.update.mockResolvedValue(buildRunRecord({ status: 'CANCELLED' }))
      const svc = createService(prisma)

      const result = await svc.cancelRun('run-1')

      expect(prisma.backtestRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-1' }, data: { status: 'CANCELLED' } }),
      )
      expect(result).toHaveProperty('status', 'CANCELLED')
    })

    it('取消时若有 jobId 尝试从队列移除（队列移除失败不阻断取消）', async () => {
      const prisma = buildPrismaMock()
      const queue = buildQueueMock()
      const fakeJob = { remove: jest.fn(async () => {}) }
      queue.getJob.mockResolvedValue(fakeJob)
      prisma.backtestRun.findUnique.mockResolvedValue(buildRunRecord({ status: 'QUEUED', jobId: 'job-1' }))
      prisma.backtestRun.update.mockResolvedValue(buildRunRecord({ status: 'CANCELLED' }))
      const svc = createService(prisma, buildDataReadinessMock(), buildStrategyRegistryMock(), queue)

      await svc.cancelRun('run-1')

      expect(queue.getJob).toHaveBeenCalledWith('job-1')
      expect(fakeJob.remove).toHaveBeenCalled()
    })
  })

  // ── validateRun() ─────────────────────────────────────────────────────────

  describe('validateRun()', () => {
    const validateDto = {
      strategyType: 'FACTOR_RANKING' as const,
      strategyConfig: { topN: 20 },
      startDate: '20230101',
      endDate: '20231231',
      initialCapital: 1_000_000,
    }

    it('调用 dataReadinessService.checkReadiness 并返回结果', async () => {
      const dataReadiness = buildDataReadinessMock()
      const readinessResult = {
        isValid: true,
        warnings: [],
        errors: [],
        dataReadiness: { hasDaily: true },
        stats: { tradingDays: 244 },
      }
      dataReadiness.checkReadiness.mockResolvedValue(readinessResult)
      const svc = createService(buildPrismaMock(), dataReadiness)

      const result = await svc.validateRun(validateDto)

      expect(dataReadiness.checkReadiness).toHaveBeenCalledWith(validateDto)
      expect(result).toEqual(readinessResult)
    })

    it('日期非法 → 抛 BusinessException（不走 checkReadiness）', async () => {
      const dataReadiness = buildDataReadinessMock()
      const svc = createService(buildPrismaMock(), dataReadiness)

      await expect(
        svc.validateRun({ ...validateDto, startDate: '20231231', endDate: '20230101' }),
      ).rejects.toThrow(BusinessException)

      expect(dataReadiness.checkReadiness).not.toHaveBeenCalled()
    })
  })
})
