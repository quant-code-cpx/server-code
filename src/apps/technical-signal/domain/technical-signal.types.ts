export const TECHNICAL_INDICATOR_ALGORITHM_VERSION = 'technical-indicator.v2' as const

export type TechnicalSignalDirection = 'BULLISH' | 'BEARISH' | 'CONTEXTUAL'
export type TechnicalSignalSource = 'LOCAL_QFQ_OHLCV'
export type TechnicalSignalEvidenceValue = number | boolean | string | null
export type TechnicalSignalEntryMode = 'SIGNAL_CLOSE' | 'NEXT_OPEN'

/** Raw daily quote plus its adjustment factor, before QFQ normalization. */
export interface RawTechnicalSignalBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  vol: number
  adjFactor: number
}

/** Forward-adjusted OHLCV bar consumed by the indicator engine. */
export interface TechnicalSignalBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  /** Volume stays unadjusted. */
  vol: number
}

/**
 * One full-precision indicator snapshot. Null means insufficient history or an
 * otherwise non-evaluable indicator; it is never converted to zero.
 */
export interface IndicatorPoint extends TechnicalSignalBar {
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  macdDif: number | null
  macdDea: number | null
  kdjK: number | null
  kdjD: number | null
  kdjJ: number | null
  rsi6: number | null
  bollUpper: number | null
  bollMid: number | null
  bollLower: number | null
  sar: number | null
  sarBullish: boolean | null
  /** Mean volume over preceding 20 valid bars; current bar excluded. */
  volumeAverage20: number | null
  volumeRatio20: number | null
}

export interface TechnicalSignalEvidence {
  previous: Readonly<Record<string, TechnicalSignalEvidenceValue>>
  current: Readonly<Record<string, TechnicalSignalEvidenceValue>>
  parameters: Readonly<Record<string, number | string | boolean>>
}

export interface TechnicalSignalDefinition {
  readonly signalKey: string
  readonly semanticsVersion: string
  readonly definitionHash: string
  readonly displayName: string
  readonly direction: TechnicalSignalDirection
  readonly source: TechnicalSignalSource
  readonly indicatorAlgorithmVersion: typeof TECHNICAL_INDICATOR_ALGORITHM_VERSION
  readonly requiredFields: readonly (keyof IndicatorPoint)[]
  readonly description: string
  readonly parameters: Readonly<Record<string, number | string | boolean>>
  readonly triggerExpression: string
  evaluate(previous: IndicatorPoint, current: IndicatorPoint): TechnicalSignalEvidence | null
}

export interface TechnicalSignalOccurrence {
  readonly signalKey: string
  readonly semanticsVersion: string
  readonly definitionHash: string
  readonly source: TechnicalSignalSource
  readonly indicatorAlgorithmVersion: typeof TECHNICAL_INDICATOR_ALGORITHM_VERSION
  readonly signalDate: string
  readonly direction: TechnicalSignalDirection
  readonly evidence: TechnicalSignalEvidence
}

export interface DetectTechnicalSignalOccurrencesOptions {
  /** Defaults to all stable v1 definitions. */
  readonly definitions?: readonly TechnicalSignalDefinition[]
  /** Inclusive YYYYMMDD boundary. Defaults to the first point. */
  readonly windowStartDate?: string
  /** Inclusive YYYYMMDD boundary. Defaults to the last point. */
  readonly windowEndDate?: string
}

export interface TechnicalSignalQuote {
  open: number
  close: number
}

export interface AdjustedReturnResult {
  entryRawPrice: number
  entryAdjFactor: number
  targetRawPrice: number
  targetAdjFactor: number
  rawReturn: number
}

export interface BasicReturnStatistics {
  sampleCount: number
  upCount: number
  downCount: number
  flatCount: number
  upRatio: number | null
  downRatio: number | null
  flatRatio: number | null
  average: number | null
  median: number | null
  minimum: number | null
  maximum: number | null
  stdDev: number | null
  p25: number | null
  p75: number | null
}

export interface DirectionalReturnStatistics {
  sampleCount: number
  successCount: number
  failureCount: number
  flatCount: number
  successRatio: number | null
  average: number | null
  median: number | null
  minimum: number | null
  maximum: number | null
  stdDev: number | null
  p25: number | null
  p75: number | null
}
