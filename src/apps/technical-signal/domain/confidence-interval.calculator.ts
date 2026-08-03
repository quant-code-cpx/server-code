import { TechnicalSignalDomainError } from './technical-signal.errors'

const CONFIDENCE_LEVEL = 0.95
const NORMAL_975 = 1.959963984540054

export interface MeanConfidenceInterval {
  lower: number
  upper: number
}

export interface WilsonConfidenceInterval {
  lower: number
  upper: number
}

/** Student-t 95% mean interval. Inputs are fractions, never display percentages. */
export function calculateStudentTMeanConfidenceInterval(values: readonly number[]): MeanConfidenceInterval | null {
  assertFiniteValues(values)
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  const standardDeviation = Math.sqrt(variance)
  const critical = inverseStudentT(0.975, values.length - 1)
  const margin = (critical * standardDeviation) / Math.sqrt(values.length)
  return { lower: mean - margin, upper: mean + margin }
}

/** Wilson score 95% interval for a binomial success rate. */
export function calculateWilsonSuccessConfidenceInterval(
  successCount: number,
  sampleCount: number,
): WilsonConfidenceInterval | null {
  if (
    !Number.isInteger(successCount) ||
    !Number.isInteger(sampleCount) ||
    successCount < 0 ||
    sampleCount < 0 ||
    successCount > sampleCount
  ) {
    throw new TechnicalSignalDomainError('INVALID_STATISTIC_INPUT', 'invalid Wilson success/sample counts')
  }
  if (sampleCount === 0) return null
  const zSquared = NORMAL_975 ** 2
  const probability = successCount / sampleCount
  const denominator = 1 + zSquared / sampleCount
  const center = (probability + zSquared / (2 * sampleCount)) / denominator
  const half =
    (NORMAL_975 * Math.sqrt((probability * (1 - probability)) / sampleCount + zSquared / (4 * sampleCount ** 2))) /
    denominator
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) }
}

export const TECHNICAL_SIGNAL_CONFIDENCE_LEVEL = CONFIDENCE_LEVEL

function inverseStudentT(probability: number, degreesOfFreedom: number): number {
  if (!(probability > 0.5 && probability < 1) || !Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new TechnicalSignalDomainError('INVALID_STATISTIC_INPUT', 'invalid Student-t quantile arguments')
  }

  let low = 0
  let high = 100
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const midpoint = (low + high) / 2
    const cdf = studentTCdf(midpoint, degreesOfFreedom)
    if (Math.abs(cdf - probability) <= 1e-12) return midpoint
    if (cdf < probability) low = midpoint
    else high = midpoint
  }
  const result = (low + high) / 2
  if (Math.abs(studentTCdf(result, degreesOfFreedom) - probability) > 1e-10) {
    throw new TechnicalSignalDomainError('CONFIDENCE_INTERVAL_NOT_CONVERGED', 'Student-t quantile did not converge')
  }
  return result
}

function studentTCdf(value: number, degreesOfFreedom: number): number {
  if (value === 0) return 0.5
  const x = degreesOfFreedom / (degreesOfFreedom + value * value)
  const beta = regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5)
  return value > 0 ? 1 - beta / 2 : beta / 2
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const logBeta = logGamma(a + b) - logGamma(a) - logGamma(b)
  const front = Math.exp(logBeta + a * Math.log(x) + b * Math.log1p(-x))
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b
}

/** Lentz continued fraction for incomplete beta. */
function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c

    aa = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) <= 3e-14) return h
  }
  throw new TechnicalSignalDomainError('CONFIDENCE_INTERVAL_NOT_CONVERGED', 'incomplete beta fraction did not converge')
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  const adjusted = value - 1
  let series = 0.9999999999998099
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index] / (adjusted + index + 1)
  }
  const t = adjusted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(t) - t + Math.log(series)
}

function assertFiniteValues(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TechnicalSignalDomainError('INVALID_STATISTIC_INPUT', 'confidence interval values must be finite')
  }
}
