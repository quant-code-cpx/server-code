import { QuantCalculationError } from '../performance-metrics'
import { computeValuationPercentile } from '../valuation-percentile'

describe('computeValuationPercentile', () => {
  it('WEAK 与 MEAN 分位按固定秩定义计算', () => {
    const series = [1, 2, 2, 4].map((value, index) => ({ date: `2024-01-0${index + 1}`, value }))
    const weak = computeValuationPercentile(series, {
      percentileMethod: 'WEAK',
      excludeNonPositive: true,
      winsorize: 'NONE',
      minimumSamples: 4,
    })
    const mean = computeValuationPercentile(series, {
      percentileMethod: 'MEAN',
      excludeNonPositive: true,
      winsorize: 'NONE',
      minimumSamples: 4,
    })
    expect(weak.percentile).toBe(1)
    expect(mean.percentile).toBe(0.875)
    expect(mean.statistics).toEqual({ min: 1, max: 4, median: 2 })
  })

  it('过滤缺失/非正值并对 P1/P99 缩尾', () => {
    const series = [
      { date: '2024-01-01', value: null },
      { date: '2024-01-02', value: -1 },
      ...Array.from({ length: 100 }, (_, index) => ({
        date: new Date(Date.UTC(2024, 0, index + 3)).toISOString().slice(0, 10),
        value: index + 1,
      })),
    ]
    const result = computeValuationPercentile(series, {
      percentileMethod: 'WEAK',
      excludeNonPositive: true,
      winsorize: 'P1_P99',
      minimumSamples: 60,
    })
    expect(result.currentValue).toBe(100)
    expect(result.percentileValue).toBeCloseTo(99.01, 12)
    expect(result.filtered).toEqual({ missingOrNonFinite: 1, nonPositive: 1, winsorized: 2 })
    expect(result.percentile).toBe(1)
  })

  it('有效样本不足与重复日期 fail closed', () => {
    expect(() =>
      computeValuationPercentile([{ date: '2024-01-01', value: 1 }], {
        percentileMethod: 'WEAK',
        excludeNonPositive: true,
        winsorize: 'NONE',
        minimumSamples: 2,
      }),
    ).toThrow('有效估值样本不足')
    expect(() =>
      computeValuationPercentile(
        [
          { date: '2024-01-01', value: 1 },
          { date: '2024-01-01', value: 2 },
        ],
        { percentileMethod: 'WEAK', excludeNonPositive: true, winsorize: 'NONE', minimumSamples: 2 },
      ),
    ).toThrow(QuantCalculationError)
  })
})
