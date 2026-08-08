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
  type ProviderModelRequest,
} from '../model-gateway.port'
import {
  mapProviderHttpError,
  nonNegativeInteger,
  parseProviderEvent,
  readProviderSseData,
} from './provider-stream.utils'

interface ResponsesEvent {
  type?: string
  delta?: string
  item_id?: string
  output_index?: number
  name?: string
  arguments?: string
  item?: { id?: string; call_id?: string; type?: string; name?: string; arguments?: string }
  response?: {
    id?: string
    status?: string
    incomplete_details?: { reason?: string }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
      output_tokens_details?: { reasoning_tokens?: number }
    }
  }
}

interface ToolAccumulator {
  index: number
  itemId: string
  callId: string
  name: string
  arguments: string
  completed: boolean
}

export class OpenAiResponsesProvider implements ModelProvider {
  readonly provider: string
  private readonly descriptor: ModelDescriptor
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(
    config: AgentModelProviderConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    if (!config.baseUrl || !config.apiKey) throw new Error('[AgentModel] OpenAI Responses provider 配置不完整')
    this.provider = config.id
    this.apiKey = config.apiKey
    this.endpoint = `${config.baseUrl.replace(/\/$/, '')}/responses`
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
    const body = toResponsesRequest(request)
    delete body.stream
    delete body.max_output_tokens
    let response: Response
    try {
      response = await this.fetchImpl(`${this.endpoint}/input_tokens`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new ModelGatewayError('UNAVAILABLE', true, 'OpenAI input_tokens 网络不可用')
    }
    if (!response.ok) throw await mapProviderHttpError(response)
    const payload = (await response.json()) as { input_tokens?: number }
    const rawInputTokens = nonNegativeInteger(payload.input_tokens, 'input_tokens')
    const safetyMarginTokens = Math.max(32, Math.ceil(rawInputTokens * 0.05))
    return {
      inputTokens: rawInputTokens + safetyMarginTokens,
      rawInputTokens,
      safetyMarginTokens,
      source: 'OPENAI_INPUT_TOKENS_API',
      exact: true,
    }
  }

  async *stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk> {
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(toResponsesRequest(request)),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof ModelGatewayError || signal.aborted) throw error
      throw new ModelGatewayError('UNAVAILABLE', true, 'OpenAI Responses 网络不可用')
    }
    if (!response.ok) throw await mapProviderHttpError(response)
    if (!response.body) throw new ModelGatewayError('UNAVAILABLE', true, 'OpenAI Responses 未返回响应流')

    const calls = new Map<string, ToolAccumulator>()
    let providerRequestId = response.headers.get('x-request-id')
    let completed = false
    for await (const data of readProviderSseData(response.body, signal)) {
      if (data === '[DONE]') continue
      const event = parseProviderEvent<ResponsesEvent>(data)
      if (event.response?.id) providerRequestId = event.response.id
      if (event.type === 'response.output_text.delta' && event.delta) {
        yield { type: 'OUTPUT_TEXT_DELTA', text: event.delta }
      }
      if (
        (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') &&
        event.delta
      ) {
        yield { type: 'REASONING_ACTIVITY', characters: event.delta.length }
      }
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        const itemId = event.item.id ?? `item-${event.output_index ?? calls.size}`
        calls.set(itemId, {
          index: event.output_index ?? calls.size,
          itemId,
          callId: event.item.call_id ?? itemId,
          name: event.item.name ?? '',
          arguments: event.item.arguments ?? '',
          completed: false,
        })
      }
      if (event.type === 'response.function_call_arguments.delta' && event.item_id) {
        const call = calls.get(event.item_id)
        if (!call) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Responses 工具参数缺少起始事件')
        call.arguments += event.delta ?? ''
        yield {
          type: 'TOOL_CALL_DELTA',
          index: call.index,
          providerToolCallId: call.callId,
          argumentsDelta: event.delta,
        }
      }
      if (event.type === 'response.function_call_arguments.done' && event.item_id) {
        const call = calls.get(event.item_id)
        if (!call) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Responses 工具完成事件缺少起始事件')
        if (event.name) call.name = event.name
        if (event.arguments != null) call.arguments = event.arguments
        yield completeToolCall(call)
      }
      if (event.type === 'response.failed' || event.type === 'error') {
        throw new ModelGatewayError('UNAVAILABLE', true, 'OpenAI Responses 返回流式错误')
      }
      if (event.type === 'response.completed') {
        for (const call of calls.values()) if (!call.completed) yield completeToolCall(call)
        if (event.response?.usage) {
          const usage = event.response.usage
          yield {
            type: 'USAGE',
            usage: {
              inputTokens: nonNegativeInteger(usage.input_tokens, 'input_tokens'),
              outputTokens: nonNegativeInteger(usage.output_tokens, 'output_tokens'),
              ...(usage.input_tokens_details?.cached_tokens == null
                ? {}
                : { cachedTokens: nonNegativeInteger(usage.input_tokens_details.cached_tokens, 'cached_tokens') }),
              ...(usage.output_tokens_details?.reasoning_tokens == null
                ? {}
                : {
                    reasoningTokens: nonNegativeInteger(
                      usage.output_tokens_details.reasoning_tokens,
                      'reasoning_tokens',
                    ),
                  }),
            },
          }
        }
        completed = true
        yield {
          type: 'COMPLETED',
          finishReason: event.response?.incomplete_details?.reason ?? event.response?.status ?? 'completed',
          providerRequestId,
        }
      }
    }
    if (!completed) throw new ModelGatewayError('UNAVAILABLE', true, 'OpenAI Responses 响应流提前中断')
  }
}

function toResponsesRequest(request: ProviderModelRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.messages.flatMap((message) => {
      if (message.role === 'tool') {
        if (!message.toolCallId) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool message 缺少 toolCallId')
        return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }]
      }
      const items: Record<string, unknown>[] = [{ role: message.role, content: message.content }]
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: 'function_call',
          call_id: call.providerToolCallId,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })
      }
      return items
    }),
    stream: true,
    max_output_tokens: request.maxOutputTokens,
  }
  if (request.temperature != null) body.temperature = request.temperature
  const reasoning = toOpenAiReasoning(request.reasoning)
  if (reasoning) body.reasoning = reasoning
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    }))
    body.tool_choice = 'auto'
    if (typeof request.metadata?.parallelToolCalls === 'boolean') {
      body.parallel_tool_calls = request.metadata.parallelToolCalls
    }
  }
  if (request.responseSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'structured_response',
        schema: request.responseSchema,
        strict: true,
      },
    }
  }
  return body
}

function toOpenAiReasoning(intent: ModelReasoningIntent | undefined): Record<string, unknown> | null {
  if (!intent || intent.mode === 'AUTO') return null
  if (intent.mode === 'DISABLED') return { effort: 'none' }
  if (intent.mode === 'TOKEN_BUDGET') {
    throw new ModelGatewayError('CONTENT', false, 'OpenAI Responses 不支持 Token budget 推理模式')
  }
  return { effort: intent.effort.toLowerCase() }
}

function completeToolCall(call: ToolAccumulator): ModelChunk {
  let args: unknown
  try {
    args = JSON.parse(call.arguments || '{}')
  } catch {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'Responses 工具参数不是完整 JSON')
  }
  if (!call.name || !args || Array.isArray(args) || typeof args !== 'object') {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'Responses 工具调用格式非法')
  }
  call.completed = true
  return {
    type: 'TOOL_CALL_COMPLETED',
    index: call.index,
    providerToolCallId: call.callId,
    name: call.name,
    arguments: args as Record<string, unknown>,
  }
}
