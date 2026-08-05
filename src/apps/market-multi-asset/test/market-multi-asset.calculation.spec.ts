import {
  aggregateResearchBars,
  deterministicEvenSample,
  stableDescendingRanks,
  type ResearchBar,
} from '../market-multi-asset.calculation'

describe('市场与多资产确定性计算', () => {
  it('[手算验证] 周线 OHLC、成交量和涨跌幅按首尾与区间极值聚合', () => {
    const bars: ResearchBar[] = [
      {
        tradeDate: '2026-08-03',
        open: 9.5,
        high: 11,
        low: 9,
        close: 10,
        preClose: 9,
        change: 1,
        pctChg: 11.1111,
        vol: 100,
        amount: 1_000,
      },
      {
        tradeDate: '2026-08-04',
        open: 10,
        high: 13,
        low: 9.8,
        close: 12,
        preClose: 10,
        change: 2,
        pctChg: 20,
        vol: 200,
        amount: 2_500,
      },
    ]

    const result = aggregateResearchBars(bars, 'W')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tradeDate: '2026-08-04',
      open: 9.5,
      high: 13,
      low: 9,
      close: 12,
      preClose: 9,
      change: 3,
      vol: 300,
      amount: 3_500,
    })
    expect(result[0].pctChg).toBeCloseTo(100 / 3, 8)
  })

  it('等距采样固定保留首尾且结果可重放', () => {
    expect(deterministicEvenSample([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6])
  })

  it('排名按指标降序，同分按代码升序且 topN 前排名不被重算', () => {
    const ranked = stableDescendingRanks(
      [
        { code: 'B', value: 10 },
        { code: 'A', value: 10 },
        { code: 'C', value: 5 },
      ],
      (item) => item.value,
      (item) => item.code,
    )
    expect(ranked.map(({ code, rank }) => ({ code, rank }))).toEqual([
      { code: 'A', rank: 1 },
      { code: 'B', rank: 2 },
      { code: 'C', rank: 3 },
    ])
  })
})
