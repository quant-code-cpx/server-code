import type { ToolError } from './tool-error'

export const TOOL_EXECUTION_OBSERVER = Symbol('TOOL_EXECUTION_OBSERVER')

export interface ToolExecutionObserver {
  onStarted?(event: { runId: string; toolCallId: string; toolKey: string; version: number; attempt: number }): void
  onRetry?(event: { runId: string; toolCallId: string; attempt: number; error: ToolError }): void
  onCompleted?(event: {
    runId: string
    toolCallId: string
    attempt: number
    durationMs: number
    rowCount: number
    resultBytes: number
    truncated: boolean
    dataAsOf: string | null
  }): void
  onFailed?(event: { runId: string; toolCallId: string; attempt: number; durationMs: number; error: ToolError }): void
}
