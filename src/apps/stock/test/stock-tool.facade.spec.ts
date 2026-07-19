import { StockToolFacade } from '../stock-tool.facade'
import { StockDetailService } from '../stock-detail.service'
import { AdjustType, ChartPeriod } from '../dto/stock-detail-chart.dto'

function prismaMock() {
  return {
    stockBasic: { findMany: jest.fn(), findUnique: jest.fn() },
    fundBasic: { findMany: jest.fn() },
    optBasic: { findMany: jest.fn() },
    daily: { findMany: jest.fn(), findFirst: jest.fn() },
    dailyBasic: { findMany: jest.fn(), findFirst: jest.fn() },
    indexMemberAll: { findMany: jest.fn() },
    adjFactor: { findFirst: jest.fn() },
    stockCompany: { findUnique: jest.fn() },
    express: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  }
}

describe('StockToolFacade', () => {
  it('[SMT-BIZ-001] exact code 优先，默认查询条件排除退市股票', async () => {
    const prisma = prismaMock()
    prisma.stockBasic.findMany.mockResolvedValue([
      {
        tsCode: '600000.SH',
        symbol: '600000',
        name: '浦发银行',
        exchange: 'SSE',
        listStatus: 'L',
        listDate: new Date('1999-11-10T00:00:00.000Z'),
        delistDate: null,
      },
      {
        tsCode: '600001.SH',
        symbol: '600001',
        name: '测试600000',
        exchange: 'SSE',
        listStatus: 'L',
        listDate: null,
        delistDate: null,
      },
    ])
    const facade = new StockToolFacade(prisma as never)

    const value = await facade.resolveSecurity({ query: '600000.SH', securityTypes: ['STOCK'] })

    expect(value.candidates[0]).toMatchObject({ tsCode: '600000.SH', matchScore: 1 })
    expect(prisma.stockBasic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ listStatus: null }, { listStatus: { not: 'D' } }] }]),
        }),
      }),
    )
  })

  it('[SMT-BIZ-001/EDGE-001] 基金与期权解析使用真实类型，includeDelisted 不注入退市过滤', async () => {
    const prisma = prismaMock()
    prisma.fundBasic.findMany.mockResolvedValue([
      {
        tsCode: '510300.SH',
        name: '沪深300ETF',
        market: 'E',
        status: 'L',
        listDate: new Date('2012-05-28T00:00:00.000Z'),
        delistDate: null,
      },
    ])
    prisma.optBasic.findMany.mockResolvedValue([
      {
        tsCode: '10000001.SH',
        optCode: 'OPT001',
        name: '测试认购期权',
        exchange: 'SSE',
        listDate: new Date('2024-01-01T00:00:00.000Z'),
        delistDate: new Date('2024-12-31T00:00:00.000Z'),
      },
    ])
    const facade = new StockToolFacade(prisma as never)

    const fund = await facade.resolveSecurity({
      query: '510300.SH',
      securityTypes: ['FUND'],
      includeDelisted: true,
    })
    const option = await facade.resolveSecurity({ query: 'OPT001', securityTypes: ['OPTION'], includeDelisted: true })

    expect(fund.candidates[0]).toMatchObject({ tsCode: '510300.SH', securityType: 'FUND', matchScore: 1 })
    expect(option.candidates[0]).toMatchObject({ tsCode: '10000001.SH', securityType: 'OPTION', matchScore: 1 })
    expect(prisma.fundBasic.findMany.mock.calls[0][0].where.AND).toHaveLength(1)
    expect(prisma.optBasic.findMany.mock.calls[0][0].where.AND).toHaveLength(1)
  })

  it('[SMT-BIZ-001] 两个近分名称候选标记 ambiguous，不自动选择', async () => {
    const prisma = prismaMock()
    prisma.stockBasic.findMany.mockResolvedValue([
      {
        tsCode: '600000.SH',
        symbol: '600000',
        name: '浦发银行',
        exchange: 'SSE',
        listStatus: 'L',
        listDate: null,
        delistDate: null,
      },
      {
        tsCode: '000001.SZ',
        symbol: '000001',
        name: '平安银行',
        exchange: 'SZSE',
        listStatus: 'L',
        listDate: null,
        delistDate: null,
      },
    ])
    const facade = new StockToolFacade(prisma as never)

    const value = await facade.resolveSecurity({ query: '银行', securityTypes: ['STOCK'] })

    expect(value.candidates).toHaveLength(2)
    expect(value.ambiguous).toBe(true)
  })

  it('[SMT-DATA-001] QFQ=raw*factor/latestFactor，null 保持 null，结果按日期升序', async () => {
    const prisma = prismaMock()
    prisma.$queryRaw.mockResolvedValue([
      {
        tradeDate: new Date('2024-01-03T00:00:00.000Z'),
        open: 20,
        high: 22,
        low: 19,
        close: 20,
        preClose: 18,
        pctChange: 11.11,
        volume: 200,
        amount: 300,
        turnoverRate: 2,
        peTtm: 10,
        adjFactor: 2,
      },
      {
        tradeDate: new Date('2024-01-02T00:00:00.000Z'),
        open: 10,
        high: 11,
        low: null,
        close: 10,
        preClose: 9,
        pctChange: 1.25,
        volume: 100,
        amount: 150,
        turnoverRate: 1,
        peTtm: 9,
        adjFactor: 1,
      },
    ])
    prisma.adjFactor.findFirst.mockResolvedValue({
      adjFactor: 2,
      tradeDate: new Date('2024-01-03T00:00:00.000Z'),
    })
    const facade = new StockToolFacade(prisma as never)

    const value = await facade.getPriceHistory({
      tsCode: '600000.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-03',
      frequency: 'DAILY',
      adjustment: 'FORWARD',
      fields: ['open', 'low', 'close', 'pctChange', 'volume', 'amount'],
      limit: 2,
    })

    expect(value.data.bars).toEqual([
      {
        tradeDate: '2024-01-02',
        open: 5,
        low: null,
        close: 5,
        pctChange: 1.25,
        volume: 100,
        amount: 150,
      },
      {
        tradeDate: '2024-01-03',
        open: 20,
        low: 19,
        close: 20,
        pctChange: 11.11,
        volume: 200,
        amount: 300,
      },
    ])
    expect(value.asOf).toBe('2024-01-03')
    expect(value.truncated).toBe(false)
  })

  it('[SMT-EDGE-002/DATA-001] 周线 HFQ 使用 raw*factor，pctChange 保持百分数，超限取最近 N 条', async () => {
    const prisma = prismaMock()
    prisma.$queryRaw.mockResolvedValue([
      {
        tradeDate: new Date('2024-01-19T00:00:00.000Z'),
        close: 12,
        pctChange: 20,
        adjFactor: 3,
      },
      {
        tradeDate: new Date('2024-01-12T00:00:00.000Z'),
        close: 10,
        pctChange: 10,
        adjFactor: 2,
      },
      {
        tradeDate: new Date('2024-01-05T00:00:00.000Z'),
        close: 8,
        pctChange: 5,
        adjFactor: 1,
      },
    ])
    prisma.adjFactor.findFirst.mockResolvedValue({
      adjFactor: 3,
      tradeDate: new Date('2024-01-19T00:00:00.000Z'),
    })
    const facade = new StockToolFacade(prisma as never)

    const value = await facade.getPriceHistory({
      tsCode: '600000.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      frequency: 'WEEKLY',
      adjustment: 'BACKWARD',
      fields: ['close', 'pctChange'],
      limit: 2,
    })

    expect(value.data.bars).toEqual([
      { tradeDate: '2024-01-12', close: 20, pctChange: 10 },
      { tradeDate: '2024-01-19', close: 36, pctChange: 20 },
    ])
    expect(value.truncated).toBe(true)
  })

  it('[SMT-EDGE-003] 复权请求缺因子时拒绝返回看似有效价格', async () => {
    const prisma = prismaMock()
    prisma.$queryRaw.mockResolvedValue([
      {
        tradeDate: new Date('2024-01-02T00:00:00.000Z'),
        close: 10,
        adjFactor: null,
      },
    ])
    prisma.adjFactor.findFirst.mockResolvedValue(null)
    const facade = new StockToolFacade(prisma as never)

    await expect(
      facade.getPriceHistory({
        tsCode: '600000.SH',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        frequency: 'DAILY',
        adjustment: 'FORWARD',
        fields: ['close'],
        limit: 100,
      }),
    ).rejects.toThrow('缺少可用复权因子')
  })

  it('[SMT-DATA-002] historical overview 给行情、估值和行业查询统一下推 asOfDate', async () => {
    const prisma = prismaMock()
    prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '600000.SH', name: '浦发银行' }])
    prisma.daily.findMany.mockResolvedValue([])
    prisma.dailyBasic.findMany.mockResolvedValue([])
    prisma.indexMemberAll.findMany.mockResolvedValue([])
    const facade = new StockToolFacade(prisma as never)

    await facade.getOverview({ tsCodes: ['600000.SH'], asOfDate: '2024-06-30' })

    const cutoff = new Date('2024-06-30T00:00:00.000Z')
    expect(prisma.daily.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tradeDate: { lte: cutoff } }) }),
    )
    expect(prisma.dailyBasic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tradeDate: { lte: cutoff } }) }),
    )
    expect(prisma.indexMemberAll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ inDate: { lte: cutoff } }) }),
    )
  })
})

describe('StockDetailService regression', () => {
  function cacheMock() {
    return {
      buildKey: jest.fn(() => 'stock:overview:test'),
      rememberJson: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => loader()),
    }
  }

  it('[SMT-REG-001] 现有图表前复权公式同步修为 factor/latestFactor', async () => {
    const prisma = prismaMock()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          tradeDate: new Date('2024-01-02T00:00:00.000Z'),
          open: 10,
          high: 10,
          low: 10,
          close: 10,
          vol: 100,
          amount: 100,
          pctChg: 0,
          adjFactor: 1,
        },
        {
          tradeDate: new Date('2024-01-03T00:00:00.000Z'),
          open: 20,
          high: 20,
          low: 20,
          close: 20,
          vol: 100,
          amount: 100,
          pctChg: 100,
          adjFactor: 2,
        },
      ])
      .mockResolvedValueOnce([{ hasMore: false }])
    const service = new StockDetailService(prisma as never, cacheMock() as never)

    const value = await service.getDetailChart({
      tsCode: '600000.SH',
      period: ChartPeriod.DAILY,
      adjustType: AdjustType.QFQ,
      startDate: '20240101',
      endDate: '20240103',
    })

    expect(value.items.map((item) => item.close)).toEqual([5, 20])
  })

  it('[SMT-REG-001] 历史 overview 的快报公告日不晚于请求时点', async () => {
    const prisma = prismaMock()
    prisma.stockBasic.findUnique.mockResolvedValue({
      tsCode: '600000.SH',
      symbol: '600000',
      name: '浦发银行',
      exchange: 'SSE',
    })
    prisma.stockCompany.findUnique.mockResolvedValue(null)
    prisma.daily.findFirst.mockResolvedValue(null)
    prisma.dailyBasic.findFirst.mockResolvedValue(null)
    prisma.express.findFirst.mockResolvedValue(null)
    const service = new StockDetailService(prisma as never, cacheMock() as never)

    await service.getDetailOverview('600000.SH', '20240630')

    expect(prisma.express.findFirst).toHaveBeenCalledWith({
      where: { tsCode: '600000.SH', annDate: { lte: new Date('2024-06-30T00:00:00.000Z') } },
      orderBy: { annDate: 'desc' },
    })
  })
})
