import { calculateAlignedBeta } from '../portfolio-risk.service'

describe('PortfolioRiskService beta alignment', () => {
  it('仅使用股票与基准共有交易日，不能按数组位置错配停牌日', () => {
    const result = calculateAlignedBeta(
      [
        { tradeDate: '20240104', value: 999 },
        { tradeDate: '20240103', value: 3 },
        { tradeDate: '20240102', value: 2 },
        { tradeDate: '20240101', value: 1 },
      ],
      new Map([
        ['20240103', 4],
        ['20240102', 2],
        ['20240101', 1],
        ['20231229', -999],
      ]),
      3,
    )

    // 共有日股票 [3,2,1]、基准 [4,2,1]
    // population covariance = 1，benchmark variance = 14/9，beta = 9/14
    expect(result.dataPoints).toBe(3)
    expect(result.beta).toBeCloseTo(9 / 14, 4)
  })

  it('共有交易日不足或基准零方差时返回 null', () => {
    expect(calculateAlignedBeta([{ tradeDate: '20240101', value: 1 }], new Map([['20240101', 1]]), 2)).toEqual({
      beta: null,
      dataPoints: 1,
    })
    expect(
      calculateAlignedBeta(
        [
          { tradeDate: '20240101', value: 1 },
          { tradeDate: '20240102', value: 2 },
        ],
        new Map([
          ['20240101', 1],
          ['20240102', 1],
        ]),
        2,
      ),
    ).toEqual({ beta: null, dataPoints: 2 })
    expect(
      calculateAlignedBeta(
        [
          { tradeDate: '20240101', value: 1 },
          { tradeDate: '20240102', value: Number.NaN },
        ],
        new Map([
          ['20240101', 1],
          ['20240102', 2],
        ]),
        2,
      ),
    ).toEqual({ beta: null, dataPoints: 1 })
  })
})
