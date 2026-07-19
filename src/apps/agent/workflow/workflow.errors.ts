export type WorkflowErrorCategory =
  | 'VALIDATION'
  | 'VERSION'
  | 'BUDGET'
  | 'CITATION'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'LEASE'
  | 'MODEL'
  | 'TOOL'
  | 'INTERNAL'

export class WorkflowExecutionError extends Error {
  constructor(
    readonly category: WorkflowErrorCategory,
    readonly agentCode: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = WorkflowExecutionError.name
  }
}

export class WorkflowVersionError extends WorkflowExecutionError {
  constructor(message: string, agentCode = 6024) {
    super('VERSION', agentCode, false, message)
    this.name = WorkflowVersionError.name
  }
}

export class WorkflowValidationError extends WorkflowExecutionError {
  constructor(message: string) {
    super('VALIDATION', 6021, false, message)
    this.name = WorkflowValidationError.name
  }
}

export class WorkflowBudgetError extends WorkflowExecutionError {
  constructor(message: string, agentCode = 6019) {
    super('BUDGET', agentCode, false, message)
    this.name = WorkflowBudgetError.name
  }
}

export class WorkflowCitationError extends WorkflowExecutionError {
  constructor(message: string) {
    super('CITATION', 6017, false, message)
    this.name = WorkflowCitationError.name
  }
}

export class WorkflowCancelledError extends WorkflowExecutionError {
  constructor(message = 'Agent Run 已请求取消') {
    super('CANCELLED', 6031, false, message)
    this.name = WorkflowCancelledError.name
  }
}

export class WorkflowTimeoutError extends WorkflowExecutionError {
  constructor(message = 'Agent Run deadline 已到期') {
    super('TIMEOUT', 6020, true, message)
    this.name = WorkflowTimeoutError.name
  }
}

export class WorkflowLeaseError extends WorkflowExecutionError {
  constructor(message = 'Agent Run lease 已失效') {
    super('LEASE', 6099, true, message)
    this.name = WorkflowLeaseError.name
  }
}
