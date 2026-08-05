import { ConvertibleBondToolFacade } from '../convertible-bond-tool.facade'

describe('ConvertibleBondToolFacade', () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
  const bond = {
    tsCode: '110059.SH',
    bondShortName: '浦发转债',
    bondFullName: '上海浦东发展银行股份有限公司公开发行可转换公司债券',
    stkCode: '600000.SH',
    stkShortName: '浦发银行',
    exchange: 'SSE',
    par: 100,
    issueSize: 500,
    remainSize: 100,
    listDate: date('2019-11-15'),
    delistDate: null,
    maturityDate: date('2025-10-28'),
    convStartDate: date('2020-05-04'),
    convEndDate: date('2025-10-27'),
    convPrice: 13.45,
    couponRate: 2,
    newestRating: 'AAA',
    callClause: '赎回条款',
    putClause: '回售条款',
    resetClause: '下修条款',
    convClause: '转股条款',
  }
  const repository = {
    search: jest.fn(async () => ({ total: 1, items: [bond] })),
    findBasic: jest.fn(async () => bond),
    findDataThrough: jest.fn(async () => date('2026-08-04')),
    findHistory: jest.fn(async () => [
      {
        tradeDate: date('2026-04-07'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        pctChg: 1,
        vol: 10,
        amount: 20,
        bondValue: 90,
        bondOverRate: 11,
        cbValue: 95,
        cbOverRate: 5,
      },
      {
        tradeDate: date('2026-08-04'),
        open: 110,
        high: 111,
        low: 109,
        close: 110,
        pctChg: 2,
        vol: 11,
        amount: 22,
        bondValue: 91,
        bondOverRate: 12,
        cbValue: 96,
        cbOverRate: 6,
      },
    ]),
    findHistoryBounds: jest.fn(async () => ({ first: date('2026-04-07'), last: date('2026-08-04') })),
  }
  const facade = new ConvertibleBondToolFacade(repository as never)

  it('[BASIC] 直接映射条款与转股字段，不现场估算', async () => {
    const result = await facade.getMarket({ operation: 'BASIC', bondCode: '110059.SH' })

    expect(result.data.operation).toBe('BASIC')
    if (result.data.operation !== 'BASIC') throw new Error('expected BASIC result')
    expect(result.data.bond).toMatchObject({
      bondCode: '110059.SH',
      stockCode: '600000.SH',
      currentConversionPrice: 13.45,
      clauses: { redemption: '赎回条款' },
    })
  })

  it('[HISTORY] 历史短于请求区间时返回 PARTIAL_COVERAGE', async () => {
    const result = await facade.getMarket({
      operation: 'HISTORY',
      bondCode: '110059.SH',
      startDate: '2025-08-04',
      endDate: '2026-08-04',
      asOfDate: '2026-08-04',
    })

    expect(result.data).toMatchObject({ coverageStart: '2026-04-07', dataThrough: '2026-08-04' })
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PARTIAL_COVERAGE' })]))
  })

  it('[STRICT] SEARCH 拒绝 HISTORY 专用字段', async () => {
    await expect(facade.getMarket({ operation: 'SEARCH', startDate: '2026-01-01' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})
