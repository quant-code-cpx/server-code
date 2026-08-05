import { Decimal } from '@prisma/client/runtime/library'
import {
  PORTFOLIO_NAV_ALGORITHM_VERSION,
  PortfolioSnapshotError,
  PortfolioSnapshotService,
} from '../portfolio-snapshot.service'

function harness() {
  const tx = {
    portfolioPositionSnapshot: { deleteMany: jest.fn(), createMany: jest.fn() },
    portfolioDailySnapshot: { upsert: jest.fn() },
  }
  const prisma = {
    portfolio: { findUnique: jest.fn() },
    portfolioHoldingEvent: { findMany: jest.fn(), findFirst: jest.fn() },
    portfolioDailySnapshot: { findFirst: jest.fn(), findUnique: jest.fn() },
    indexDaily: { findFirst: jest.fn() },
    daily: { findFirst: jest.fn() },
    tradeCal: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
  }
  return { service: new PortfolioSnapshotService(prisma as never), prisma, tx }
}

describe('PortfolioSnapshotService', () => {
  it('[BIZ] 两只股票与现金手算市值、NAV、权重，并标记停牌价格回退', async () => {
    const { service, prisma, tx } = harness()
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', initialCash: new Decimal(10_000) })
    prisma.portfolioHoldingEvent.findMany.mockResolvedValue([
      {
        id: 'e-1',
        holdingId: 'h-1',
        tsCode: '000001.SZ',
        afterQuantity: 100,
        afterAvgCost: new Decimal(10),
        occurredAt: new Date('2026-08-01T01:00:00Z'),
      },
      {
        id: 'e-2',
        holdingId: 'h-2',
        tsCode: '000002.SZ',
        afterQuantity: 50,
        afterAvgCost: new Decimal(20),
        occurredAt: new Date('2026-08-01T02:00:00Z'),
      },
    ])
    prisma.$queryRaw.mockResolvedValue([
      { tsCode: '000001.SZ', tradeDate: new Date('2026-08-04'), close: 12 },
      { tsCode: '000002.SZ', tradeDate: new Date('2026-08-03'), close: 18 },
    ])
    prisma.portfolioDailySnapshot.findFirst.mockResolvedValue(null)
    prisma.portfolioDailySnapshot.findUnique.mockResolvedValue(null)
    prisma.indexDaily.findFirst.mockResolvedValue({ tradeDate: new Date('2026-08-04'), pctChg: 1 })

    await service.rebuildPortfolioDate('p-1', new Date('2026-08-04'))

    const create = tx.portfolioDailySnapshot.upsert.mock.calls[0][0].create
    expect(Number(create.marketValue)).toBe(2_100)
    expect(Number(create.cash)).toBe(8_000)
    expect(Number(create.totalAssets)).toBe(10_100)
    expect(Number(create.nav)).toBeCloseTo(1.01, 8)
    expect(create.dailyReturn).toBeNull()
    expect(Number(create.benchmarkNav)).toBe(1)
    expect(create.benchmarkReturn).toBeNull()
    expect(create.qualityFlags).toEqual(expect.arrayContaining(['REALIZED_PNL_NOT_AVAILABLE', 'POSITION_PRICE_STALE']))
    const rows = tx.portfolioPositionSnapshot.createMany.mock.calls[0][0].data
    expect(rows.find((row: { tsCode: string }) => row.tsCode === '000001.SZ').weight).toBeCloseTo(1_200 / 2_100)
    expect(rows.find((row: { tsCode: string }) => row.tsCode === '000002.SZ').qualityFlags).toContain(
      'POSITION_PRICE_STALE',
    )
  })

  it('[BIZ] 同日事件按有效日、发生时间、id 重放，移除后不残留仓位', async () => {
    const { service, prisma, tx } = harness()
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', initialCash: new Decimal(10_000) })
    prisma.portfolioHoldingEvent.findMany.mockResolvedValue([
      {
        id: 'e-1',
        holdingId: 'h-1',
        tsCode: '000001.SZ',
        afterQuantity: 100,
        afterAvgCost: new Decimal(10),
        occurredAt: new Date('2026-08-01T01:00:00Z'),
      },
      {
        id: 'e-2',
        holdingId: 'h-1',
        tsCode: '000001.SZ',
        afterQuantity: 0,
        afterAvgCost: null,
        occurredAt: new Date('2026-08-02T01:00:00Z'),
      },
      {
        id: 'e-3',
        holdingId: 'h-2',
        tsCode: '000002.SZ',
        afterQuantity: 40,
        afterAvgCost: new Decimal(25),
        occurredAt: new Date('2026-08-02T02:00:00Z'),
      },
    ])
    prisma.$queryRaw.mockResolvedValue([{ tsCode: '000002.SZ', tradeDate: new Date('2026-08-04'), close: 30 }])
    prisma.portfolioDailySnapshot.findFirst.mockResolvedValue(null)
    prisma.portfolioDailySnapshot.findUnique.mockResolvedValue(null)
    prisma.indexDaily.findFirst.mockResolvedValue(null)

    await service.rebuildPortfolioDate('p-1', new Date('2026-08-04'))

    const rows = tx.portfolioPositionSnapshot.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(1)
    expect(rows[0].tsCode).toBe('000002.SZ')
    expect(Number(tx.portfolioDailySnapshot.upsert.mock.calls[0][0].create.totalAssets)).toBe(10_200)
  })

  it('[AUDIT] 不使用新算法静默覆盖已有快照', async () => {
    const { service, prisma, tx } = harness()
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', initialCash: new Decimal(10_000) })
    prisma.portfolioHoldingEvent.findMany.mockResolvedValue([
      {
        id: 'e-1',
        holdingId: 'h-1',
        tsCode: '000001.SZ',
        afterQuantity: 100,
        afterAvgCost: new Decimal(10),
        occurredAt: new Date(),
      },
    ])
    prisma.$queryRaw.mockResolvedValue([{ tsCode: '000001.SZ', tradeDate: new Date('2026-08-04'), close: 10 }])
    prisma.portfolioDailySnapshot.findFirst.mockResolvedValue(null)
    prisma.portfolioDailySnapshot.findUnique.mockResolvedValue({ algorithmVersion: 'portfolio-nav.v0' })
    prisma.indexDaily.findFirst.mockResolvedValue(null)

    await expect(service.rebuildPortfolioDate('p-1', new Date('2026-08-04'))).rejects.toEqual(
      expect.objectContaining<Partial<PortfolioSnapshotError>>({ code: 'ALGORITHM_VERSION_CONFLICT' }),
    )
    expect(tx.portfolioDailySnapshot.upsert).not.toHaveBeenCalled()
    expect(PORTFOLIO_NAV_ALGORITHM_VERSION).toBe('portfolio-nav.v1')
  })
})
