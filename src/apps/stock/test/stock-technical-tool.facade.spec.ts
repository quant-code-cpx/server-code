import { StockTechnicalToolError, StockTechnicalToolFacade } from '../stock-technical-tool.facade'

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function buildPrisma() {
  return {
    stockBasic: { findUnique: jest.fn() },
    stkFactor: { findFirst: jest.fn(), findMany: jest.fn() },
  }
}

describe('StockTechnicalToolFacade', () => {
  it('[BIZ] 使用 DESC+take=500 有界查询，并按日期升序返回真实指标与未请求组 null', async () => {
    const prisma = buildPrisma()
    prisma.stockBasic.findUnique.mockResolvedValue({ tsCode: '600089.SH' })
    prisma.stkFactor.findFirst
      .mockResolvedValueOnce({ tradeDate: date('2020-01-02') })
      .mockResolvedValueOnce({ tradeDate: date('2026-08-04') })
    prisma.stkFactor.findMany.mockResolvedValue([factorRow('2026-08-04', 1.2), factorRow('2026-08-01', 0.8)])
    const facade = new StockTechnicalToolFacade(prisma as never)

    const result = await facade.getIndicators({
      tsCode: '600089.sh',
      asOfDate: '2026-08-05',
      lookback: 500,
      indicators: ['MACD', 'RSI'],
    })

    expect(prisma.stkFactor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { tradeDate: 'desc' }, take: 500 }),
    )
    expect(result.data.items.map((item) => item.tradeDate)).toEqual(['2026-08-01', '2026-08-04'])
    expect(result.data.items[1]).toMatchObject({
      close: 10,
      macd: { dif: 1.2, dea: 0.2, histogram: 1 },
      kdj: null,
      rsi: { rsi6: 25, rsi12: 35, rsi24: 45 },
      boll: null,
    })
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'LATEST_READY_TRADE_DATE_USED' })])
  })

  it('[BIZ] 指标字段全空时保持 null 并标记质量 warning，绝不补 0', async () => {
    const prisma = buildPrisma()
    prisma.stockBasic.findUnique.mockResolvedValue({ tsCode: '600089.SH' })
    prisma.stkFactor.findFirst
      .mockResolvedValueOnce({ tradeDate: date('2026-08-04') })
      .mockResolvedValueOnce({ tradeDate: date('2026-08-04') })
    prisma.stkFactor.findMany.mockResolvedValue([{ ...factorRow('2026-08-04', null), macdDea: null, macd: null }])
    const facade = new StockTechnicalToolFacade(prisma as never)

    const result = await facade.getIndicators({ tsCode: '600089.SH', indicators: ['MACD'] })

    expect(result.data.items[0].macd).toEqual({ dif: null, dea: null, histogram: null })
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'INDICATOR_FIELDS_PARTIAL', affectedFields: ['MACD'] }),
    ])
  })

  it.each([
    { stock: null, coverage: null, code: 'DATA_NOT_FOUND' },
    { stock: { tsCode: '600089.SH' }, coverage: null, code: 'DATA_NOT_READY' },
  ])('[ERR] 股票或技术因子缺失映射为 $code', async ({ stock, coverage, code }) => {
    const prisma = buildPrisma()
    prisma.stockBasic.findUnique.mockResolvedValue(stock)
    prisma.stkFactor.findFirst.mockResolvedValue(coverage)
    const facade = new StockTechnicalToolFacade(prisma as never)

    await expect(facade.getIndicators({ tsCode: '600089.SH' })).rejects.toMatchObject({ code })
  })

  it('[ERR] 请求日早于覆盖起点时返回 coverageStart', async () => {
    const prisma = buildPrisma()
    prisma.stockBasic.findUnique.mockResolvedValue({ tsCode: '600089.SH' })
    prisma.stkFactor.findFirst.mockResolvedValueOnce({ tradeDate: date('2020-01-02') })
    const facade = new StockTechnicalToolFacade(prisma as never)

    await expect(facade.getIndicators({ tsCode: '600089.SH', asOfDate: '2019-12-31' })).rejects.toEqual(
      expect.objectContaining<Partial<StockTechnicalToolError>>({
        code: 'DATA_NOT_FOUND',
        details: { coverageStart: '2020-01-02' },
      }),
    )
  })
})

function factorRow(tradeDate: string, macdDif: number | null) {
  return {
    tradeDate: date(tradeDate),
    close: 10,
    macdDif,
    macdDea: 0.2,
    macd: macdDif === null ? null : macdDif - 0.2,
    kdjK: 55,
    kdjD: 45,
    kdjJ: 75,
    rsi6: 25,
    rsi12: 35,
    rsi24: 45,
    bollUpper: 12,
    bollMid: 10,
    bollLower: 8,
  }
}
