import { MarketToolFacade } from '../market-tool.facade'

describe('MarketToolFacade', () => {
  it('[SMT-BIZ-004] 每个 section 保留独立 asOf/status，缓存 key 覆盖全部请求维度', async () => {
    const marketService = {
      getIndexQuote: jest.fn().mockResolvedValue([
        {
          tsCode: '000001.SH',
          tradeDate: new Date('2024-07-01T00:00:00.000Z'),
          open: 3000,
          high: 3050,
          low: 2980,
          close: 3030,
          preClose: 3000,
          pctChg: 1,
          vol: 10,
          amount: 20,
        },
      ]),
      getMarketBreadth: jest.fn().mockResolvedValue({
        tradeDate: new Date('2024-07-02T00:00:00.000Z'),
        limitUp: 50,
        limitDown: 5,
        bigRise: 100,
        rise: 2000,
        flat: 20,
        fall: 1800,
        bigFall: 80,
        total: 4000,
        limitUpBroken: 10,
      }),
    }
    const cache = {
      buildKey: jest.fn(() => 'agent:market-snapshot:key'),
      rememberJson: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => loader()),
    }
    const config = { marketCacheTtlSeconds: 300 }
    const facade = new MarketToolFacade(marketService as never, cache as never, config as never)

    const value = await facade.snapshot({
      tradeDate: '2024-07-03',
      sections: ['INDEX_QUOTES', 'BREADTH'],
      sectorType: 'CONCEPT',
      topN: 7,
    })

    expect(value.data.sections).toEqual([
      expect.objectContaining({ section: 'INDEX_QUOTES', status: 'OK', asOf: '2024-07-01' }),
      expect.objectContaining({ section: 'BREADTH', status: 'OK', asOf: '2024-07-02' }),
    ])
    expect(cache.buildKey).toHaveBeenCalledWith(
      'agent:market-snapshot',
      expect.objectContaining({
        tradeDate: '2024-07-03',
        sections: ['INDEX_QUOTES', 'BREADTH'],
        sectorType: 'CONCEPT',
        topN: 7,
        schemaVersion: 'market-snapshot-v1',
      }),
    )
    expect(cache.rememberJson).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 300 }))
  })

  it('[SMT-ERR-003] 单 section 失败不伪装成功，也不抹掉其他 section', async () => {
    const marketService = {
      getIndexQuote: jest.fn().mockRejectedValue(new Error('database detail must not escape')),
      getMarketSentiment: jest.fn().mockResolvedValue(null),
    }
    const cache = {
      buildKey: jest.fn(() => 'key'),
      rememberJson: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => loader()),
    }
    const facade = new MarketToolFacade(marketService as never, cache as never, { marketCacheTtlSeconds: 60 } as never)

    const value = await facade.snapshot({ sections: ['INDEX_QUOTES', 'SENTIMENT'], topN: 10 })

    expect(value.data.sections[0]).toEqual(
      expect.objectContaining({
        section: 'INDEX_QUOTES',
        status: 'ERROR',
        asOf: null,
        warning: '该市场分区暂时不可用',
      }),
    )
    expect(value.data.sections[1]).toEqual(expect.objectContaining({ section: 'SENTIMENT', status: 'MISSING' }))
    expect(JSON.stringify(value)).not.toContain('database detail')
  })

  it('[SMT-BIZ-004] 八类 section 均有独立规范化结果，HSGT 保留百万元单位', async () => {
    const tradeDate = new Date('2024-07-02T00:00:00.000Z')
    const marketService = {
      getIndexQuote: jest.fn().mockResolvedValue([]),
      getMarketBreadth: jest.fn().mockResolvedValue({ tradeDate, total: 4000 }),
      getMarketValuation: jest.fn().mockResolvedValue({ tradeDate, peTtmMedian: 15 }),
      getMarketSentiment: jest.fn().mockResolvedValue({ tradeDate, rise: 2100, total: 4000 }),
      getMarketMoneyFlow: jest.fn().mockResolvedValue({ tradeDate, totalAmount: 1_000_000 }),
      getHsgtFlow: jest.fn().mockResolvedValue({ tradeDate, history: [{ tradeDate, northMoney: 123.4 }] }),
      getSectorFlowRanking: jest.fn().mockResolvedValue({
        tradeDate,
        topInflow: [{ tsCode: 'BK001.DC', name: '银行', pctChange: 2 }],
        topOutflow: [{ tsCode: 'BK002.DC', name: '煤炭', pctChange: -2 }],
      }),
      getDataDates: jest.fn().mockResolvedValue({
        daily: '20240702',
        index: '20240701',
        sector: '20240702',
        moneyflow: '20240702',
        dailyBasic: '20240702',
        hsgt: '20240701',
      }),
    }
    const cache = {
      buildKey: jest.fn(() => 'key'),
      rememberJson: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => loader()),
    }
    const facade = new MarketToolFacade(marketService as never, cache as never, { marketCacheTtlSeconds: 60 } as never)

    const value = await facade.snapshot({
      sections: [
        'INDEX_QUOTES',
        'BREADTH',
        'VALUATION',
        'SENTIMENT',
        'MONEY_FLOW',
        'HSGT',
        'SECTOR_RANKING',
        'DATA_DATES',
      ],
      topN: 10,
    })

    expect(value.data.sections).toHaveLength(8)
    expect(value.data.sections.find((section) => section.section === 'INDEX_QUOTES')?.status).toBe('MISSING')
    expect(value.data.sections.filter((section) => section.status === 'OK')).toHaveLength(7)
    expect(
      value.data.sections
        .find((section) => section.section === 'HSGT')
        ?.rows[0].metrics.find((metric) => metric.key === 'northMoney'),
    ).toEqual({ key: 'northMoney', value: 123.4, unit: 'CNY_MILLION' })
  })
})
