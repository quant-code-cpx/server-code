export type NewsProviderErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_SCHEMA_CHANGED'
  | 'INTERNAL_ERROR'

export class NewsProviderError extends Error {
  constructor(
    readonly code: NewsProviderErrorCode,
    readonly retryable: boolean,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = NewsProviderError.name
  }
}
