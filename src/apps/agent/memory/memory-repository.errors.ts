export class AgentSummaryValidationError extends Error {
  readonly code = 'AI_SUMMARY_VALIDATION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = AgentSummaryValidationError.name
  }
}

export class AgentSummaryVersionConflictError extends Error {
  readonly code = 'AI_SUMMARY_VERSION_CONFLICT'

  constructor() {
    super('会话摘要版本已推进，请读取最新版本后重试')
    this.name = AgentSummaryVersionConflictError.name
  }
}

export class AgentMemoryNotFoundError extends Error {
  readonly code = 'AI_MEMORY_NOT_FOUND'

  constructor() {
    super('记忆不存在或无权访问')
    this.name = AgentMemoryNotFoundError.name
  }
}

export class AgentMemoryValidationError extends Error {
  readonly code = 'AI_MEMORY_VALIDATION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = AgentMemoryValidationError.name
  }
}

export class AgentMemoryConflictError extends Error {
  readonly code = 'AI_MEMORY_CONFLICT'

  constructor(message = '记忆状态或 active 版本已变化，请读取最新版本后重试') {
    super(message)
    this.name = AgentMemoryConflictError.name
  }
}

export class AgentConfirmationRequiredError extends Error {
  readonly code = 'AI_CONFIRMATION_REQUIRED'

  constructor() {
    super('长期记忆写入需要用户明确确认')
    this.name = AgentConfirmationRequiredError.name
  }
}
