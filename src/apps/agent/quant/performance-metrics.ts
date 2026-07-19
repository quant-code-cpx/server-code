export const PERFORMANCE_METRICS_ALGORITHM_VERSION = 'performance-metrics-v1'

export const PERFORMANCE_METRIC_KEYS = [
  'TOTAL_RETURN',
  'CAGR',
  'ANNUAL_VOLATILITY',
  'SHARPE',
  'SORTINO',
  'MAX_DRAWDOWN',
  'CALMAR',
  'WIN_RATE',
  'VAR_95',
  'CVAR_95',
] as const

export type PerformanceMetricKey = (typeof PERFORMANCE_METRIC_KEYS)[number]
export type PerformanceSeriesType = 'EQUITY' | 'RETURN'

export interface PerformancePoint {
  date: string
  value: number
}

export interface PerformanceMetricsInput {
  seriesType: PerformanceSeriesType
  points: PerformancePoint[]
  annualizationFactor: 12 | 52 | 242 | 252
  riskFreeRateAnnual: number
  metrics?: PerformanceMetricKey[]
}

export interface QuantWarning {
  code: string
  message: string
}

export interface PerformanceMetricValue {
  key: PerformanceMetricKey
  value: number | null
  unit: 'DECIMAL' | 'RATIO'
  sampleCount: number
}

export interface PerformanceMetricsResult {
  algorithmVersion: string
  seriesType: PerformanceSeriesType
  annualizationFactor: number
  riskFreeRateAnnual: number
  sample: {
    startDate: string
    endDate: string
    pointCount: number
    returnCount: number
  }
  metrics: PerformanceMetricValue[]
  warnings: QuantWarning[]
}

export class QuantCalculationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = QuantCalculationError.name
  }
}

export function computePerformanceMetrics(
  input: PerformanceMetricsInput,
  algorithmVersion = PERFORMANCE_METRICS_ALGORITHM_VERSION,
): PerformanceMetricsResult {
  if (input.points.length < 2) throw new QuantCalculationError('绩效序列至少需要 2 个点')
  if (!Number.isFinite(input.riskFreeRateAnnual) || input.riskFreeRateAnnual <= -1) {
    throw new QuantCalculationError('年化无风险利率必须是大于 -1 的有限数')
  }

  const points = input.points.map((point) => ({ ...point })).sort((left, right) => left.date.localeCompare(right.date))
  const seenDates = new Set<string>()
  for (const point of points) {
    if (!isIsoDate(point.date)) throw new QuantCalculationError(`日期格式无效：${point.date}`)
    if (seenDates.has(point.date)) throw new QuantCalculationError(`绩效序列存在重复日期：${point.date}`)
    if (!Number.isFinite(point.value)) throw new QuantCalculationError(`绩效序列包含非有限数：${point.date}`)
    if (input.seriesType === 'EQUITY' && point.value <= 0) {
      throw new QuantCalculationError(`净值必须大于 0：${point.date}`)
    }
    if (input.seriesType === 'RETURN' && point.value < -1) {
      throw new QuantCalculationError(`收益率不能小于 -1：${point.date}`)
    }
    seenDates.add(point.date)
  }

  const requestedMetrics = input.metrics?.length ? input.metrics : [...PERFORMANCE_METRIC_KEYS]
  if (new Set(requestedMetrics).size !== requestedMetrics.length) {
    throw new QuantCalculationError('metrics 不能包含重复指标')
  }

  const returns =
    input.seriesType === 'EQUITY'
      ? points.slice(1).map((point, index) => point.value / points[index].value - 1)
      : points.map((point) => point.value)
  const returnCount = returns.length
  const totalReturn =
    input.seriesType === 'EQUITY'
      ? points.at(-1)!.value / points[0].value - 1
      : returns.reduce((wealth, value) => wealth * (1 + value), 1) - 1
  const cagr = totalReturn <= -1 ? -1 : Math.pow(1 + totalReturn, input.annualizationFactor / returnCount) - 1
  const returnStdDev = sampleStandardDeviation(returns)
  const annualVolatility = returnStdDev * Math.sqrt(input.annualizationFactor)
  const periodicRiskFreeRate = Math.pow(1 + input.riskFreeRateAnnual, 1 / input.annualizationFactor) - 1
  const excessReturns = returns.map((value) => value - periodicRiskFreeRate)
  const meanExcessReturn = mean(excessReturns)
  const sharpe = returnStdDev > 1e-12 ? (meanExcessReturn / returnStdDev) * Math.sqrt(input.annualizationFactor) : null
  const downsideDeviation = Math.sqrt(mean(excessReturns.map((value) => Math.min(value, 0) ** 2)))
  const sortino =
    downsideDeviation > 1e-12 ? (meanExcessReturn / downsideDeviation) * Math.sqrt(input.annualizationFactor) : null
  const maxDrawdown = calculateMaxDrawdown(input.seriesType, points, returns)
  const calmar = Math.abs(maxDrawdown) > 1e-12 ? cagr / Math.abs(maxDrawdown) : null
  const winRate = returns.filter((value) => value > 0).length / returnCount
  const sortedReturns = [...returns].sort((left, right) => left - right)
  const tailCount = Math.max(1, Math.ceil(sortedReturns.length * 0.05))
  const tail = sortedReturns.slice(0, tailCount)
  const valueAtRisk95 = Math.max(0, -tail.at(-1)!)
  const conditionalValueAtRisk95 = Math.max(0, -mean(tail))
  const warnings: QuantWarning[] = []

  if (returnCount < 30) warnings.push({ code: 'SHORT_SAMPLE', message: '有效收益样本少于 30，年化指标稳定性有限' })
  if (returnStdDev <= 1e-12) warnings.push({ code: 'ZERO_VOLATILITY', message: '收益序列波动为零，Sharpe 不可计算' })
  if (downsideDeviation <= 1e-12) {
    warnings.push({ code: 'ZERO_DOWNSIDE_DEVIATION', message: '序列无负超额收益，Sortino 不可计算' })
  }
  if (Math.abs(maxDrawdown) <= 1e-12) warnings.push({ code: 'ZERO_DRAWDOWN', message: '序列无回撤，Calmar 不可计算' })
  if (totalReturn <= -1) warnings.push({ code: 'TOTAL_LOSS', message: '序列包含完全损失，CAGR 固定为 -1' })

  const values: Record<PerformanceMetricKey, number | null> = {
    TOTAL_RETURN: totalReturn,
    CAGR: cagr,
    ANNUAL_VOLATILITY: annualVolatility,
    SHARPE: sharpe,
    SORTINO: sortino,
    MAX_DRAWDOWN: maxDrawdown,
    CALMAR: calmar,
    WIN_RATE: winRate,
    VAR_95: valueAtRisk95,
    CVAR_95: conditionalValueAtRisk95,
  }

  return {
    algorithmVersion,
    seriesType: input.seriesType,
    annualizationFactor: input.annualizationFactor,
    riskFreeRateAnnual: input.riskFreeRateAnnual,
    sample: {
      startDate: points[0].date,
      endDate: points.at(-1)!.date,
      pointCount: points.length,
      returnCount,
    },
    metrics: requestedMetrics.map((key) => ({
      key,
      value: finiteOrNull(values[key]),
      unit: ['SHARPE', 'SORTINO', 'CALMAR'].includes(key) ? 'RATIO' : 'DECIMAL',
      sampleCount: returnCount,
    })),
    warnings,
  }
}

function calculateMaxDrawdown(
  seriesType: PerformanceSeriesType,
  points: PerformancePoint[],
  returns: number[],
): number {
  const equity = points.map((point) => point.value)
  if (seriesType === 'RETURN') {
    equity.length = 0
    equity.push(1)
    for (const value of returns) equity.push(equity.at(-1)! * (1 + value))
  }
  let peak = equity[0]
  let maxDrawdown = 0
  for (const value of equity) {
    peak = Math.max(peak, value)
    maxDrawdown = Math.min(maxDrawdown, peak > 0 ? value / peak - 1 : -1)
  }
  return maxDrawdown
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}
