export class AgentConversationNotFoundError extends Error {
  readonly code = 'AI_CONVERSATION_NOT_FOUND'

  constructor() {
    super('会话不存在或无权访问')
    this.name = AgentConversationNotFoundError.name
  }
}

export class AgentConversationArchivedError extends Error {
  readonly code = 'AI_CONVERSATION_ARCHIVED'

  constructor() {
    super('归档会话不可继续写入消息')
    this.name = AgentConversationArchivedError.name
  }
}

export class AgentConversationValidationError extends Error {
  readonly code = 'AI_CONVERSATION_VALIDATION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = AgentConversationValidationError.name
  }
}

export class AgentIdempotencyConflictError extends Error {
  readonly code = 'AI_DUPLICATE_REQUEST_CONFLICT'

  constructor() {
    super('相同 clientRequestId 对应不同请求内容')
    this.name = AgentIdempotencyConflictError.name
  }
}

export class AgentCursorInvalidError extends Error {
  readonly code = 'AI_CURSOR_INVALID'

  constructor() {
    super('分页游标格式无效')
    this.name = AgentCursorInvalidError.name
  }
}

export class AgentMessageValidationError extends Error {
  readonly code = 'AI_MESSAGE_VALIDATION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = AgentMessageValidationError.name
  }
}

export class AgentStoredMessageInvalidError extends Error {
  readonly code = 'AI_STORED_MESSAGE_INVALID'

  constructor(readonly messageId: string) {
    super(`消息 ${messageId} 的持久化内容不符合当前协议`)
    this.name = AgentStoredMessageInvalidError.name
  }
}
