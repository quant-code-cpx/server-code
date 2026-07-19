import { BacktestToolFacade, BacktestToolNotFoundError, BacktestToolResultTooLargeError } from '../backtest-tool.facade'

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    userId: 1,
    jobId: 'job_1',
    name: '测试回测',
    strategyType: 'MA_CROSS_SINGLE',
    strategyId: null,
    strategyConfig: { fastPeriod: 5, slowPeriod: 20 },
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-12-31T00:00:00.000Z'),
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
    status: 'COMPLETED',
    progress: 100,
    failedReason: null,
    totalReturn: 0.1,
    annualizedReturn: 0.1,
    benchmarkReturn: null,
    excessReturn: null,
    maxDrawdown: -0.08,
    sharpeRatio: 1,
    sortinoRatio: 1.2,
    calmarRatio: 1.25,
    volatility: 0.1,
    alpha: null,
    beta: null,
    informationRatio: null,
    winRate: 0.55,
    turnoverRate: 1.5,
    tradeCount: 20,
    sweepId: null,
    sweepXIdx: null,
    sweepYIdx: null,
    starred: false,
    archived: false,
    note: null,
    deletedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    startedAt: new Date('2025-01-01T00:00:01.000Z'),
    completedAt: new Date('2025-01-01T00:01:00.000Z'),
    updatedAt: new Date('2025-01-01T00:01:00.000Z'),
    ...overrides,
  }
}

describe('BacktestToolFacade', () => {
  it('所有权查询 fail closed', async () => {
    const prisma = { backtestRun: { findFirst: jest.fn().mockResolvedValue(null) } }
    const facade = new BacktestToolFacade(prisma as never)
    await expect(
      facade.result(1, { backtestRunId: 'run_b', sections: ['STATUS'], maxEquityPoints: 500 }),
    ).rejects.toBeInstanceOf(BacktestToolNotFoundError)
    expect(prisma.backtestRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run_b', userId: 1, deletedAt: null },
    })
  })

  it('保留 null、稳定抽样首尾点并强制 bias flags', async () => {
    const navs = Array.from({ length: 12 }, (_, index) => ({
      tradeDate: new Date(Date.UTC(2024, 0, index + 1)),
      nav: 1 + index / 100,
      benchmarkNav: index === 0 ? null : 1,
      drawdown: null,
      dailyReturn: null,
      benchmarkReturn: null,
      exposure: null,
      cashRatio: null,
    }))
    const prisma = {
      backtestRun: { findFirst: jest.fn().mockResolvedValue(run()) },
      backtestDailyNav: {
        count: jest.fn().mockResolvedValue(navs.length),
        findMany: jest.fn().mockResolvedValue(navs),
      },
    }
    const facade = new BacktestToolFacade(prisma as never)
    const result = await facade.result(1, {
      backtestRunId: 'run_1',
      sections: ['METRICS', 'EQUITY'],
      maxEquityPoints: 10,
    })

    expect(result.data.metrics?.benchmarkReturn).toBeNull()
    expect(result.data.equity).toMatchObject({ totalPoints: 12, returnedPoints: 10, sampling: 'EVEN', truncated: true })
    expect(result.data.equity?.points[0].tradeDate).toBe('2024-01-01')
    expect(result.data.equity?.points.at(-1)?.tradeDate).toBe('2024-01-12')
    expect(result.data.equity?.points[0].benchmarkNav).toBeNull()
    expect(result.data.biasFlags).toEqual({
      survivorship: 'UNVERIFIED',
      pointInTimeUniverse: false,
      announcementDate: false,
      adjustment: 'UNVERIFIED',
      reproducible: false,
    })
    expect(result.warnings.map((warning) => warning.code)).toContain('BACKTEST_BIAS_UNVERIFIED')
  })

  it('超大净值序列在加载明细前拒绝', async () => {
    const prisma = {
      backtestRun: { findFirst: jest.fn().mockResolvedValue(run()) },
      backtestDailyNav: { count: jest.fn().mockResolvedValue(20_001), findMany: jest.fn() },
    }
    const facade = new BacktestToolFacade(prisma as never)
    await expect(
      facade.result(1, { backtestRunId: 'run_1', sections: ['EQUITY'], maxEquityPoints: 500 }),
    ).rejects.toBeInstanceOf(BacktestToolResultTooLargeError)
    expect(prisma.backtestDailyNav.findMany).not.toHaveBeenCalled()
  })
})
