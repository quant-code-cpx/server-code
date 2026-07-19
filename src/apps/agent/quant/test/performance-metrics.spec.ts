import {
  computePerformanceMetrics,
  PERFORMANCE_METRICS_ALGORITHM_VERSION,
  QuantCalculationError,
} from '../performance-metrics'

describe('computePerformanceMetrics', () => {
  it('用手算净值序列计算收益、样本波动、回撤和尾部风险', () => {
    const result = computePerformanceMetrics({
      seriesType: 'EQUITY',
      points: [
        { date: '2024-01-01', value: 100 },
        { date: '2024-02-01', value: 110 },
        { date: '2024-03-01', value: 99 },
      ],
      annualizationFactor: 12,
      riskFreeRateAnnual: 0,
    })
    const metrics = new Map(result.metrics.map((metric) => [metric.key, metric.value]))

    expect(result.algorithmVersion).toBe(PERFORMANCE_METRICS_ALGORITHM_VERSION)
    expect(metrics.get('TOTAL_RETURN')).toBeCloseTo(-0.01, 12)
    expect(metrics.get('CAGR')).toBeCloseTo(0.99 ** 6 - 1, 12)
    expect(metrics.get('ANNUAL_VOLATILITY')).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(12), 12)
    expect(metrics.get('SHARPE')).toBeCloseTo(0, 12)
    expect(metrics.get('SORTINO')).toBeCloseTo(0, 12)
    expect(metrics.get('MAX_DRAWDOWN')).toBeCloseTo(-0.1, 12)
    expect(metrics.get('CALMAR')).toBeCloseTo((0.99 ** 6 - 1) / 0.1, 12)
    expect(metrics.get('WIN_RATE')).toBe(0.5)
    expect(metrics.get('VAR_95')).toBeCloseTo(0.1, 12)
    expect(metrics.get('CVAR_95')).toBeCloseTo(0.1, 12)
  })

  it('RETURN 输入按小数比例复利，不把 0.01 当 1%', () => {
    const result = computePerformanceMetrics({
      seriesType: 'RETURN',
      points: [
        { date: '2024-01-05', value: 0.01 },
        { date: '2024-01-12', value: -0.02 },
        { date: '2024-01-19', value: 0.03 },
      ],
      annualizationFactor: 52,
      riskFreeRateAnnual: 0,
      metrics: ['TOTAL_RETURN', 'WIN_RATE'],
    })
    expect(result.metrics[0].key).toBe('TOTAL_RETURN')
    expect(result.metrics[0].value).toBeCloseTo(1.01 * 0.98 * 1.03 - 1, 12)
    expect(result.metrics[1]).toEqual(expect.objectContaining({ key: 'WIN_RATE', value: 2 / 3 }))
  })

  it('固定处理完全损失、零波动和无回撤不可计算项', () => {
    const totalLoss = computePerformanceMetrics({
      seriesType: 'RETURN',
      points: [
        { date: '2024-01-01', value: -1 },
        { date: '2024-01-02', value: 0 },
      ],
      annualizationFactor: 252,
      riskFreeRateAnnual: 0,
      metrics: ['TOTAL_RETURN', 'CAGR', 'MAX_DRAWDOWN'],
    })
    expect(totalLoss.metrics.map((metric) => metric.value)).toEqual([-1, -1, -1])
    expect(totalLoss.warnings.map((warning) => warning.code)).toContain('TOTAL_LOSS')

    const flat = computePerformanceMetrics({
      seriesType: 'EQUITY',
      points: [
        { date: '2024-01-01', value: 1 },
        { date: '2024-01-02', value: 1 },
      ],
      annualizationFactor: 252,
      riskFreeRateAnnual: 0,
      metrics: ['SHARPE', 'SORTINO', 'CALMAR'],
    })
    expect(flat.metrics.map((metric) => metric.value)).toEqual([null, null, null])
  })

  it('日期排序稳定；重复日期、非有限数和非法收益 fail closed', () => {
    const sorted = computePerformanceMetrics({
      seriesType: 'EQUITY',
      points: [
        { date: '2024-01-02', value: 110 },
        { date: '2024-01-01', value: 100 },
      ],
      annualizationFactor: 252,
      riskFreeRateAnnual: 0,
      metrics: ['TOTAL_RETURN'],
    })
    expect(sorted.sample.startDate).toBe('2024-01-01')
    expect(sorted.metrics[0].value).toBeCloseTo(0.1, 12)

    expect(() =>
      computePerformanceMetrics({
        seriesType: 'EQUITY',
        points: [
          { date: '2024-01-01', value: 100 },
          { date: '2024-01-01', value: 101 },
        ],
        annualizationFactor: 252,
        riskFreeRateAnnual: 0,
      }),
    ).toThrow(QuantCalculationError)
    expect(() =>
      computePerformanceMetrics({
        seriesType: 'RETURN',
        points: [
          { date: '2024-01-01', value: 0 },
          { date: '2024-01-02', value: Number.NaN },
        ],
        annualizationFactor: 252,
        riskFreeRateAnnual: 0,
      }),
    ).toThrow('非有限数')
    expect(() =>
      computePerformanceMetrics({
        seriesType: 'RETURN',
        points: [
          { date: '2024-01-01', value: 0 },
          { date: '2024-01-02', value: -1.01 },
        ],
        annualizationFactor: 252,
        riskFreeRateAnnual: 0,
      }),
    ).toThrow('不能小于 -1')
  })
})
