import { IndustryRotationToolFacade } from '../industry-rotation-tool.facade'

describe('IndustryRotationToolFacade', () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
  const catalog = [
    { tsCode: '885001.TI', name: '行业A', count: 10 },
    { tsCode: '885002.TI', name: '行业B', count: 20 },
  ]
  const bars = [
    {
      ts_code: '885001.TI',
      name: '行业A',
      member_count: 10,
      trade_date: date('2026-08-04'),
      close: 110,
      open: 105,
      high: 111,
      low: 104,
      pre_close: 100,
      pct_chg: 10,
      vol: 10,
      turnover_rate: 1,
      rn: 1n,
    },
    {
      ts_code: '885001.TI',
      name: '行业A',
      member_count: 10,
      trade_date: date('2026-08-03'),
      close: 100,
      open: 100,
      high: 101,
      low: 99,
      pre_close: 100,
      pct_chg: 0,
      vol: 10,
      turnover_rate: 1,
      rn: 2n,
    },
    {
      ts_code: '885002.TI',
      name: '行业B',
      member_count: 20,
      trade_date: date('2026-08-04'),
      close: 100,
      open: 100,
      high: 101,
      low: 99,
      pre_close: 100,
      pct_chg: 0,
      vol: 10,
      turnover_rate: 1,
      rn: 1n,
    },
    {
      ts_code: '885002.TI',
      name: '行业B',
      member_count: 20,
      trade_date: date('2026-08-03'),
      close: 100,
      open: 100,
      high: 101,
      low: 99,
      pre_close: 100,
      pct_chg: 0,
      vol: 10,
      turnover_rate: 1,
      rn: 2n,
    },
  ]
  const repository = {
    findLatestTradeDate: jest.fn(async () => ({ tradeDate: date('2026-08-04') })),
    findCatalog: jest.fn(async () => catalog),
    findBars: jest.fn(async () => bars),
    findFlows: jest.fn(async () => []),
    findValuations: jest.fn(async () => []),
  }
  const facade = new IndustryRotationToolFacade(repository as never)

  it('[手算验证] 1日收益 10% 的行业排在 0% 行业之前，排名母体未被 topN 重算', async () => {
    const result = await facade.getRotation({ sections: ['RETURN'], periods: [1], topN: 1 })

    expect(result.data.returns.status).toBe('OK')
    if (result.data.returns.status === 'OK') {
      expect(result.data.returns.data[0]).toMatchObject({
        industryCode: '885001.TI',
        returns: { '1': 10 },
        rank: 1,
      })
    }
    expect(result.data.meta.rankingPopulation).toBe(2)
  })

  it('未知 THS 行业代码 fail-closed', async () => {
    repository.findCatalog.mockResolvedValueOnce([])
    await expect(facade.getRotation({ industryCodes: ['999999.TI'] })).rejects.toMatchObject({ code: 'DATA_NOT_FOUND' })
  })

  it('研究工具接受 250 日周期并按 251 根行情上限查询', async () => {
    await facade.getRotation({ sections: ['RETURN'], periods: [60, 120, 250] })

    expect(repository.findBars).toHaveBeenCalledWith(expect.any(Date), 251)
  })

  it('[BUDGET] 全 section 返回不超过 3,000 行，优先截断热力图', async () => {
    const largeCatalog = Array.from({ length: 50 }, (_, index) => ({
      tsCode: `${String(885_100 + index)}.TI`,
      name: `行业${index}`,
      count: 20,
    }))
    const largeBars = largeCatalog.flatMap((industry, industryIndex) =>
      Array.from({ length: 61 }, (_, dayIndex) => {
        const tradeDate = date('2026-08-04')
        tradeDate.setUTCDate(tradeDate.getUTCDate() - dayIndex)
        return {
          ts_code: industry.tsCode,
          name: industry.name,
          member_count: industry.count,
          trade_date: tradeDate,
          close: 100 + industryIndex - dayIndex / 10,
          open: 100,
          high: 101,
          low: 99,
          pre_close: 100,
          pct_chg: industryIndex / 10,
          vol: 10,
          turnover_rate: 1,
          rn: BigInt(dayIndex + 1),
        }
      }),
    )
    repository.findCatalog.mockResolvedValueOnce(largeCatalog)
    repository.findBars.mockResolvedValueOnce(largeBars)
    repository.findFlows.mockResolvedValueOnce(
      largeCatalog.map((industry, index) => ({
        name: industry.name,
        trade_date: date('2026-08-04'),
        sample_days: 20n,
        cumulative_net: index,
        average_net: index,
        latest_net_rate: index,
      })),
    )
    repository.findValuations.mockResolvedValueOnce(
      largeCatalog.map((industry) => ({
        scope: industry.name,
        trade_date: date('2026-08-04'),
        stock_count: 20,
        pe_ttm_median: 10,
        pb_median: 2,
      })),
    )

    const result = await facade.getRotation({
      sections: ['RETURN', 'MOMENTUM', 'FLOW', 'VALUATION', 'HEATMAP', 'DETAIL'],
      periods: [5, 20, 60],
      topN: 50,
      heatmapTradeDays: 60,
    })
    const rowCount = [
      result.data.returns,
      result.data.momentum,
      result.data.flow,
      result.data.valuation,
      result.data.heatmap,
      result.data.detail,
    ].reduce((total, sectionResult) => total + (sectionResult.status === 'OK' ? sectionResult.data.length : 0), 0)

    expect(rowCount).toBe(3_000)
    expect(result.data.heatmap.status).toBe('OK')
    if (result.data.heatmap.status === 'OK') expect(result.data.heatmap.data).toHaveLength(2_750)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INDUSTRY_HEATMAP_TRUNCATED' })]),
    )
    expect(result.truncated).toBe(true)
  })
})
