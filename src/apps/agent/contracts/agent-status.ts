export const CONVERSATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const MESSAGE_ROLES = ['USER', 'ASSISTANT', 'SYSTEM'] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]

export const MESSAGE_STATUSES = ['PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export const AGENT_RUN_STATUSES = ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export const AGENT_STEP_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'] as const
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number]

export const TOOL_CALL_STATUSES = [
  'PENDING',
  'AUTHORIZING',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REJECTED',
] as const
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number]

export const MODEL_CALL_STATUSES = ['PENDING', 'STREAMING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const
export type ModelCallStatus = (typeof MODEL_CALL_STATUSES)[number]

export const MODEL_POLICIES = ['AUTO', 'MANUAL'] as const
export type ModelPolicy = (typeof MODEL_POLICIES)[number]

export const AGENT_CAPABILITIES = ['INTERNAL_DATA', 'QUANT_COMPUTE', 'WEB_SEARCH'] as const
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number]
