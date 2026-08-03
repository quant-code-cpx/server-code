import { TECHNICAL_SIGNAL_DEFINITIONS } from './technical-signal-definition.registry'
import { TechnicalSignalDomainError } from './technical-signal.errors'
import type {
  DetectTechnicalSignalOccurrencesOptions,
  IndicatorPoint,
  TechnicalSignalOccurrence,
} from './technical-signal.types'

/**
 * Detects transition events from consecutive full-history points. Date filtering
 * happens after the previous point is available, so a window's first date is
 * never accidentally skipped.
 */
export function detectTechnicalSignalOccurrences(
  points: readonly IndicatorPoint[],
  options: DetectTechnicalSignalOccurrencesOptions = {},
): TechnicalSignalOccurrence[] {
  if (points.length < 2) return []

  assertOrderedPoints(points)
  const windowStartDate = options.windowStartDate ?? points[0].tradeDate
  const windowEndDate = options.windowEndDate ?? points[points.length - 1].tradeDate
  if (windowStartDate > windowEndDate) {
    throw new TechnicalSignalDomainError('INVALID_DETECTION_WINDOW', 'windowStartDate must not be after windowEndDate')
  }

  const definitions = options.definitions ?? TECHNICAL_SIGNAL_DEFINITIONS
  const occurrences: TechnicalSignalOccurrence[] = []

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (current.tradeDate < windowStartDate || current.tradeDate > windowEndDate) continue

    for (const definition of definitions) {
      const evidence = definition.evaluate(previous, current)
      if (evidence === null) continue
      occurrences.push({
        signalKey: definition.signalKey,
        semanticsVersion: definition.semanticsVersion,
        definitionHash: definition.definitionHash,
        source: definition.source,
        indicatorAlgorithmVersion: definition.indicatorAlgorithmVersion,
        signalDate: current.tradeDate,
        direction: definition.direction,
        evidence,
      })
    }
  }

  return occurrences
}

function assertOrderedPoints(points: readonly IndicatorPoint[]): void {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].tradeDate <= points[index - 1].tradeDate) {
      throw new TechnicalSignalDomainError(
        'INVALID_TIMELINE_ORDER',
        'indicator points must be strictly ordered by ascending unique tradeDate',
      )
    }
  }
}
