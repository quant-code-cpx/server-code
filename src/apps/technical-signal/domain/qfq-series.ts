import { TechnicalSignalDomainError } from './technical-signal.errors'
import type { RawTechnicalSignalBar, TechnicalSignalBar } from './technical-signal.types'

/**
 * Builds QFQ bars using a common as-of anchor. Price ratios remain stable over
 * corporate actions while volume deliberately remains raw.
 */
export function createQfqBars(
  rawBars: readonly RawTechnicalSignalBar[],
  dataAsOfAdjFactor?: number,
): TechnicalSignalBar[] {
  validateRawBars(rawBars)

  if (rawBars.length === 0) return []

  const anchor = dataAsOfAdjFactor ?? rawBars[rawBars.length - 1].adjFactor
  if (!isPositiveFinite(anchor)) {
    throw new TechnicalSignalDomainError(
      'INVALID_ADJUSTMENT_FACTOR',
      'dataAsOf adjustment factor must be finite and greater than zero',
    )
  }

  return rawBars.map((bar) => {
    const multiplier = bar.adjFactor / anchor
    return {
      tradeDate: bar.tradeDate,
      open: bar.open * multiplier,
      high: bar.high * multiplier,
      low: bar.low * multiplier,
      close: bar.close * multiplier,
      vol: bar.vol,
    }
  })
}

/** Alias kept explicit for consumers that model QFQ construction as a series. */
export const buildQfqSeries = createQfqBars

export function assertValidTechnicalSignalBars(bars: readonly TechnicalSignalBar[]): void {
  let previousDate: string | undefined

  for (const bar of bars) {
    validateQfqBar(bar)
    if (previousDate !== undefined && bar.tradeDate <= previousDate) {
      throw new TechnicalSignalDomainError(
        'INVALID_TIMELINE_ORDER',
        'bars must be strictly ordered by ascending unique tradeDate',
      )
    }
    previousDate = bar.tradeDate
  }
}

function validateRawBars(rawBars: readonly RawTechnicalSignalBar[]): void {
  let previousDate: string | undefined

  for (const bar of rawBars) {
    validateQfqBar(bar)
    if (!isPositiveFinite(bar.adjFactor)) {
      throw new TechnicalSignalDomainError('INVALID_ADJUSTMENT_FACTOR', `invalid adjustment factor at ${bar.tradeDate}`)
    }
    if (previousDate !== undefined && bar.tradeDate <= previousDate) {
      throw new TechnicalSignalDomainError(
        'INVALID_TIMELINE_ORDER',
        'raw bars must be strictly ordered by ascending unique tradeDate',
      )
    }
    previousDate = bar.tradeDate
  }
}

function validateQfqBar(bar: TechnicalSignalBar): void {
  if (
    !isTradeDate(bar.tradeDate) ||
    !isPositiveFinite(bar.open) ||
    !isPositiveFinite(bar.high) ||
    !isPositiveFinite(bar.low) ||
    !isPositiveFinite(bar.close) ||
    !Number.isFinite(bar.vol) ||
    bar.vol < 0 ||
    bar.high < Math.max(bar.open, bar.close, bar.low) ||
    bar.low > Math.min(bar.open, bar.close, bar.high)
  ) {
    throw new TechnicalSignalDomainError('INVALID_QFQ_BAR', `invalid QFQ bar at ${bar.tradeDate}`)
  }
}

function isTradeDate(value: string): boolean {
  return /^\d{8}$/.test(value)
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
