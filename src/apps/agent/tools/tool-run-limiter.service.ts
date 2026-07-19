import { Inject, Injectable } from '@nestjs/common'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { ToolErrorCode } from './contracts/tool-error'

interface RunLimitState {
  used: number
  inFlight: number
}

export class ToolRunLimitError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
    this.name = ToolRunLimitError.name
  }
}

export interface ToolRunReservation {
  release(): void
}

@Injectable()
export class ToolRunLimiterService {
  private readonly states = new Map<string, RunLimitState>()

  constructor(@Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig) {}

  reserve(runId: string, reportedCallsUsed: number, requestedConcurrency?: number): ToolRunReservation {
    const normalizedRunId = normalizeRunId(runId)
    if (!Number.isSafeInteger(reportedCallsUsed) || reportedCallsUsed < 0) {
      throw new ToolRunLimitError('INTERNAL_ERROR', 'Tool 调用预算状态无效')
    }
    const state = this.states.get(normalizedRunId) ?? { used: reportedCallsUsed, inFlight: 0 }
    state.used = Math.max(state.used, reportedCallsUsed)
    if (state.used >= this.config.maxCallsPerRun) {
      throw new ToolRunLimitError('QUOTA_EXCEEDED', 'Agent Run Tool 调用次数已达上限')
    }
    const concurrency = Math.min(
      requestedConcurrency ?? this.config.maxConcurrentPerRun,
      this.config.maxConcurrentPerRun,
    )
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new ToolRunLimitError('INTERNAL_ERROR', 'Tool 并发上限无效')
    }
    if (state.inFlight >= concurrency) {
      throw new ToolRunLimitError('QUOTA_EXCEEDED', 'Agent Run Tool 并发已达上限')
    }

    state.used += 1
    state.inFlight += 1
    this.states.set(normalizedRunId, state)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        state.inFlight = Math.max(0, state.inFlight - 1)
      },
    }
  }

  clearRun(runId: string): void {
    const normalizedRunId = normalizeRunId(runId)
    if ((this.states.get(normalizedRunId)?.inFlight ?? 0) > 0) {
      throw new ToolRunLimitError('INTERNAL_ERROR', 'Tool 仍在执行，不能清理 Run limiter')
    }
    this.states.delete(normalizedRunId)
  }

  snapshot(runId: string): Readonly<RunLimitState> {
    const state = this.states.get(normalizeRunId(runId)) ?? { used: 0, inFlight: 0 }
    return Object.freeze({ ...state })
  }
}

function normalizeRunId(runId: string): string {
  if (typeof runId !== 'string') throw new ToolRunLimitError('INTERNAL_ERROR', 'Agent Run ID 无效')
  const normalized = runId.trim()
  if (!normalized || normalized.length > 32) {
    throw new ToolRunLimitError('INTERNAL_ERROR', 'Agent Run ID 无效')
  }
  return normalized
}
