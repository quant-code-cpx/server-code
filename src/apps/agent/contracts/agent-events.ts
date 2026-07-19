import { AGENT_CAPABILITIES, MESSAGE_ROLES, MESSAGE_STATUSES, MODEL_POLICIES } from './agent-status'
import { CITATION_SCHEMA, Citation } from './message-blocks'
import { AgentProtocolError, JsonSchema, assertJsonSchema } from './runtime-schema'
import { AGENT_TOOL_KEYS, AgentToolKey } from './tool-keys'
import type { MessageRole, MessageStatus, ModelPolicy } from './agent-status'

export const AGENT_EVENT_TYPES = [
  'message.created',
  'agent.started',
  'agent.planning',
  'agent.progress',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'model.started',
  'model.delta',
  'citation.created',
  'report.generated',
  'agent.completed',
  'agent.failed',
  'agent.cancelled',
] as const

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number]

export type StreamErrorCategory = 'VALIDATION' | 'AUTH' | 'MODEL' | 'TOOL' | 'SEARCH' | 'TIMEOUT' | 'INTERNAL'

export interface StreamError {
  code: number
  message: string
  retryable: boolean
  category: StreamErrorCategory
  safeDetails?: Record<string, unknown>
}

export interface AgentEvent<TType extends AgentEventType, TPayload> {
  schemaVersion: '1.0'
  eventId: string
  sequence: number
  type: TType
  runId: string
  conversationId: string
  messageId?: string
  occurredAt: string
  traceId: string
  payload: TPayload
}

export type MessageCreatedEvent = AgentEvent<
  'message.created',
  { messageId: string; role: MessageRole; status: MessageStatus }
>
export type AgentStartedEvent = AgentEvent<
  'agent.started',
  { workflowKey: string; workflowVersion: number; modelPolicy: ModelPolicy }
>
export type AgentPlanningEvent = AgentEvent<
  'agent.planning',
  { intent: string; capabilities: string[]; planSummary: string }
>
export type AgentProgressEvent = AgentEvent<
  'agent.progress',
  { stepKey: string; label: string; completed: number; total: number | null }
>
export type ToolStartedEvent = AgentEvent<
  'tool.started',
  { toolCallId: string; toolName: AgentToolKey; inputSummary: string; attempt: number }
>
export type ToolCompletedEvent = AgentEvent<
  'tool.completed',
  {
    toolCallId: string
    outputSummary: string
    rowCount: number
    truncated: boolean
    asOf: string
    citationIds: string[]
    durationMs: number
  }
>
export type ToolFailedEvent = AgentEvent<
  'tool.failed',
  { toolCallId: string; error: StreamError; attempt: number; willRetry: boolean }
>
export type ModelStartedEvent = AgentEvent<
  'model.started',
  { modelCallId: string; provider: string; model: string; purpose: string }
>
export type ModelDeltaEvent = AgentEvent<'model.delta', { modelCallId: string; blockIndex: number; delta: string }>
export type CitationCreatedEvent = AgentEvent<'citation.created', { citation: Citation }>
export type ReportGeneratedEvent = AgentEvent<
  'report.generated',
  { reportId: string; title: string; format: 'MARKDOWN' | 'PDF' }
>
export type AgentCompletedEvent = AgentEvent<
  'agent.completed',
  {
    finalMessageId: string
    usage: { inputTokens: number; outputTokens: number; totalTokens: number }
    cost: { amount: number; currency: string }
    dataCutoff: string | null
    warnings: string[]
  }
>
export type AgentFailedEvent = AgentEvent<
  'agent.failed',
  { error: StreamError; failedStep: string | null; retryable: boolean }
>
export type AgentCancelledEvent = AgentEvent<
  'agent.cancelled',
  { cancelledBy: 'USER' | 'SYSTEM' | 'TIMEOUT'; reason: string }
>

export type AgentSseEvent =
  | MessageCreatedEvent
  | AgentStartedEvent
  | AgentPlanningEvent
  | AgentProgressEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ModelStartedEvent
  | ModelDeltaEvent
  | CitationCreatedEvent
  | ReportGeneratedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | AgentCancelledEvent

const stringIdSchema: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 }
const nonNegativeIntegerSchema: JsonSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const positiveIntegerSchema: JsonSchema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const streamErrorSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'retryable', 'category'],
  properties: {
    code: { type: 'integer', minimum: 1, maximum: 9999 },
    message: { type: 'string', minLength: 1, maxLength: 1000 },
    retryable: { type: 'boolean' },
    category: { enum: ['VALIDATION', 'AUTH', 'MODEL', 'TOOL', 'SEARCH', 'TIMEOUT', 'INTERNAL'] },
    safeDetails: { type: 'object' },
  },
}

const eventBaseProperties = {
  schemaVersion: { const: '1.0' },
  eventId: stringIdSchema,
  sequence: nonNegativeIntegerSchema,
  type: { type: 'string' },
  runId: stringIdSchema,
  conversationId: stringIdSchema,
  messageId: stringIdSchema,
  occurredAt: { type: 'string', format: 'date-time' },
  traceId: stringIdSchema,
}

function eventSchema(type: AgentEventType, payload: JsonSchema): JsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    required: [
      'schemaVersion',
      'eventId',
      'sequence',
      'type',
      'runId',
      'conversationId',
      'occurredAt',
      'traceId',
      'payload',
    ],
    properties: {
      ...eventBaseProperties,
      type: { const: type },
      payload,
    },
  }
}

const payloadSchemas: Record<AgentEventType, JsonSchema> = {
  'message.created': {
    type: 'object',
    additionalProperties: false,
    required: ['messageId', 'role', 'status'],
    properties: {
      messageId: stringIdSchema,
      role: { enum: [...MESSAGE_ROLES] },
      status: { enum: [...MESSAGE_STATUSES] },
    },
  },
  'agent.started': {
    type: 'object',
    additionalProperties: false,
    required: ['workflowKey', 'workflowVersion', 'modelPolicy'],
    properties: {
      workflowKey: { type: 'string', minLength: 1, maxLength: 128 },
      workflowVersion: positiveIntegerSchema,
      modelPolicy: { enum: [...MODEL_POLICIES] },
    },
  },
  'agent.planning': {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'capabilities', 'planSummary'],
    properties: {
      intent: { type: 'string', minLength: 1, maxLength: 500 },
      capabilities: { type: 'array', maxItems: 20, items: { enum: [...AGENT_CAPABILITIES] } },
      planSummary: { type: 'string', minLength: 1, maxLength: 4000 },
    },
  },
  'agent.progress': {
    type: 'object',
    additionalProperties: false,
    required: ['stepKey', 'label', 'completed', 'total'],
    properties: {
      stepKey: { type: 'string', minLength: 1, maxLength: 128 },
      label: { type: 'string', minLength: 1, maxLength: 500 },
      completed: nonNegativeIntegerSchema,
      total: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
  },
  'tool.started': {
    type: 'object',
    additionalProperties: false,
    required: ['toolCallId', 'toolName', 'inputSummary', 'attempt'],
    properties: {
      toolCallId: stringIdSchema,
      toolName: { enum: [...AGENT_TOOL_KEYS] },
      inputSummary: { type: 'string', maxLength: 4000 },
      attempt: positiveIntegerSchema,
    },
  },
  'tool.completed': {
    type: 'object',
    additionalProperties: false,
    required: ['toolCallId', 'outputSummary', 'rowCount', 'truncated', 'asOf', 'citationIds', 'durationMs'],
    properties: {
      toolCallId: stringIdSchema,
      outputSummary: { type: 'string', maxLength: 4000 },
      rowCount: nonNegativeIntegerSchema,
      truncated: { type: 'boolean' },
      asOf: { type: 'string', format: 'date' },
      citationIds: { type: 'array', maxItems: 200, items: stringIdSchema },
      durationMs: nonNegativeIntegerSchema,
    },
  },
  'tool.failed': {
    type: 'object',
    additionalProperties: false,
    required: ['toolCallId', 'error', 'attempt', 'willRetry'],
    properties: {
      toolCallId: stringIdSchema,
      error: streamErrorSchema,
      attempt: positiveIntegerSchema,
      willRetry: { type: 'boolean' },
    },
  },
  'model.started': {
    type: 'object',
    additionalProperties: false,
    required: ['modelCallId', 'provider', 'model', 'purpose'],
    properties: {
      modelCallId: stringIdSchema,
      provider: { type: 'string', minLength: 1, maxLength: 128 },
      model: { type: 'string', minLength: 1, maxLength: 256 },
      purpose: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
  'model.delta': {
    type: 'object',
    additionalProperties: false,
    required: ['modelCallId', 'blockIndex', 'delta'],
    properties: {
      modelCallId: stringIdSchema,
      blockIndex: nonNegativeIntegerSchema,
      delta: { type: 'string', maxLength: 100_000 },
    },
  },
  'citation.created': {
    type: 'object',
    additionalProperties: false,
    required: ['citation'],
    properties: { citation: CITATION_SCHEMA },
  },
  'report.generated': {
    type: 'object',
    additionalProperties: false,
    required: ['reportId', 'title', 'format'],
    properties: {
      reportId: stringIdSchema,
      title: { type: 'string', minLength: 1, maxLength: 1000 },
      format: { enum: ['MARKDOWN', 'PDF'] },
    },
  },
  'agent.completed': {
    type: 'object',
    additionalProperties: false,
    required: ['finalMessageId', 'usage', 'cost', 'dataCutoff', 'warnings'],
    properties: {
      finalMessageId: stringIdSchema,
      usage: {
        type: 'object',
        additionalProperties: false,
        required: ['inputTokens', 'outputTokens', 'totalTokens'],
        properties: {
          inputTokens: nonNegativeIntegerSchema,
          outputTokens: nonNegativeIntegerSchema,
          totalTokens: nonNegativeIntegerSchema,
        },
      },
      cost: {
        type: 'object',
        additionalProperties: false,
        required: ['amount', 'currency'],
        properties: {
          amount: { type: 'number', minimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
        },
      },
      dataCutoff: { type: ['string', 'null'], format: 'date' },
      warnings: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
  },
  'agent.failed': {
    type: 'object',
    additionalProperties: false,
    required: ['error', 'failedStep', 'retryable'],
    properties: {
      error: streamErrorSchema,
      failedStep: { type: ['string', 'null'], maxLength: 128 },
      retryable: { type: 'boolean' },
    },
  },
  'agent.cancelled': {
    type: 'object',
    additionalProperties: false,
    required: ['cancelledBy', 'reason'],
    properties: {
      cancelledBy: { enum: ['USER', 'SYSTEM', 'TIMEOUT'] },
      reason: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  },
}

export const AGENT_SSE_EVENT_SCHEMA: JsonSchema = {
  oneOf: AGENT_EVENT_TYPES.map((type) => eventSchema(type, payloadSchemas[type])),
}

export const TERMINAL_AGENT_EVENT_TYPES = ['agent.completed', 'agent.failed', 'agent.cancelled'] as const

export function parseAgentSseEvent(input: unknown): AgentSseEvent {
  const event = assertJsonSchema<AgentSseEvent>(AGENT_SSE_EVENT_SCHEMA, input, 'AgentSseEvent')
  if (!Number.isSafeInteger(event.sequence)) throw new AgentProtocolError(['AgentSseEvent.sequence 超出安全整数范围'])
  return event
}

const eventBase = {
  schemaVersion: '1.0' as const,
  eventId: 'evt_fixture',
  sequence: 1,
  runId: 'run_fixture',
  conversationId: 'conversation_fixture',
  messageId: 'message_fixture',
  occurredAt: '2026-07-19T02:11:31.102Z',
  traceId: 'trace_fixture',
}

const fixtureError: StreamError = {
  code: 6011,
  message: 'Tool 执行超时',
  retryable: true,
  category: 'TOOL',
}

export const AGENT_EVENT_FIXTURES: AgentSseEvent[] = [
  {
    ...eventBase,
    type: 'message.created',
    payload: { messageId: 'message_fixture', role: 'ASSISTANT', status: 'PENDING' },
  },
  {
    ...eventBase,
    type: 'agent.started',
    payload: { workflowKey: 'research_v1', workflowVersion: 1, modelPolicy: 'AUTO' },
  },
  {
    ...eventBase,
    type: 'agent.planning',
    payload: { intent: 'stock_research', capabilities: ['INTERNAL_DATA'], planSummary: '读取行情并计算指标' },
  },
  {
    ...eventBase,
    type: 'agent.progress',
    payload: { stepKey: 'load_prices', label: '读取行情', completed: 1, total: 3 },
  },
  {
    ...eventBase,
    type: 'tool.started',
    payload: {
      toolCallId: 'tool_call_fixture',
      toolName: 'get_stock_overview',
      inputSummary: '查询 600519.SH',
      attempt: 1,
    },
  },
  {
    ...eventBase,
    type: 'tool.completed',
    payload: {
      toolCallId: 'tool_call_fixture',
      outputSummary: '返回个股概览',
      rowCount: 1,
      truncated: false,
      asOf: '2026-07-17',
      citationIds: ['citation_fixture'],
      durationMs: 50,
    },
  },
  {
    ...eventBase,
    type: 'tool.failed',
    payload: { toolCallId: 'tool_call_fixture', error: fixtureError, attempt: 1, willRetry: true },
  },
  {
    ...eventBase,
    type: 'model.started',
    payload: {
      modelCallId: 'model_call_fixture',
      provider: 'openai-compatible',
      model: 'research-model',
      purpose: 'final_answer',
    },
  },
  {
    ...eventBase,
    type: 'model.delta',
    payload: { modelCallId: 'model_call_fixture', blockIndex: 0, delta: '贵州茅台' },
  },
  {
    ...eventBase,
    type: 'citation.created',
    payload: {
      citation: {
        citationId: 'citation_fixture',
        sourceId: 'source_fixture',
        sourceType: 'DATABASE',
        title: '个股行情快照',
        retrievedAt: '2026-07-19T02:11:31.102Z',
        locator: { factId: 'fact_fixture' },
        contentHash: '0123456789abcdef',
      },
    },
  },
  {
    ...eventBase,
    type: 'report.generated',
    payload: { reportId: 'report_fixture', title: '研究报告', format: 'MARKDOWN' },
  },
  {
    ...eventBase,
    type: 'agent.completed',
    payload: {
      finalMessageId: 'message_fixture',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      cost: { amount: 0.1, currency: 'CNY' },
      dataCutoff: '2026-07-17',
      warnings: [],
    },
  },
  { ...eventBase, type: 'agent.failed', payload: { error: fixtureError, failedStep: 'load_prices', retryable: true } },
  { ...eventBase, type: 'agent.cancelled', payload: { cancelledBy: 'USER', reason: '用户取消' } },
]
