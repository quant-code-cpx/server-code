import { QuantCalculationError, type QuantWarning } from './performance-metrics'

export const VALUATION_PERCENTILE_ALGORITHM_VERSION = 'valuation-percentile-v1'

export type ValuationPercentileMethod = 'WEAK' | 'MEAN'
export type ValuationWinsorizePolicy = 'NONE' | 'P1_P99'

export interface ValuationPoint {
  date: string
  value: number | null
}

export interface ValuationPercentilePolicy {
  percentileMethod: ValuationPercentileMethod
  excludeNonPositive: boolean
  winsorize: ValuationWinsorizePolicy
  minimumSamples: number
}

export interface ValuationPercentileResult {
  algorithmVersion: string
  currentValue: number
  percentileValue: number
  percentile: number
  percentileMethod: ValuationPercentileMethod
  sampleCount: number
  dataDate: string
  window: { startDate: string; endDate: string }
  statistics: { min: number; max: number; median: number }
  filtered: { missingOrNonFinite: number; nonPositive: number; winsorized: number }
  warnings: QuantWarning[]
}

export function computeValuationPercentile(
  series: ValuationPoint[],
  policy: ValuationPercentilePolicy,
  algorithmVersion = VALUATION_PERCENTILE_ALGORITHM_VERSION,
): ValuationPercentileResult {
  if (!Number.isInteger(policy.minimumSamples) || policy.minimumSamples < 1) {
    throw new QuantCalculationError('minimumSamples 必须是正整数')
  }

  const sorted = series.map((point) => ({ ...point })).sort((left, right) => left.date.localeCompare(right.date))
  const dates = new Set<string>()
  let missingOrNonFinite = 0
  let nonPositive = 0
  const valid: Array<{ date: string; value: number }> = []

  for (const point of sorted) {
    if (dates.has(point.date)) throw new QuantCalculationError(`估值序列存在重复日期：${point.date}`)
    dates.add(point.date)
    if (point.value == null || !Number.isFinite(point.value)) {
      missingOrNonFinite++
      continue
    }
    if (policy.excludeNonPositive && point.value <= 0) {
      nonPositive++
      continue
    }
    valid.push({ date: point.date, value: point.value })
  }

  if (valid.length < policy.minimumSamples) {
    throw new QuantCalculationError(`有效估值样本不足：${valid.length}/${policy.minimumSamples}`)
  }

  const rawValues = valid.map((point) => point.value)
  let lower = Number.NEGATIVE_INFINITY
  let upper = Number.POSITIVE_INFINITY
  if (policy.winsorize === 'P1_P99') {
    const ordered = [...rawValues].sort((left, right) => left - right)
    lower = quantileType7(ordered, 0.01)
    upper = quantileType7(ordered, 0.99)
  }
  let winsorized = 0
  const adjusted = valid.map((point) => {
    const value = Math.min(Math.max(point.value, lower), upper)
    if (value !== point.value) winsorized++
    return { ...point, value }
  })
  const currentRaw = valid.at(-1)!
  const currentAdjusted = adjusted.at(-1)!
  const values = adjusted.map((point) => point.value).sort((left, right) => left - right)
  const less = values.filter((value) => value < currentAdjusted.value).length
  const equal = values.filter((value) => value === currentAdjusted.value).length
  const percentile =
    policy.percentileMethod === 'WEAK' ? (less + equal) / values.length : (less + equal * 0.5) / values.length
  const warnings: QuantWarning[] = []
  if (winsorized > 0) warnings.push({ code: 'VALUES_WINSORIZED', message: `${winsorized} 个样本被 P1/P99 缩尾` })
  if (missingOrNonFinite > 0 || nonPositive > 0) {
    warnings.push({ code: 'VALUES_FILTERED', message: '缺失、非有限或非正估值样本已按固定策略排除' })
  }

  return {
    algorithmVersion,
    currentValue: currentRaw.value,
    percentileValue: currentAdjusted.value,
    percentile,
    percentileMethod: policy.percentileMethod,
    sampleCount: values.length,
    dataDate: currentRaw.date,
    window: { startDate: adjusted[0].date, endDate: adjusted.at(-1)!.date },
    statistics: {
      min: values[0],
      max: values.at(-1)!,
      median: quantileType7(values, 0.5),
    },
    filtered: { missingOrNonFinite, nonPositive, winsorized },
    warnings,
  }
}

function quantileType7(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex]
  const weight = position - lowerIndex
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
}
