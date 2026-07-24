export class ScheduledResearchValidationError extends Error {
  readonly code = 'AI_SCHEDULE_INVALID'

  constructor(message: string) {
    super(message)
    this.name = ScheduledResearchValidationError.name
  }
}

export class ScheduledResearchNotFoundError extends Error {
  readonly code = 'AI_SCHEDULE_NOT_FOUND'

  constructor(message = '定时研究任务不存在或无权访问') {
    super(message)
    this.name = ScheduledResearchNotFoundError.name
  }
}

export class ScheduledResearchConflictError extends Error {
  readonly code = 'AI_SCHEDULE_CONFLICT'

  constructor(message = '定时研究任务版本或状态冲突') {
    super(message)
    this.name = ScheduledResearchConflictError.name
  }
}
