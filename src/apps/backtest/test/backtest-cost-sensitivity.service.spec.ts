/**
 * BacktestCostSensitivityService — 单元测试 (OPT-2.2)
 *
 * 覆盖场景（共 8 个）：
 *  1. 正常：2 组佣金率 × 2 组滑点 → 4 个 points，指标合法
 *  2. 回测不存在 → 404
 *  3. 回测未完成 → 400
 *  4. 无权访问 → 403
 *  5. 无交易记录 → 400
 *  6. fee=0 → 收益最高 / 费率越高收益越低（单调性）
 *  7. 参数数组过长（>10）→ 400
 *  8. costCapitalRatio = totalCost / initialCapital
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BacktestCostSensitivityService } from '../services/backtest-cost-sensitivity.service'

function buildPrismaMock() {
  return {
    backtestRun: { findUnique: jest.fn() },
    backtestTrade: { findMany: jest.fn() },
    backtestDailyNav: { findMany: jest.fn() },
  }
}

function createService(mock = buildPrismaMock()) {
  // @ts-ignore 局部 mock
  return { svc: new BacktestCostSensitivityService(mock), prisma: mock }
}

const RUN_ID = 'run-001'
const USER_ID = 42

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: USER_ID,
    status: 'COMPLETED',
    commissionRate: '0.000300',
    stampDutyRate: '0.000500',
    minCommission: '5.0000',
    slippageBps: 5,
    initialCapital: '1000000.0000',
    totalReturn: 0.05,
    ...overrides,
  }
}

function makeTrades(n: number, amount = 100000) {
  const base = new Date('2024-01-02')
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    return {
      tradeDate: d,
      side: i % 2 === 0 ? 'BUY' : 'SELL',
      amount: String(amount),
      commission: String(Math.max(amount * 0.0003, 5)),
      stampDuty: String(i % 2 === 0 ? 0 : amount * 0.0005),
      slippageCost: String(amount * 5 / 10000),
    }
  })
}

function makeNavRows(n: number, startNav = 1000000, dailyGainRate = 0.001) {
  const base = new Date('2024-01-02')
  let nav = startNav
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    nav = nav * (1 + dailyGainRate)
    return { tradeDate: d, nav: String(nav.toFixed(4)) }
  })
}

// ═══════════════════════════════════════════════════════════

describe('BacktestCostSensitivityService', () => {
  let svc: BacktestCostSensitivityService
  let prisma: ReturnType<typeof buildPrismaMock>

  beforeEach(() => {
    jest.clearAllMocks()
    const created = createService()
    svc = created.svc
    prisma = created.prisma
  })

  it('2. 回测不存在 → 404', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(null)
    await expect(svc.analyze({ runId: 'missing' }, USER_ID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('3. 回测未完成 → 400', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun({ status: 'RUNNING' }))
    await expect(svc.analyze({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('4. 无权访问 → 403', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun({ userId: 999 }))
    await expect(svc.analyze({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('5. 无交易记录 → 400', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestTrade.findMany.mockResolvedValue([])
    await expect(svc.analyze({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('7. 参数数组长度 > 10 → 400', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestTrade.findMany.mockResolvedValue(makeTrades(5))
    prisma.backtestDailyNav.findMany.mockResolvedValue(makeNavRows(20))
    await expect(
      svc.analyze({ runId: RUN_ID, commissionRates: new Array(11).fill(0.001) }, USER_ID),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('1. 正常：2×2 参数网格 → 4 个 points，指标合法', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestTrade.findMany.mockResolvedValue(makeTrades(10))
    prisma.backtestDailyNav.findMany.mockResolvedValue(makeNavRows(20))

    const result = await svc.analyze(
      { runId: RUN_ID, commissionRates: [0.0001, 0.001], slippageBpsList: [0, 10] },
      USER_ID,
    )
    expect(result.runId).toBe(RUN_ID)
    expect(result.points).toHaveLength(4)
    for (const p of result.points) {
      expect(isFinite(p.totalReturn)).toBe(true)
      expect(isFinite(p.sharpeRatio)).toBe(true)
      expect(p.maxDrawdown).toBeLessThanOrEqual(0)
      expect(p.totalCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('6. 费率为 0 时收益最高（单调性）', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestTrade.findMany.mockResolvedValue(makeTrades(10, 100000))
    prisma.backtestDailyNav.findMany.mockResolvedValue(makeNavRows(20))

    const result = await svc.analyze(
      { runId: RUN_ID, commissionRates: [0, 0.0003, 0.001], slippageBpsList: [0] },
      USER_ID,
    )
    const returns = result.points.map(p => p.totalReturn)
    // 费率越高，收益越低（或相等）
    expect(returns[0]).toBeGreaterThanOrEqual(returns[1])
    expect(returns[1]).toBeGreaterThanOrEqual(returns[2])
  })

  it('8. costCapitalRatio = totalCost / initialCapital', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestTrade.findMany.mockResolvedValue(makeTrades(5, 100000))
    prisma.backtestDailyNav.findMany.mockResolvedValue(makeNavRows(10))

    const result = await svc.analyze(
      { runId: RUN_ID, commissionRates: [0.0003], slippageBpsList: [5] },
      USER_ID,
    )
    const p = result.points[0]
    expect(p.costCapitalRatio).toBeCloseTo(p.totalCost / 1000000, 8)
  })
})
