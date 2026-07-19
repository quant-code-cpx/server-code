export type ToolErrorCode =
  | 'TOOL_NOT_REGISTERED'
  | 'INVALID_ARGUMENT'
  | 'PERMISSION_DENIED'
  | 'DATA_NOT_FOUND'
  | 'CONFIRMATION_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UPSTREAM_FAILED'
  | 'DATA_NOT_READY'
  | 'DATA_STALE'
  | 'DATA_QUALITY_FAILED'
  | 'OUTPUT_SCHEMA_INVALID'
  | 'RESULT_TOO_LARGE'
  | 'INTERNAL_ERROR'

export type ToolErrorDetailValue = string | number | boolean | null

export interface ToolError {
  ok: false
  toolCallId: string
  toolKey: string
  toolVersion: number
  code: ToolErrorCode
  message: string
  retryable: boolean
  retryAfterMs?: number
  details?: Record<string, ToolErrorDetailValue>
}

export const TOOL_ERROR_AGENT_CODE: Readonly<Record<ToolErrorCode, number>> = {
  TOOL_NOT_REGISTERED: 6008,
  INVALID_ARGUMENT: 6010,
  PERMISSION_DENIED: 6009,
  DATA_NOT_FOUND: 6013,
  CONFIRMATION_REQUIRED: 6030,
  QUOTA_EXCEEDED: 6019,
  RATE_LIMITED: 6026,
  TIMEOUT: 6011,
  CANCELLED: 6031,
  UPSTREAM_FAILED: 6027,
  DATA_NOT_READY: 6014,
  DATA_STALE: 6014,
  DATA_QUALITY_FAILED: 6028,
  OUTPUT_SCHEMA_INVALID: 6029,
  RESULT_TOO_LARGE: 6012,
  INTERNAL_ERROR: 6099,
}

export class ToolAdapterError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
    readonly details?: Record<string, ToolErrorDetailValue>,
  ) {
    super(message)
    this.name = ToolAdapterError.name
  }
}

export class ToolExecutionError extends Error {
  constructor(readonly result: ToolError) {
    super(result.message)
    this.name = ToolExecutionError.name
  }
}
