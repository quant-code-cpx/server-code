export interface AgentErrorDefinition {
  code: number
  key: AgentErrorKey
  httpStatus: number
  retryable: boolean
  message: string
}

export const AGENT_ERROR_DEFINITIONS = [
  { code: 6001, key: 'AI_CONVERSATION_NOT_FOUND', httpStatus: 404, retryable: false, message: '会话不存在或无权访问' },
  { code: 6002, key: 'AI_RUN_NOT_FOUND', httpStatus: 404, retryable: false, message: 'Agent Run 不存在或无权访问' },
  { code: 6003, key: 'AI_RUN_NOT_CANCELLABLE', httpStatus: 409, retryable: false, message: 'Agent Run 当前不可取消' },
  { code: 6004, key: 'AI_DUPLICATE_REQUEST_CONFLICT', httpStatus: 409, retryable: false, message: '幂等请求内容冲突' },
  { code: 6005, key: 'AI_MODEL_NOT_AVAILABLE', httpStatus: 503, retryable: true, message: '模型暂不可用' },
  { code: 6006, key: 'AI_MODEL_RATE_LIMITED', httpStatus: 429, retryable: true, message: '模型调用频率受限' },
  { code: 6007, key: 'AI_MODEL_TIMEOUT', httpStatus: 504, retryable: true, message: '模型调用超时' },
  { code: 6008, key: 'AI_TOOL_NOT_FOUND', httpStatus: 400, retryable: false, message: 'Tool 未注册' },
  { code: 6009, key: 'AI_TOOL_FORBIDDEN', httpStatus: 403, retryable: false, message: '无权使用该 Tool' },
  { code: 6010, key: 'AI_TOOL_VALIDATION_FAILED', httpStatus: 400, retryable: false, message: 'Tool 参数校验失败' },
  { code: 6011, key: 'AI_TOOL_TIMEOUT', httpStatus: 504, retryable: true, message: 'Tool 执行超时' },
  { code: 6012, key: 'AI_TOOL_RESULT_LIMIT_EXCEEDED', httpStatus: 422, retryable: false, message: 'Tool 结果超过限制' },
  { code: 6013, key: 'AI_DATA_NOT_AVAILABLE', httpStatus: 422, retryable: false, message: '指定截止日无可用数据' },
  { code: 6014, key: 'AI_DATA_STALE', httpStatus: 409, retryable: false, message: '数据时效不满足要求' },
  { code: 6015, key: 'AI_SEARCH_FAILED', httpStatus: 502, retryable: true, message: '联网搜索失败' },
  { code: 6016, key: 'AI_WEB_SOURCE_BLOCKED', httpStatus: 422, retryable: false, message: '网页来源被安全策略拦截' },
  { code: 6017, key: 'AI_CITATION_INVALID', httpStatus: 422, retryable: false, message: '引用验证失败' },
  { code: 6018, key: 'AI_CONTEXT_TOO_LARGE', httpStatus: 422, retryable: false, message: '上下文超过模型限制' },
  { code: 6019, key: 'AI_COST_QUOTA_EXCEEDED', httpStatus: 429, retryable: false, message: 'Agent 成本额度不足' },
  { code: 6020, key: 'AI_RUN_TIMEOUT', httpStatus: 504, retryable: true, message: 'Agent Run 超时' },
  { code: 6021, key: 'AI_SCHEDULE_INVALID', httpStatus: 400, retryable: false, message: 'Agent 计划配置无效' },
  {
    code: 6022,
    key: 'AI_NOTIFICATION_CHANNEL_INVALID',
    httpStatus: 400,
    retryable: false,
    message: '通知通道配置无效',
  },
  { code: 6023, key: 'AI_NOTIFICATION_DELIVERY_FAILED', httpStatus: 502, retryable: true, message: '通知发送失败' },
  { code: 6024, key: 'AI_WORKFLOW_VERSION_MISSING', httpStatus: 409, retryable: false, message: '工作流版本不存在' },
  { code: 6025, key: 'AI_PROMPT_VERSION_MISSING', httpStatus: 409, retryable: false, message: 'Prompt 版本不存在' },
  { code: 6026, key: 'AI_TOOL_RATE_LIMITED', httpStatus: 429, retryable: true, message: 'Tool 调用频率受限' },
  { code: 6027, key: 'AI_TOOL_UPSTREAM_FAILED', httpStatus: 502, retryable: true, message: 'Tool 上游服务失败' },
  { code: 6028, key: 'AI_DATA_QUALITY_FAILED', httpStatus: 422, retryable: false, message: '数据质量门禁失败' },
  { code: 6029, key: 'AI_TOOL_OUTPUT_INVALID', httpStatus: 502, retryable: false, message: 'Tool 输出协议无效' },
  { code: 6030, key: 'AI_CONFIRMATION_REQUIRED', httpStatus: 409, retryable: false, message: '操作需要用户确认' },
  { code: 6031, key: 'AI_RUN_CANCELLED', httpStatus: 409, retryable: false, message: 'Agent Run 已取消' },
  { code: 6099, key: 'AI_INTERNAL_ERROR', httpStatus: 500, retryable: true, message: 'Agent 内部错误' },
] as const satisfies readonly AgentErrorDefinition[]

export type AgentErrorKey =
  | 'AI_CONVERSATION_NOT_FOUND'
  | 'AI_RUN_NOT_FOUND'
  | 'AI_RUN_NOT_CANCELLABLE'
  | 'AI_DUPLICATE_REQUEST_CONFLICT'
  | 'AI_MODEL_NOT_AVAILABLE'
  | 'AI_MODEL_RATE_LIMITED'
  | 'AI_MODEL_TIMEOUT'
  | 'AI_TOOL_NOT_FOUND'
  | 'AI_TOOL_FORBIDDEN'
  | 'AI_TOOL_VALIDATION_FAILED'
  | 'AI_TOOL_TIMEOUT'
  | 'AI_TOOL_RESULT_LIMIT_EXCEEDED'
  | 'AI_DATA_NOT_AVAILABLE'
  | 'AI_DATA_STALE'
  | 'AI_SEARCH_FAILED'
  | 'AI_WEB_SOURCE_BLOCKED'
  | 'AI_CITATION_INVALID'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_COST_QUOTA_EXCEEDED'
  | 'AI_RUN_TIMEOUT'
  | 'AI_SCHEDULE_INVALID'
  | 'AI_NOTIFICATION_CHANNEL_INVALID'
  | 'AI_NOTIFICATION_DELIVERY_FAILED'
  | 'AI_WORKFLOW_VERSION_MISSING'
  | 'AI_PROMPT_VERSION_MISSING'
  | 'AI_TOOL_RATE_LIMITED'
  | 'AI_TOOL_UPSTREAM_FAILED'
  | 'AI_DATA_QUALITY_FAILED'
  | 'AI_TOOL_OUTPUT_INVALID'
  | 'AI_CONFIRMATION_REQUIRED'
  | 'AI_RUN_CANCELLED'
  | 'AI_INTERNAL_ERROR'

export const AGENT_ERROR_BY_CODE = new Map<number, AgentErrorDefinition>(
  AGENT_ERROR_DEFINITIONS.map((definition) => [definition.code, definition]),
)
