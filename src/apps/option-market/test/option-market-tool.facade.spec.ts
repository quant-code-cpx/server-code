import { OptionMarketToolFacade } from '../option-market-tool.facade'

describe('OptionMarketToolFacade', () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
  const contract = {
    tsCode: '10000001.SH',
    exchange: 'SSE',
    name: '测试认购期权',
    perUnit: '10000',
    optCode: 'OPTSERIES',
    optType: '欧式',
    callPut: 'C',
    exerciseType: 'E',
    exercisePrice: 3,
    sMonth: '202609',
    maturityDate: date('2026-09-23'),
    listDate: date('2026-01-01'),
    delistDate: date('2026-09-23'),
    quoteUnit: '元',
    minPriceChg: '0.0001',
  }
  const repository = {
    search: jest.fn(async () => ({ total: 1, items: [contract] })),
    findContract: jest.fn(async () => contract),
    findDataThrough: jest.fn(async () => date('2026-08-04')),
    findHistory: jest.fn(async () => [
      {
        tradeDate: date('2026-08-03'),
        preSettle: 1,
        preClose: 1,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        settle: 2,
        vol: 10,
        amount: 20,
        oi: 30,
      },
      {
        tradeDate: date('2026-08-04'),
        preSettle: 2,
        preClose: 2,
        open: 2,
        high: 3,
        low: 2,
        close: 3,
        settle: 3,
        vol: 11,
        amount: 22,
        oi: 33,
      },
    ]),
    findHistoryBounds: jest.fn(async () => ({ first: date('2016-01-01'), last: date('2026-08-04') })),
  }
  const facade = new OptionMarketToolFacade(repository as never)

  it('[SEARCH] 映射 C 为 CALL，且不伪造标的映射', async () => {
    const result = await facade.getMarket({ operation: 'SEARCH', asOfDate: '2026-08-04' })

    expect(result.data.operation).toBe('SEARCH')
    if (result.data.operation !== 'SEARCH') throw new Error('expected SEARCH result')
    expect(result.data.items[0]).toMatchObject({
      optionCode: '10000001.SH',
      callPut: 'CALL',
      underlyingCode: null,
      underlyingMappingVerified: false,
    })
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OPTION_UNDERLYING_MAPPING_UNAVAILABLE' })]),
    )
  })

  it('[HISTORY] 返回本地真实覆盖和源单位告警', async () => {
    const result = await facade.getMarket({
      operation: 'HISTORY',
      optionCode: '10000001.SH',
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      asOfDate: '2026-08-04',
    })

    expect(result.data).toMatchObject({ coverageStart: '2016-01-01', dataThrough: '2026-08-04', totalPoints: 2 })
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_UNIT_UNVERIFIED' })]),
    )
  })

  it('[STRICT] CONTRACT 拒绝 SEARCH 专用字段', async () => {
    await expect(
      facade.getMarket({ operation: 'CONTRACT', optionCode: '10000001.SH', nameQuery: '测试' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
