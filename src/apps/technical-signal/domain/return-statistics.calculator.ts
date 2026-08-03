import { calculateDirectionalReturn, TECHNICAL_SIGNAL_RETURN_EPSILON } from './adjusted-return.calculator'
import { TechnicalSignalDomainError } from './technical-signal.errors'
import type {
  BasicReturnStatistics,
  DirectionalReturnStatistics,
  TechnicalSignalDirection,
} from './technical-signal.types'

/**
 * Calculates raw-return distribution in fraction units, not API percentage
 * units. Nulls remain caller-owned missing samples and must be filtered first.
 */
export function calculateBasicReturnStatistics(
  returns: readonly number[],
  epsilon = TECHNICAL_SIGNAL_RETURN_EPSILON,
): BasicReturnStatistics {
  assertReturns(returns, epsilon)
  const sampleCount = returns.length
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      upCount: 0,
      downCount: 0,
      flatCount: 0,
      upRatio: null,
      downRatio: null,
      flatRatio: null,
      average: null,
      median: null,
      minimum: null,
      maximum: null,
      stdDev: null,
      p25: null,
      p75: null,
    }
  }

  let upCount = 0
  let downCount = 0
  let flatCount = 0
  let sum = 0
  for (const value of returns) {
    sum += value
    if (value > epsilon) upCount += 1
    else if (value < -epsilon) downCount += 1
    else flatCount += 1
  }

  const sorted = [...returns].sort((left, right) => left - right)
  const average = sum / sampleCount
  const variance =
    sampleCount > 1 ? returns.reduce((total, value) => total + (value - average) ** 2, 0) / (sampleCount - 1) : null

  return {
    sampleCount,
    upCount,
    downCount,
    flatCount,
    upRatio: upCount / sampleCount,
    downRatio: downCount / sampleCount,
    flatRatio: flatCount / sampleCount,
    average,
    median: quantile(sorted, 0.5),
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    stdDev: variance === null ? null : Math.sqrt(variance),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  }
}

export function calculateDirectionalReturnStatistics(
  rawReturns: readonly number[],
  direction: TechnicalSignalDirection,
  epsilon = TECHNICAL_SIGNAL_RETURN_EPSILON,
): DirectionalReturnStatistics {
  assertReturns(rawReturns, epsilon)
  if (direction === 'CONTEXTUAL') {
    return {
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      flatCount: 0,
      successRatio: null,
      average: null,
      median: null,
      minimum: null,
      maximum: null,
      stdDev: null,
      p25: null,
      p75: null,
    }
  }

  const directionalReturns = rawReturns.map((value) => calculateDirectionalReturn(value, direction) as number)
  const distribution = calculateBasicReturnStatistics(directionalReturns, epsilon)
  return {
    sampleCount: distribution.sampleCount,
    successCount: distribution.upCount,
    failureCount: distribution.downCount,
    flatCount: distribution.flatCount,
    successRatio: distribution.upRatio,
    average: distribution.average,
    median: distribution.median,
    minimum: distribution.minimum,
    maximum: distribution.maximum,
    stdDev: distribution.stdDev,
    p25: distribution.p25,
    p75: distribution.p75,
  }
}

/** Backwards-readable alias for services that only need a raw distribution. */
export const calculateReturnStatistics = calculateBasicReturnStatistics

function quantile(sortedValues: readonly number[], percentile: number): number | null {
  if (sortedValues.length === 0) return null
  const rank = (sortedValues.length - 1) * percentile
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)
  return sortedValues[lowerIndex] + (rank - lowerIndex) * (sortedValues[upperIndex] - sortedValues[lowerIndex])
}

function assertReturns(returns: readonly number[], epsilon: number): void {
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new TechnicalSignalDomainError('INVALID_STATISTIC_INPUT', 'epsilon must be finite and non-negative')
  }
  if (returns.some((value) => !Number.isFinite(value))) {
    throw new TechnicalSignalDomainError('INVALID_STATISTIC_INPUT', 'returns must all be finite')
  }
}
