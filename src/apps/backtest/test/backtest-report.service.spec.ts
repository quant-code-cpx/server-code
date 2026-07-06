import { BacktestReportService } from '../services/backtest-report.service'
import { BacktestResult } from '../types/backtest-engine.types'

function buildMetrics() {
  return {
    totalReturn: 0.1,
    annualizedReturn: 0.2,
    benchmarkReturn: 0.03,
    excessReturn: 0.07,
    maxDrawdown: -0.05,
    sharpeRatio: 1.2,
    sortinoRatio: 1.4,
    calmarRatio: 4,
    volatility: 0.18,
    alpha: 0.01,
    beta: 0.9,
    informationRatio: 0.8,
    winRate: 0.55,
    turnoverRate: 0.3,
    tradeCount: 1,
  }
}

function buildResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  const tradeDate = new Date('2025-01-02')
  return {
    navRecords: [
      {
        tradeDate,
        nav: 1.1,
        benchmarkNav: 1.03,
        dailyReturn: 0.1,
        benchmarkReturn: 0.03,
        drawdown: 0,
        cash: 90000,
        positionValue: 20000,
        exposure: 0.18,
        cashRatio: 0.82,
      },
    ],
    trades: [
      {
        tradeDate,
        tsCode: '000001.SZ',
        side: 'BUY',
        price: 10,
        quantity: 100,
        amount: 1000,
        commission: 1,
        stampDuty: 0,
        slippageCost: 0.5,
        reason: 'rebalance-buy',
      },
    ],
    positions: [
      {
        tradeDate,
        tsCode: '000001.SZ',
        quantity: 100,
        costPrice: 10,
        closePrice: 11,
        marketValue: 1100,
        weight: 0.01,
        unrealizedPnl: 100,
        holdingDays: 1,
      },
    ],
    rebalanceLogs: [
      {
        signalDate: new Date('2025-01-01'),
        executeDate: tradeDate,
        targetCount: 1,
        executedBuyCount: 1,
        executedSellCount: 0,
        skippedLimitCount: 0,
        skippedSuspendCount: 0,
        message: null,
      },
    ],
    metrics: buildMetrics(),
    ...overrides,
  }
}

function buildPrismaMock() {
  const operations: string[] = []
  const table = (name: string) => ({
    deleteMany: jest.fn(async () => {
      operations.push(`${name}.deleteMany`)
      return { count: 0 }
    }),
    createMany: jest.fn(async () => {
      operations.push(`${name}.createMany`)
      return { count: 1 }
    }),
  })
  const tx = {
    backtestDailyNav: table('backtestDailyNav'),
    backtestTrade: table('backtestTrade'),
    backtestPositionSnapshot: table('backtestPositionSnapshot'),
    backtestRebalanceLog: table('backtestRebalanceLog'),
    backtestRun: {
      update: jest.fn(async () => {
        operations.push('backtestRun.update')
        return {}
      }),
    },
  }
  return {
    operations,
    tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  }
}

describe('BacktestReportService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('saveReport: 单事务内先清旧结果，再写新结果和完成态指标', async () => {
    const prisma = buildPrismaMock()
    const svc = new BacktestReportService(prisma as any)

    await svc.saveReport('run-1', buildResult())

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.operations).toEqual([
      'backtestDailyNav.deleteMany',
      'backtestTrade.deleteMany',
      'backtestPositionSnapshot.deleteMany',
      'backtestRebalanceLog.deleteMany',
      'backtestDailyNav.createMany',
      'backtestTrade.createMany',
      'backtestPositionSnapshot.createMany',
      'backtestRebalanceLog.createMany',
      'backtestRun.update',
    ])
    expect(prisma.tx.backtestDailyNav.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } })
    expect(prisma.tx.backtestTrade.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } })
    expect(prisma.tx.backtestPositionSnapshot.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } })
    expect(prisma.tx.backtestRebalanceLog.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } })
    expect(prisma.tx.backtestDailyNav.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ runId: 'run-1', nav: 1.1 })] }),
    )
    expect(prisma.tx.backtestRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'COMPLETED', progress: 100, totalReturn: 0.1 }),
      }),
    )
  })

  it('saveReport: 重跑为空结果时也清理旧明细，不保留脏数据', async () => {
    const prisma = buildPrismaMock()
    const svc = new BacktestReportService(prisma as any)

    await svc.saveReport(
      'run-1',
      buildResult({
        navRecords: [],
        trades: [],
        positions: [],
        rebalanceLogs: [],
        metrics: buildMetrics(),
      }),
    )

    expect(prisma.operations).toEqual([
      'backtestDailyNav.deleteMany',
      'backtestTrade.deleteMany',
      'backtestPositionSnapshot.deleteMany',
      'backtestRebalanceLog.deleteMany',
      'backtestRun.update',
    ])
    expect(prisma.tx.backtestDailyNav.createMany).not.toHaveBeenCalled()
    expect(prisma.tx.backtestTrade.createMany).not.toHaveBeenCalled()
    expect(prisma.tx.backtestPositionSnapshot.createMany).not.toHaveBeenCalled()
    expect(prisma.tx.backtestRebalanceLog.createMany).not.toHaveBeenCalled()
  })
})
