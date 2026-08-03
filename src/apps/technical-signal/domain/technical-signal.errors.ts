export type TechnicalSignalDomainErrorCode =
  | 'INVALID_QFQ_BAR'
  | 'INVALID_ADJUSTMENT_FACTOR'
  | 'INVALID_TIMELINE_ORDER'
  | 'INVALID_RETURN_INPUT'
  | 'INVALID_STATISTIC_INPUT'
  | 'INVALID_DETECTION_WINDOW'
  | 'CONFIDENCE_INTERVAL_NOT_CONVERGED'

/** Domain-only error. Application layer maps it to its HTTP error contract. */
export class TechnicalSignalDomainError extends Error {
  constructor(
    readonly code: TechnicalSignalDomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TechnicalSignalDomainError'
  }
}
