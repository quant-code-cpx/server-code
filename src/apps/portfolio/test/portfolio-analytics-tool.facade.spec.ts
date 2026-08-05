import { Decimal } from '@prisma/client/runtime/library'
import { PortfolioAnalyticsToolFacade } from '../portfolio-analytics-tool.facade'

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

function snapshot(date: string, assets: number, nav: number, dailyReturn: number | null) {
  return {
    portfolioId: 'p-1',
    tradeDate: day(date),
    totalAssets: new Decimal(assets),
    marketValue: new Decimal(10_000),
    cash: new Decimal(assets - 10_000),
    nav: new Decimal(nav),
    dailyReturn,
    benchmarkCode: '000300.SH',
    benchmarkNav: null,
    benchmarkReturn: null,
    sourceEventThrough: null,
    algorithmVersion: 'portfolio-nav.v1',
    qualityFlags: ['REALIZED_PNL_NOT_AVAILABLE'],
    computedAt: new Date(),
  }
}

function harness() {
  const snapshots = [
    snapshot('2026-08-01', 10_000, 1, null),
    snapshot('2026-08-02', 10_500, 1.05, 0.05),
    snapshot('2026-08-03', 11_400, 1.14, 1.14 / 1.05 - 1),
  ]
  const repository = {
    findOwnedPortfolio: jest.fn(async () => ({
      id: 'p-1',
      userId: 7,
      name: '核心组合',
      initialCash: new Decimal(10_000),
    })),
    getCoverage: jest.fn(async () => ({ coverageStart: day('2026-08-01'), dataThrough: day('2026-08-03') })),
    getSnapshotAtOrBefore: jest.fn(async () => snapshots[2]),
    getSnapshots: jest.fn(async () => snapshots),
    getPositions: jest.fn(async () => [
      {
        portfolioId: 'p-1',
        tradeDate: day('2026-08-03'),
        tsCode: '000001.SZ',
        quantity: 100,
        avgCost: new Decimal(50),
        close: new Decimal(60),
        priceDate: day('2026-08-03'),
        marketValue: new Decimal(6_000),
        weight: 0.6,
        algorithmVersion: 'portfolio-nav.v1',
        qualityFlags: [],
      },
      {
        portfolioId: 'p-1',
        tradeDate: day('2026-08-03'),
        tsCode: '000002.SZ',
        quantity: 80,
        avgCost: new Decimal(45),
        close: new Decimal(50),
        priceDate: day('2026-08-03'),
        marketValue: new Decimal(4_000),
        weight: 0.4,
        algorithmVersion: 'portfolio-nav.v1',
        qualityFlags: [],
      },
    ]),
    getPreviousSnapshot: jest.fn(async () => snapshots[1]),
    getBenchmarkCloses: jest.fn(async () => [
      { tradeDate: day('2026-08-01'), close: 100 },
      { tradeDate: day('2026-08-02'), close: 105 },
      { tradeDate: day('2026-08-03'), close: 114 },
    ]),
    getNames: jest.fn(
      async () =>
        new Map([
          ['000001.SZ', '平安银行'],
          ['000002.SZ', '万科A'],
        ]),
    ),
    getEvents: jest.fn(async () => ({
      total: 1,
      items: [
        {
          id: 'e-1',
          tsCode: '000001.SZ',
          action: 'ADD',
          quantityDelta: 100,
          price: new Decimal(50),
          beforeQuantity: 0,
          afterQuantity: 100,
          effectiveDate: day('2026-08-01'),
          occurredAt: new Date('2026-08-01T08:00:00Z'),
          source: 'MANUAL',
        },
      ],
    })),
  }
  return { facade: new PortfolioAnalyticsToolFacade(repository as never), repository }
}

describe('PortfolioAnalyticsToolFacade', () => {
  it('[BIZ] 使用点时快照手算收益、PnL、Beta、漂移和事件分页', async () => {
    const { facade, repository } = harness()
    const result = await facade.analyze(7, {
      portfolioId: 'p-1',
      sections: ['OVERVIEW', 'PERFORMANCE', 'PNL', 'DRIFT', 'TRADES'],
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      benchmarkCode: '000905.SH',
      targetWeights: { '000001.SZ': 0.5, '000002.SZ': 0.5 },
      tradePage: 1,
      tradePageSize: 20,
      maxSeriesPoints: 20,
    })

    expect(repository.findOwnedPortfolio).toHaveBeenCalledWith('p-1', 7)
    expect(repository.getBenchmarkCloses).toHaveBeenCalledWith('000905.SH', day('2026-08-01'), day('2026-08-03'))
    expect(result.data.meta).toMatchObject({ ownerScoped: true, benchmarkCode: '000905.SH', dataThrough: '2026-08-03' })
    expect(result.data.overview).toMatchObject({ status: 'OK', data: { totalAssets: 11_400, cash: 1_400 } })
    expect(result.data.performance.status).toBe('OK')
    if (result.data.performance.status !== 'OK') throw new Error('绩效 section 未就绪')
    expect(result.data.performance.data.totalReturn).toBeCloseTo(0.14)
    expect(result.data.performance.data.benchmarkReturn).toBeCloseTo(0.14)
    expect(result.data.performance.data.excessReturn).toBeCloseTo(0)
    expect(result.data.performance.data.beta).toBeCloseTo(1)
    expect(result.data.pnl).toMatchObject({
      status: 'OK',
      data: { totalPnl: 1_400, realizedPnl: null, unrealizedPnl: 1_400, dailyPnl: 900 },
    })
    expect(result.data.drift.status).toBe('OK')
    if (result.data.drift.status !== 'OK') throw new Error('漂移 section 未就绪')
    expect(result.data.drift.data[0]).toMatchObject({ tsCode: '000001.SZ' })
    expect(result.data.drift.data[0].drift).toBeCloseTo(0.1)
    expect(result.data.drift.data[1]).toMatchObject({ tsCode: '000002.SZ' })
    expect(result.data.drift.data[1].drift).toBeCloseTo(-0.1)
    expect(result.data.trades).toMatchObject({ status: 'OK', data: { total: 1, page: 1, pageSize: 20 } })
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'REALIZED_PNL_NOT_AVAILABLE' }))
  })

  it('[SEC] 越权 id 与不存在 id 统一 DATA_NOT_FOUND，不继续查快照', async () => {
    const { facade, repository } = harness()
    repository.findOwnedPortfolio.mockResolvedValueOnce(null)

    await expect(facade.analyze(99, { portfolioId: 'other-user' })).rejects.toMatchObject({
      code: 'DATA_NOT_FOUND',
    })
    expect(repository.getCoverage).not.toHaveBeenCalled()
  })

  it('[DATA] 请求区间早于事件覆盖起点时显式返回 coverageStart', async () => {
    const { facade } = harness()
    await expect(
      facade.analyze(7, { portfolioId: 'p-1', startDate: '2026-07-01', endDate: '2026-08-03' }),
    ).rejects.toMatchObject({
      code: 'DATA_NOT_READY',
      details: { coverageStart: '2026-08-01' },
    })
  })

  it('[VALIDATION] 非有限权重和非 1 权重和被拒绝', async () => {
    const { facade } = harness()
    await expect(
      facade.analyze(7, { portfolioId: 'p-1', sections: ['DRIFT'], targetWeights: { '000001.SZ': Number.NaN } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
