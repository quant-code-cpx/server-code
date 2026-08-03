import { TechnicalSignalDomainError } from './technical-signal.errors'
import type {
  AdjustedReturnResult,
  TechnicalSignalDirection,
  TechnicalSignalEntryMode,
  TechnicalSignalQuote,
} from './technical-signal.types'

/** Return classification tolerance mandated by signal-statistics.v1. */
export const TECHNICAL_SIGNAL_RETURN_EPSILON = 1e-8

/**
 * Calculates a raw stock return using raw quote × adjustment-factor ratios.
 * Callers select actual entry/target trading dates before invoking this pure fn.
 */
export function calculateAdjustedReturn(
  entryQuote: TechnicalSignalQuote,
  entryAdjFactor: number,
  targetQuote: Pick<TechnicalSignalQuote, 'close'>,
  targetAdjFactor: number,
  entryMode: TechnicalSignalEntryMode,
): AdjustedReturnResult {
  const entryRawPrice = entryMode === 'SIGNAL_CLOSE' ? entryQuote.close : entryQuote.open
  const targetRawPrice = targetQuote.close
  assertPositiveFinite(entryRawPrice, 'entry raw price')
  assertPositiveFinite(targetRawPrice, 'target raw price')
  assertPositiveFinite(entryAdjFactor, 'entry adjustment factor')
  assertPositiveFinite(targetAdjFactor, 'target adjustment factor')

  return {
    entryRawPrice,
    entryAdjFactor,
    targetRawPrice,
    targetAdjFactor,
    rawReturn: (targetRawPrice * targetAdjFactor) / (entryRawPrice * entryAdjFactor) - 1,
  }
}

export function calculateDirectionalReturn(rawReturn: number, direction: TechnicalSignalDirection): number | null {
  if (!Number.isFinite(rawReturn)) {
    throw new TechnicalSignalDomainError('INVALID_RETURN_INPUT', 'raw return must be finite')
  }
  if (direction === 'CONTEXTUAL') return null
  return direction === 'BULLISH' ? rawReturn : -rawReturn
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TechnicalSignalDomainError('INVALID_RETURN_INPUT', `${name} must be finite and greater than zero`)
  }
}
