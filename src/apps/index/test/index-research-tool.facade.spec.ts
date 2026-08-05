import { IndexResearchToolFacade } from '../index-research-tool.facade'

describe('IndexResearchToolFacade', () => {
  const first = new Date('2026-08-03T00:00:00.000Z')
  const latest = new Date('2026-08-04T00:00:00.000Z')
  const bar = (tradeDate: Date, close: number, preClose: number) => ({
    tsCode: '000300.SH',
    tradeDate,
    open: preClose,
    high: close + 1,
    low: preClose - 1,
    close,
    preClose,
    change: close - preClose,
    pctChg: (close / preClose - 1) * 100,
    vol: 100,
    amount: 1_000,
    syncedAt: latest,
  })
  const repository = {
    findAny: jest.fn(async () => ({ tsCode: '000300.SH' })),
    findDailyBounds: jest.fn(async () => [{ tradeDate: first }, { tradeDate: latest }]),
    findLatestDaily: jest.fn(async () => bar(latest, 12, 10)),
    findDailyRange: jest.fn(async () => [bar(first, 10, 9), bar(latest, 12, 10)]),
    findValuationBounds: jest.fn(async () => [null, null]),
    findValuationRange: jest.fn(async () => []),
    findConstituents: jest.fn(async () => ({
      weightDate: '20260630',
      total: 2,
      items: [
        { tsCode: '600000.SH', name: '浦发银行', weightPct: 2 },
        { tsCode: '600519.SH', name: '贵州茅台', weightPct: 6 },
      ],
    })),
  }
  const facade = new IndexResearchToolFacade(repository as never)

  it('[手算验证] 返回周线聚合和不晚于 asOf 的最近权重日', async () => {
    const result = await facade.getMarketData({
      indexCode: '000300.SH',
      sections: ['HISTORY', 'CONSTITUENTS'],
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      frequency: 'W',
      constituentLimit: 2,
    })

    expect(result.data.history.status).toBe('OK')
    if (result.data.history.status === 'OK') {
      expect(result.data.history.data[0].close).toBe(12)
      expect(result.data.history.data[0].pctChg).toBeCloseTo(100 / 3, 8)
    }
    expect(result.data.constituents.status).toBe('OK')
    if (result.data.constituents.status === 'OK') {
      expect(result.data.constituents.data.weightDate).toBe('2026-06-30')
    }
  })

  it('未知指数 fail-closed', async () => {
    repository.findAny.mockResolvedValueOnce(null)
    await expect(facade.getMarketData({ indexCode: '999999.SH' })).rejects.toMatchObject({ code: 'DATA_NOT_FOUND' })
  })

  it('[BUDGET] 多 section 共享 2,500 行预算并对长序列确定性采样', async () => {
    const dates = Array.from({ length: 1_200 }, (_, index) => {
      const value = new Date('2023-01-01T00:00:00.000Z')
      value.setUTCDate(value.getUTCDate() + index)
      return value
    })
    repository.findDailyRange.mockResolvedValueOnce(dates.map((value, index) => bar(value, index + 2, index + 1)))
    repository.findValuationRange.mockResolvedValueOnce(
      dates.map((tradeDate) => ({
        tradeDate,
        pe: 10,
        peTtm: 11,
        pb: 2,
        turnoverRate: 1,
        totalMv: 100,
      })),
    )

    const result = await facade.getMarketData({
      indexCode: '000300.SH',
      sections: ['BASIC', 'QUOTE', 'HISTORY', 'VALUATION', 'CONSTITUENTS'],
      startDate: '2023-01-01',
      endDate: '2026-04-14',
      constituentLimit: 500,
    })

    expect(result.data.history.status).toBe('OK')
    expect(result.data.valuation.status).toBe('OK')
    if (result.data.history.status === 'OK' && result.data.valuation.status === 'OK') {
      expect(result.data.history.data).toHaveLength(832)
      expect(result.data.valuation.data).toHaveLength(832)
      expect(result.data.history.data[0].tradeDate).toBe('2023-01-01')
      expect(result.data.history.data.at(-1)?.tradeDate).toBe('2026-04-14')
    }
    expect(repository.findConstituents).toHaveBeenLastCalledWith('000300.SH', '20260804', 500)
    expect(result.truncated).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['INDEX_HISTORY_SAMPLED', 'INDEX_VALUATION_SAMPLED']),
    )
  })
})
