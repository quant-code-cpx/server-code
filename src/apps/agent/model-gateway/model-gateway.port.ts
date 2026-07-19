export const MODEL_GATEWAY = Symbol('MODEL_GATEWAY')
export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER')
export const MODEL_GATEWAY_OBSERVER = Symbol('MODEL_GATEWAY_OBSERVER')

export type ModelPolicy = 'AUTO' | 'MANUAL'
export type ModelPurpose = 'CLASSIFY' | 'PLAN' | 'SYNTHESIZE' | 'SUMMARIZE' | 'VERIFY'
export type ModelMessageRole = 'system' | 'user' | 'assistant' | 'tool'
export type ModelReasoningEffort = 'LOW' | 'MEDIUM' | 'HIGH'
export type ModelDataClass = 'PUBLIC' | 'USER_PRIVATE' | 'PORTFOLIO_SENSITIVE'
export type ModelCapability =
  | 'STREAMING'
  | 'STRUCTURED_OUTPUT'
  | 'TOOL_CALLING'
  | 'PARALLEL_TOOL_CALLING'
  | 'VISION'
  | 'REASONING_EFFORT'

export interface NormalizedToolCall {
  providerToolCallId: string
  name: string
  arguments: Record<string, unknown>
}

export interface NormalizedMessage {
  role: ModelMessageRole
  content: string
  toolCallId?: string
  toolCalls?: NormalizedToolCall[]
}

export interface NormalizedToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ModelTraceContext {
  runId: string
  modelCallId: string
  traceId: string
}

export interface ModelRequest {
  modelPolicy?: ModelPolicy
  preferredModel?: string | null
  purpose: ModelPurpose
  messages: NormalizedMessage[]
  tools?: NormalizedToolDefinition[]
  responseSchema?: Record<string, unknown>
  temperature?: number
  reasoningEffort?: ModelReasoningEffort
  maxOutputTokens: number
  deadlineAt: string
  dataClass?: ModelDataClass
  metadata?: Record<string, string | number | boolean>
  trace: ModelTraceContext
}

export interface ProviderModelRequest extends ModelRequest {
  model: string
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  reasoningTokens?: number
  providerCost?: {
    amount: string
    currency: string
    estimated: boolean
  }
}

export interface ModelToolCallDelta {
  type: 'TOOL_CALL_DELTA'
  index: number
  providerToolCallId?: string
  nameDelta?: string
  argumentsDelta?: string
}

export interface ModelToolCallCompleted {
  type: 'TOOL_CALL_COMPLETED'
  index: number
  providerToolCallId: string
  name: string
  arguments: Record<string, unknown>
}

export type ModelChunk =
  | { type: 'OUTPUT_TEXT_DELTA'; text: string }
  | ModelToolCallDelta
  | ModelToolCallCompleted
  | { type: 'USAGE'; usage: ModelUsage }
  | { type: 'COMPLETED'; finishReason: string | null; providerRequestId?: string | null }

export interface ModelCompletion {
  provider: string
  model: string
  text: string
  toolCalls: NormalizedToolCall[]
  usage: ModelUsage | null
  finishReason: string | null
  providerRequestId: string | null
}

export interface ModelResult<T> {
  data: T
  completion: ModelCompletion
  repaired: boolean
}

export interface ModelDescriptor {
  provider: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  capabilities: readonly ModelCapability[]
  reasoningEfforts: readonly ModelReasoningEffort[]
  dataClasses: readonly ModelDataClass[]
}

export interface ModelProvider {
  readonly provider: string
  listModels(): readonly ModelDescriptor[]
  supports(model: string, required: readonly ModelCapability[]): boolean
  stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk>
}

export interface ModelGatewayPort {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelChunk>
  generateStructured<T>(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult<T>>
  getCapabilities(modelRef?: string | null): ModelDescriptor
}

export type ModelGatewayErrorCategory = 'AUTH' | 'RATE_LIMIT' | 'TIMEOUT' | 'UNAVAILABLE' | 'CONTENT' | 'INVALID_OUTPUT'

export class ModelGatewayError extends Error {
  constructor(
    public readonly category: ModelGatewayErrorCategory,
    public readonly retryable: boolean,
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = ModelGatewayError.name
  }
}

export class ModelAbortError extends Error {
  constructor() {
    super('模型调用已取消')
    this.name = ModelAbortError.name
  }
}

export interface ModelGatewayMetricEvent {
  provider: string
  model: string
  purpose: ModelPurpose
  attempt: number
  durationMs: number
  ttftMs: number | null
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  errorCategory?: ModelGatewayErrorCategory
  usage?: ModelUsage | null
}

export interface ModelGatewayObserver {
  record(event: ModelGatewayMetricEvent): void
}
