import { FundResearchToolFacade } from '../fund-research-tool.facade'

describe('FundResearchToolFacade', () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
  const repository = {
    findBasic: jest.fn(async () => ({
      tsCode: '510300.SH',
      name: '沪深300ETF',
      management: '基金公司',
      custodian: '托管行',
      fundType: '股票型',
      foundDate: date('2020-01-01'),
      dueDate: null,
      listDate: date('2020-01-02'),
      issueAmount: 10,
      benchmark: '沪深300',
      status: 'L',
      market: 'E',
      syncedAt: date('2026-08-04'),
    })),
    findBounds: jest.fn(async () => ({
      navStart: null,
      navEnd: null,
      priceStart: { tradeDate: date('2026-08-01') },
      priceEnd: { tradeDate: date('2026-08-04') },
      shareStart: { tradeDate: date('2026-08-01') },
      shareEnd: { tradeDate: date('2026-08-04') },
      holdingsStart: null,
      holdingsEnd: null,
    })),
    findNavRange: jest.fn(async () => []),
    findPriceRange: jest.fn(async () => [
      {
        tradeDate: date('2026-08-03'),
        open: 2,
        high: 2,
        low: 2,
        close: 2,
        preClose: 2,
        change: 0,
        pctChg: 0,
        vol: 1,
        amount: 2,
      },
      {
        tradeDate: date('2026-08-04'),
        open: 2.5,
        high: 2.5,
        low: 2.5,
        close: 2.5,
        preClose: 2,
        change: 0.5,
        pctChg: 25,
        vol: 1,
        amount: 2.5,
      },
    ]),
    findShareRange: jest.fn(async () => [
      { tradeDate: date('2026-08-03'), fdShare: 110 },
      { tradeDate: date('2026-08-04'), fdShare: 120 },
    ]),
    findPreviousShare: jest.fn(async () => ({ tradeDate: date('2026-08-02'), fdShare: 100 })),
    findHoldings: jest.fn(async () => []),
  }
  const facade = new FundResearchToolFacade(repository as never)

  it('[手算验证] ETF 估算流入 = 份额变化(万份) × 10000 × 同日收盘价', async () => {
    const result = await facade.getResearch({
      fundCode: '510300.SH',
      sections: ['ETF_FLOW'],
      startDate: '2026-08-03',
      endDate: '2026-08-04',
    })

    expect(result.data.etfFlow.status).toBe('OK')
    if (result.data.etfFlow.status === 'OK') {
      expect(result.data.etfFlow.data.map((point) => point.estimatedNetFlow)).toEqual([200_000, 250_000])
      expect(result.data.etfFlow.data.every((point) => point.isEstimated)).toBe(true)
    }
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ETF_FLOW_IS_ESTIMATED' })]),
    )
  })

  it('非法基金代码拒绝执行', async () => {
    await expect(facade.getResearch({ fundCode: '600000.BJ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('[BUDGET] 四个长序列共享 3,000 行预算', async () => {
    const dates = Array.from({ length: 1_000 }, (_, index) => {
      const value = date('2023-01-01')
      value.setUTCDate(value.getUTCDate() + index)
      return value
    })
    repository.findNavRange.mockResolvedValueOnce(
      dates.map((navDate) => ({
        navDate,
        annDate: navDate,
        unitNav: 1,
        accumNav: 1,
        adjNav: 1,
        accumDiv: 0,
        netAsset: 1,
        totalNetasset: 1,
      })),
    )
    repository.findPriceRange.mockResolvedValueOnce(
      dates.map((tradeDate) => ({
        tradeDate,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        preClose: 1,
        change: 0,
        pctChg: 0,
        vol: 1,
        amount: 1,
      })),
    )
    repository.findShareRange.mockResolvedValueOnce(dates.map((tradeDate, index) => ({ tradeDate, fdShare: index })))

    const result = await facade.getResearch({
      fundCode: '510300.SH',
      sections: ['BASIC', 'NAV', 'PRICE', 'SHARE', 'HOLDINGS', 'ETF_FLOW'],
      holdingPeriods: 12,
      maxSeriesPoints: 1_000,
      startDate: '2023-01-01',
      endDate: '2025-09-26',
    })

    const series = [result.data.nav, result.data.price, result.data.share, result.data.etfFlow]
    for (const sectionResult of series) {
      expect(sectionResult.status).toBe('OK')
      if (sectionResult.status === 'OK') expect(sectionResult.data).toHaveLength(746)
    }
    expect(result.truncated).toBe(true)
  })
})
