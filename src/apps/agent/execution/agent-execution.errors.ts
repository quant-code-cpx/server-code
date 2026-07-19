export class AgentRunNotFoundError extends Error {
  readonly code = 'AI_RUN_NOT_FOUND'

  constructor() {
    super('Agent Run 不存在或无权访问')
    this.name = AgentRunNotFoundError.name
  }
}

export class AgentRunConflictError extends Error {
  readonly code: string = 'AI_RUN_NOT_CANCELLABLE'

  constructor(message: string) {
    super(message)
    this.name = AgentRunConflictError.name
  }
}

export type AgentRunClaimErrorReason =
  | 'TERMINAL'
  | 'DEADLINE_EXPIRED'
  | 'LEASE_HELD'
  | 'STALE_WORKER_ID'
  | 'ATTEMPTS_EXHAUSTED'
  | 'NOT_CLAIMABLE'
  | 'CLAIM_CONFLICT'

export class AgentRunClaimError extends AgentRunConflictError {
  readonly code = 'AI_RUN_CLAIM_CONFLICT'

  constructor(
    readonly reason: AgentRunClaimErrorReason,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = AgentRunClaimError.name
  }
}

export class AgentRunIdempotencyConflictError extends Error {
  readonly code = 'AI_DUPLICATE_REQUEST_CONFLICT'

  constructor() {
    super('相同 clientRequestId 对应不同 Agent Run 请求')
    this.name = AgentRunIdempotencyConflictError.name
  }
}

export class AgentExecutionValidationError extends Error {
  readonly code = 'AI_INTERNAL_ERROR'

  constructor(message: string) {
    super(message)
    this.name = AgentExecutionValidationError.name
  }
}
