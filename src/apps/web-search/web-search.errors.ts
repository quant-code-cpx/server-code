export type WebSearchErrorCode =
  | 'INVALID_ARGUMENT'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_FAILED'
  | 'DATA_NOT_FOUND'
  | 'RESULT_TOO_LARGE'

export class WebSearchError extends Error {
  constructor(
    readonly code: WebSearchErrorCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = WebSearchError.name
  }
}
