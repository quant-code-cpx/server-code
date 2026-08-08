import type { AgentModelProviderConfig } from 'src/config/model.config'
import {
  ModelGatewayError,
  type ModelCapability,
  type ModelChunk,
  type ModelDataClass,
  type ModelDescriptor,
  type ModelProvider,
  type ModelReasoningIntent,
  type ModelTokenCountEstimate,
  type NormalizedMessage,
  type ProviderModelRequest,
} from '../model-gateway.port'
import {
  mapProviderHttpError,
  nonNegativeInteger,
  parseProviderEvent,
  readProviderSseData,
} from './provider-stream.utils'

interface AnthropicEvent {
  type?: string
  message?: { id?: string; usage?: { input_tokens?: number; output_tokens?: number } }
  index?: number
  content_block?: { id?: string; type?: string; name?: string; input?: Record<string, unknown> }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
    stop_reason?: string | null
  }
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface AnthropicToolAccumulator {
  index: number
  id: string
  name: string
  arguments: string
  completed: boolean
}

export class AnthropicMessagesProvider implements ModelProvider {
  readonly provider: string
  private readonly descriptor: ModelDescriptor
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(
    config: AgentModelProviderConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    if (!config.baseUrl || !config.apiKey) throw new Error('[AgentModel] Anthropic Messages provider 配置不完整')
    this.provider = config.id
    this.apiKey = config.apiKey
    this.endpoint = `${config.baseUrl.replace(/\/$/, '')}/messages`
    this.descriptor = {
      provider: config.id,
      model: config.defaultModel,
      contextWindow: config.descriptor.contextWindow,
      maxOutputTokens: config.descriptor.maxOutputTokens,
      capabilities: config.descriptor.capabilities as ModelCapability[],
      reasoningEfforts: config.descriptor.reasoningEfforts,
      defaultReasoning: config.descriptor.defaultReasoning,
      dataClasses: config.descriptor.dataClasses as ModelDataClass[],
    }
  }

  listModels(): readonly ModelDescriptor[] {
    return [this.descriptor]
  }

  supports(model: string, required: readonly ModelCapability[]): boolean {
    return model === this.descriptor.model && required.every((item) => this.descriptor.capabilities.includes(item))
  }

  async countInputTokens(request: ProviderModelRequest, signal: AbortSignal): Promise<ModelTokenCountEstimate> {
    const body = toAnthropicRequest(request)
    delete body.stream
    delete body.max_tokens
    delete body.temperature
    let response: Response
    try {
      response = await this.fetchImpl(`${this.endpoint}/count_tokens`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new ModelGatewayError('UNAVAILABLE', true, 'Anthropic count_tokens 网络不可用')
    }
    if (!response.ok) throw await mapProviderHttpError(response)
    const payload = (await response.json()) as { input_tokens?: number }
    const rawInputTokens = nonNegativeInteger(payload.input_tokens, 'input_tokens')
    const safetyMarginTokens = Math.max(32, Math.ceil(rawInputTokens * 0.05))
    return {
      inputTokens: rawInputTokens + safetyMarginTokens,
      rawInputTokens,
      safetyMarginTokens,
      source: 'ANTHROPIC_COUNT_TOKENS_API',
      exact: true,
    }
  }

  async *stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk> {
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(toAnthropicRequest(request)),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof ModelGatewayError || signal.aborted) throw error
      throw new ModelGatewayError('UNAVAILABLE', true, 'Anthropic Messages 网络不可用')
    }
    if (!response.ok) throw await mapProviderHttpError(response)
    if (!response.body) throw new ModelGatewayError('UNAVAILABLE', true, 'Anthropic Messages 未返回响应流')

    const calls = new Map<number, AnthropicToolAccumulator>()
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let finishReason: string | null = null
    let providerRequestId = response.headers.get('request-id')
    let completed = false
    for await (const data of readProviderSseData(response.body, signal)) {
      if (data === '[DONE]') continue
      const event = parseProviderEvent<AnthropicEvent>(data)
      if (event.type === 'error') throw new ModelGatewayError('UNAVAILABLE', true, 'Anthropic 返回流式错误')
      if (event.type === 'message_start') {
        providerRequestId = event.message?.id ?? providerRequestId
        if (event.message?.usage?.input_tokens != null) {
          inputTokens = nonNegativeInteger(event.message.usage.input_tokens, 'input_tokens')
        }
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const index = event.index ?? calls.size
        calls.set(index, {
          index,
          id: event.content_block.id ?? `tool-${index}`,
          name: event.content_block.name ?? '',
          arguments: Object.keys(event.content_block.input ?? {}).length
            ? JSON.stringify(event.content_block.input)
            : '',
          completed: false,
        })
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'OUTPUT_TEXT_DELTA', text: event.delta.text }
        }
        if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          yield { type: 'REASONING_ACTIVITY', characters: event.delta.thinking.length }
        }
        if (event.delta?.type === 'input_json_delta') {
          const index = event.index ?? 0
          const call = calls.get(index)
          if (!call) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Anthropic 工具参数缺少起始事件')
          call.arguments += event.delta.partial_json ?? ''
          yield {
            type: 'TOOL_CALL_DELTA',
            index,
            providerToolCallId: call.id,
            argumentsDelta: event.delta.partial_json,
          }
        }
      }
      if (event.type === 'content_block_stop') {
        const call = calls.get(event.index ?? -1)
        if (call && !call.completed) yield completeAnthropicTool(call)
      }
      if (event.type === 'message_delta') {
        finishReason = event.delta?.stop_reason ?? finishReason
        if (event.usage?.output_tokens != null) {
          outputTokens = nonNegativeInteger(event.usage.output_tokens, 'output_tokens')
        }
      }
      if (event.type === 'message_stop') {
        for (const call of calls.values()) if (!call.completed) yield completeAnthropicTool(call)
        if (inputTokens != null && outputTokens != null) {
          yield { type: 'USAGE', usage: { inputTokens, outputTokens } }
        }
        completed = true
        yield { type: 'COMPLETED', finishReason, providerRequestId }
      }
    }
    if (!completed) throw new ModelGatewayError('UNAVAILABLE', true, 'Anthropic Messages 响应流提前中断')
  }
}

function toAnthropicRequest(request: ProviderModelRequest): Record<string, unknown> {
  const systemMessages = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    stream: true,
    messages: request.messages.filter((message) => message.role !== 'system').map(toAnthropicMessage),
  }
  if (systemMessages.length) body.system = systemMessages.join('\n\n')
  if (request.temperature != null) body.temperature = request.temperature
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  if (request.responseSchema) {
    body.output_config = {
      format: { type: 'json_schema', schema: request.responseSchema },
    }
  }
  applyAnthropicReasoning(body, request.reasoning)
  return body
}

function toAnthropicMessage(message: NormalizedMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool message 缺少 toolCallId')
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
    }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...message.toolCalls.map((call) => ({
          type: 'tool_use',
          id: call.providerToolCallId,
          name: call.name,
          input: call.arguments,
        })),
      ],
    }
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }
}

function applyAnthropicReasoning(body: Record<string, unknown>, intent: ModelReasoningIntent | undefined): void {
  if (!intent || intent.mode === 'AUTO') return
  if (intent.mode === 'DISABLED') return
  if (intent.mode === 'TOKEN_BUDGET') {
    body.thinking = { type: 'enabled', budget_tokens: intent.budgetTokens }
    if (intent.effort) mergeOutputEffort(body, intent.effort)
    return
  }
  body.thinking = { type: 'adaptive' }
  mergeOutputEffort(body, intent.effort)
}

function mergeOutputEffort(body: Record<string, unknown>, effort: string): void {
  const current = body.output_config
  body.output_config = {
    ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
    effort: effort.toLowerCase(),
  }
}

function completeAnthropicTool(call: AnthropicToolAccumulator): ModelChunk {
  let args: unknown
  try {
    args = JSON.parse(call.arguments || '{}')
  } catch {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'Anthropic 工具参数不是完整 JSON')
  }
  if (!call.name || !args || Array.isArray(args) || typeof args !== 'object') {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'Anthropic 工具调用格式非法')
  }
  call.completed = true
  return {
    type: 'TOOL_CALL_COMPLETED',
    index: call.index,
    providerToolCallId: call.id,
    name: call.name,
    arguments: args as Record<string, unknown>,
  }
}
