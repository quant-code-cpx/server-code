export class AgentStreamCursorInvalidError extends Error {
  readonly code = 'AI_CURSOR_INVALID'

  constructor() {
    super('SSE Last-Event-ID 无效或不属于当前 Agent Run')
    this.name = AgentStreamCursorInvalidError.name
  }
}

export class AgentStreamGapError extends Error {
  constructor(
    readonly expectedSequence: number,
    readonly actualSequence: number,
  ) {
    super('Agent SSE 持久事件序列存在缺口')
    this.name = AgentStreamGapError.name
  }
}

export class AgentStreamSlowConsumerError extends Error {
  constructor() {
    super('Agent SSE 客户端消费速度过慢')
    this.name = AgentStreamSlowConsumerError.name
  }
}
