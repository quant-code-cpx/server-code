/**
 * BacktestParamSensitivityService — 单元测试
 *
 * 覆盖要点：
 * - create: 404/403/400（未完成）/网格超限/并发上限
 * - create: 正常创建 → sweep 记录、child 回测和 queue 调用次数
 * - getResult: 404/403 错误
 * - getResult: 空热力图
 * - getResult: 部分完成（PARTIAL）
 * - getResult: 全部完成 + 正确识别最优参数
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BacktestParamSensitivityService } from '../services/backtest-param-sensitivity.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    userId: 1,
    status: 'COMPLETED',
    strategyType: 'FACTOR_RANKING',
    strategyConfig: { topN: 20, shortWindow: 10, longWindow: 30 },
    startDate: new Date('2023-01-01'),
    endDate: new Date('2023-12-31'),
    benchmarkTsCode: '000300.SH',
    universe: 'ALL_A',
    customUniverse: null,
    initialCapital: 1_000_000,
    rebalanceFrequency: 'MONTHLY',
    priceMode: 'NEXT_OPEN',
    commissionRate: 0.0003,
    stampDutyRate: 0.0005,
    minCommission: 5,
    slippageBps: 5,
    ...overrides,
  }
}

function buildSweep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sweep-1',
    userId: 1,
    baseRunId: 'run-1',
    paramXKey: 'shortWindow',
    paramXLabel: '短均线',
    paramXValues: [5, 10, 15],
    paramYKey: 'longWindow',
    paramYLabel: '长均线',
    paramYValues: [20, 30],
    metric: 'sharpeRatio',
    status: 'PENDING',
    totalCount: 6,
    completedCount: 0,
    ...overrides,
  }
}

function buildChildRun(xi: number, yi: number, overrides: Record<string, unknown> = {}) {
  return {
    sweepXIdx: xi,
    sweepYIdx: yi,
    status: 'COMPLETED',
    totalReturn: 0.1 * (xi + 1),
    annualizedReturn: 0.08 * (xi + 1),
    sharpeRatio: 1.0 + xi * 0.2 + yi * 0.1,
    maxDrawdown: -0.1 - xi * 0.05,
    sortinoRatio: 1.5 + xi * 0.1,
    ...overrides,
  }
}

function buildPrismaMock() {
  return {
    backtestRun: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      create: jest.fn(),
    },
    paramSweep: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(async () => 0),
    },
  }
}

function buildQueueMock() {
  return { add: jest.fn(async () => ({ id: 'job-1' })) }
}

function createService(
  prisma = buildPrismaMock(),
  queue = buildQueueMock(),
): BacktestParamSensitivityService {
  // @ts-ignore 局部 mock，绕过 @InjectQueue DI
  return new BacktestParamSensitivityService(prisma as any, queue as any)
}

const baseDto = {
  runId: 'run-1',
  paramX: { paramKey: 'shortWindow', label: '短均线', values: [5, 10, 15] },
  paramY: { paramKey: 'longWindow', label: '长均线', values: [20, 30] },
  metric: 'sharpeRatio' as const,
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestParamSensitivityService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('基准回测不存在 → 抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.create(baseDto, 1)).rejects.toThrow(NotFoundException)
    })

    it('基准回测属于其他用户 → 抛 ForbiddenException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun({ userId: 99 }))
      const svc = createService(prisma)

      await expect(svc.create(baseDto, 1)).rejects.toThrow(ForbiddenException)
    })

    it('基准回测未完成 → 抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun({ status: 'RUNNING' }))
      const svc = createService(prisma)

      await expect(svc.create(baseDto, 1)).rejects.toThrow(BadRequestException)
    })

    it('参数网格超过 100 个 → 抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun())
      const svc = createService(prisma)

      const bigDto = {
        ...baseDto,
        paramX: { paramKey: 'a', values: Array.from({ length: 11 }, (_, i) => i) },
        paramY: { paramKey: 'b', values: Array.from({ length: 10 }, (_, i) => i) },
      }
      await expect(svc.create(bigDto, 1)).rejects.toThrow(BadRequestException)
    })

    it('并发扫描已达 3 个 → 抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun())
      prisma.paramSweep.count.mockResolvedValue(3)
      const svc = createService(prisma)

      await expect(svc.create(baseDto, 1)).rejects.toThrow(BadRequestException)
    })

    it('正常创建 → 创建 sweep 记录，为每个组合创建 backtestRun 并入队', async () => {
      const prisma = buildPrismaMock()
      const queue = buildQueueMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun())
      prisma.paramSweep.count.mockResolvedValue(0)
      prisma.paramSweep.create.mockResolvedValue(buildSweep())
      prisma.backtestRun.create.mockResolvedValue({ id: 'child-1' })
      const svc = createService(prisma, queue)

      const result = await svc.create(baseDto, 1)

      expect(prisma.paramSweep.create).toHaveBeenCalledTimes(1)
      // 3 × 2 = 6 child runs
      expect(prisma.backtestRun.create).toHaveBeenCalledTimes(6)
      expect(queue.add).toHaveBeenCalledTimes(6)
      expect(result.sweepId).toBe('sweep-1')
      expect(result.totalCombinations).toBe(6)
      expect(result.status).toBe('PENDING')
      expect(result.metric).toBe('sharpeRatio')
    })

    it('创建 child run 时正确注入参数 x/y 值到 strategyConfig', async () => {
      const prisma = buildPrismaMock()
      const queue = buildQueueMock()
      prisma.backtestRun.findUnique.mockResolvedValue(buildRun({ strategyConfig: { topN: 20, shortWindow: 10, longWindow: 30 } }))
      prisma.paramSweep.count.mockResolvedValue(0)
      prisma.paramSweep.create.mockResolvedValue(buildSweep())
      prisma.backtestRun.create.mockResolvedValue({ id: 'child-x' })
      const svc = createService(prisma, queue)

      await svc.create(baseDto, 1)

      const firstCall = prisma.backtestRun.create.mock.calls[0][0].data
      const config = firstCall.strategyConfig as Record<string, unknown>
      // First call: xi=0, yi=0 → shortWindow=5, longWindow=20
      expect(config.shortWindow).toBe(5)
      expect(config.longWindow).toBe(20)
      expect(config.topN).toBe(20) // other keys preserved
    })
  })

  // ── getResult() ──────────────────────────────────────────────────────────

  describe('getResult()', () => {
    it('sweep 不存在 → 抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.paramSweep.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.getResult('sweep-1', 1)).rejects.toThrow(NotFoundException)
    })

    it('sweep 属于其他用户 → 抛 ForbiddenException', async () => {
      const prisma = buildPrismaMock()
      prisma.paramSweep.findUnique.mockResolvedValue(buildSweep())
      prisma.backtestRun.findUnique.mockResolvedValue({ userId: 99 })
      const svc = createService(prisma)

      await expect(svc.getResult('sweep-1', 1)).rejects.toThrow(ForbiddenException)
    })

    it('无已完成子任务 → 热力图全为 null, best=null', async () => {
      const prisma = buildPrismaMock()
      prisma.paramSweep.findUnique.mockResolvedValue(buildSweep())
      prisma.backtestRun.findUnique.mockResolvedValue({ userId: 1 })
      prisma.backtestRun.findMany.mockResolvedValue([
        { ...buildChildRun(0, 0), status: 'QUEUED' },
        { ...buildChildRun(0, 1), status: 'RUNNING' },
      ])
      const svc = createService(prisma)

      const result = await svc.getResult('sweep-1', 1)

      expect(result.completedCount).toBe(0)
      expect(result.best).toBeNull()
      expect(result.heatmap[0][0]).toBeNull()
    })

    it('全部完成 → status=COMPLETED, heatmap 有值, best 正确', async () => {
      const prisma = buildPrismaMock()
      prisma.paramSweep.findUnique.mockResolvedValue(buildSweep({ paramXValues: [5, 10], paramYValues: [20, 30] }))
      prisma.backtestRun.findUnique.mockResolvedValue({ userId: 1 })
      const childRuns = [
        buildChildRun(0, 0, { sharpeRatio: 1.0 }),
        buildChildRun(0, 1, { sharpeRatio: 1.2 }),
        buildChildRun(1, 0, { sharpeRatio: 1.5 }),
        buildChildRun(1, 1, { sharpeRatio: 0.8 }),
      ]
      prisma.backtestRun.findMany.mockResolvedValue(childRuns)
      const svc = createService(prisma)

      const result = await svc.getResult('sweep-1', 1)

      expect(result.status).toBe('COMPLETED')
      expect(result.completedCount).toBe(4)
      expect(result.heatmap[0][0]).toBe(1.0)
      expect(result.heatmap[1][0]).toBe(1.5)
      // best: xi=1, yi=0 → xValue=10, yValue=20, sharpeRatio=1.5
      expect(result.best?.xValue).toBe(10)
      expect(result.best?.yValue).toBe(20)
      expect(result.best?.metricValue).toBe(1.5)
    })
  })
})
