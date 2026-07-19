import type { IModelConfig } from 'src/config/model.config'
import {
  ModelGatewayError,
  type ModelCapability,
  type ModelChunk,
  type ModelDataClass,
  type ModelDescriptor,
  type ModelProvider,
  type ModelReasoningEffort,
  type ModelUsage,
  type NormalizedMessage,
  type ProviderModelRequest,
} from '../model-gateway.port'

interface OpenAiStreamChunk {
  id?: string
  error?: unknown
  choices?: Array<{
    index?: number
    delta?: {
      content?: string | null
      refusal?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  } | null
}

interface ToolCallAccumulator {
  index: number
  providerToolCallId: string
  name: string
  arguments: string
  completed: boolean
}

const MAX_SSE_BUFFER_CHARS = 1_000_000
const MAX_TOOL_ARGUMENT_CHARS = 1_000_000

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly provider = 'openai-compatible'
  private readonly descriptor: ModelDescriptor
  private readonly endpoint: string

  constructor(
    private readonly config: IModelConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    if (!config.baseUrl || !config.apiKey) throw new Error('[AgentModel] OpenAI-compatible provider 配置不完整')
    this.endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
    this.descriptor = {
      provider: this.provider,
      model: config.defaultModel,
      contextWindow: config.descriptor.contextWindow,
      maxOutputTokens: config.descriptor.maxOutputTokens,
      capabilities: config.descriptor.capabilities as ModelCapability[],
      reasoningEfforts: config.descriptor.reasoningEfforts as ModelReasoningEffort[],
      dataClasses: config.descriptor.dataClasses as ModelDataClass[],
    }
  }

  listModels(): readonly ModelDescriptor[] {
    return [this.descriptor]
  }

  supports(model: string, required: readonly ModelCapability[]): boolean {
    return (
      model === this.descriptor.model &&
      required.every((capability) => this.descriptor.capabilities.includes(capability))
    )
  }

  async *stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk> {
    const requestBody = JSON.stringify(toOpenAiRequest(request))
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: requestBody,
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error
      if (signal.aborted || isAbortError(error)) throw error
      throw new ModelGatewayError('UNAVAILABLE', true, '模型供应商网络不可用')
    }

    if (!response.ok) throw mapHttpError(response)
    if (!response.body) throw new ModelGatewayError('UNAVAILABLE', true, '模型供应商未返回响应流')

    const toolCalls = new Map<number, ToolCallAccumulator>()
    let providerRequestId = response.headers.get('x-request-id')
    let sawDone = false
    let sawFinish = false

    for await (const data of readSseData(response.body, signal)) {
      if (data === '[DONE]') {
        sawDone = true
        break
      }
      const chunk = parseStreamChunk(data)
      if (chunk.error) throw new ModelGatewayError('UNAVAILABLE', true, '模型供应商返回流式错误')
      if (chunk.id) providerRequestId = chunk.id

      for (const choice of chunk.choices ?? []) {
        if ((choice.index ?? 0) !== 0) continue
        const delta = choice.delta ?? {}
        if (delta.refusal) throw new ModelGatewayError('CONTENT', false, '模型拒绝处理当前内容')
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'OUTPUT_TEXT_DELTA', text: delta.content }
        }
        for (const toolDelta of delta.tool_calls ?? []) {
          const normalized = mergeToolCallDelta(toolCalls, toolDelta)
          yield {
            type: 'TOOL_CALL_DELTA',
            index: normalized.index,
            providerToolCallId: toolDelta.id,
            nameDelta: toolDelta.function?.name,
            argumentsDelta: toolDelta.function?.arguments,
          }
        }
        if (choice.finish_reason != null) {
          yield* completeToolCalls(toolCalls)
          sawFinish = true
          yield { type: 'COMPLETED', finishReason: choice.finish_reason, providerRequestId }
        }
      }

      if (chunk.usage) yield { type: 'USAGE', usage: normalizeUsage(chunk.usage) }
    }

    if (!sawDone && !sawFinish) throw new ModelGatewayError('UNAVAILABLE', true, '模型供应商响应流提前中断')
    if (!sawFinish) {
      yield* completeToolCalls(toolCalls)
      yield { type: 'COMPLETED', finishReason: null, providerRequestId }
    }
  }
}

function toOpenAiRequest(request: ProviderModelRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toOpenAiMessage),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: request.maxOutputTokens,
  }
  if (request.temperature != null) body.temperature = request.temperature
  if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort.toLowerCase()
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true,
      },
    }))
    body.tool_choice = 'auto'
  }
  if (request.responseSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'agent_response',
        strict: true,
        schema: request.responseSchema,
      },
    }
  }
  return body
}

function toOpenAiMessage(message: NormalizedMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool message 缺少 toolCallId')
    return { role: message.role, content: message.content, tool_call_id: message.toolCallId }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.providerToolCallId,
        type: 'function',
        function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

function mergeToolCallDelta(
  calls: Map<number, ToolCallAccumulator>,
  delta: { index?: number; id?: string; function?: { name?: string; arguments?: string } },
): ToolCallAccumulator {
  const index = delta.index
  if (!Number.isInteger(index) || index < 0) {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call delta index 非法')
  }
  const current = calls.get(index) ?? {
    index,
    providerToolCallId: '',
    name: '',
    arguments: '',
    completed: false,
  }
  if (current.completed) throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call 完成后仍收到 delta')
  if (delta.id) current.providerToolCallId = delta.id
  if (delta.function?.name) {
    current.name = mergeStringFragment(current.name, delta.function.name)
  }
  if (delta.function?.arguments) {
    current.arguments += delta.function.arguments
    if (current.arguments.length > MAX_TOOL_ARGUMENT_CHARS) {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call arguments 超过限制')
    }
  }
  calls.set(index, current)
  return current
}

function mergeStringFragment(current: string, fragment: string): string {
  if (!current) return fragment
  if (current === fragment || current.endsWith(fragment)) return current
  if (fragment.startsWith(current)) return fragment
  return current + fragment
}

function* completeToolCalls(calls: Map<number, ToolCallAccumulator>): Iterable<ModelChunk> {
  for (const call of [...calls.values()].sort((left, right) => left.index - right.index)) {
    if (call.completed) continue
    if (!call.providerToolCallId || !call.name) {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call 缺少 provider ID 或名称')
    }
    let args: unknown
    try {
      args = JSON.parse(call.arguments || '{}')
    } catch {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call arguments 不是完整 JSON')
    }
    if (!args || Array.isArray(args) || typeof args !== 'object') {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool call arguments 必须是 JSON object')
    }
    call.completed = true
    yield {
      type: 'TOOL_CALL_COMPLETED',
      index: call.index,
      providerToolCallId: call.providerToolCallId,
      name: call.name,
      arguments: args as Record<string, unknown>,
    }
  }
}

async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let dataLines: string[] = []
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_SSE_BUFFER_CHARS) {
        throw new ModelGatewayError('INVALID_OUTPUT', false, 'SSE event 超过缓冲限制')
      }

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        let line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          if (dataLines.length > 0) {
            yield dataLines.join('\n')
            dataLines = []
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart())
    if (dataLines.length > 0) yield dataLines.join('\n')
  } catch (error) {
    if (error instanceof ModelGatewayError || signal.aborted) throw error
    throw new ModelGatewayError('UNAVAILABLE', true, '读取模型供应商响应流失败')
  } finally {
    reader.releaseLock()
  }
}

function parseStreamChunk(data: string): OpenAiStreamChunk {
  try {
    const value = JSON.parse(data)
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid shape')
    return value as OpenAiStreamChunk
  } catch {
    throw new ModelGatewayError('INVALID_OUTPUT', false, '模型供应商 SSE data 不是有效 JSON')
  }
}

function normalizeUsage(usage: NonNullable<OpenAiStreamChunk['usage']>): ModelUsage {
  const inputTokens = requireNonNegativeInteger(usage.prompt_tokens, 'prompt_tokens')
  const outputTokens = requireNonNegativeInteger(usage.completion_tokens, 'completion_tokens')
  const cachedTokens = optionalNonNegativeInteger(usage.prompt_tokens_details?.cached_tokens, 'cached_tokens')
  const reasoningTokens = optionalNonNegativeInteger(
    usage.completion_tokens_details?.reasoning_tokens,
    'reasoning_tokens',
  )
  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens == null ? {} : { cachedTokens }),
    ...(reasoningTokens == null ? {} : { reasoningTokens }),
  }
}

function requireNonNegativeInteger(value: number | undefined, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ModelGatewayError('INVALID_OUTPUT', false, `模型 usage ${name} 非法`)
  }
  return value
}

function optionalNonNegativeInteger(value: number | undefined, name: string): number | undefined {
  if (value == null) return undefined
  return requireNonNegativeInteger(value, name)
}

function mapHttpError(response: Response): ModelGatewayError {
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
  if (response.status === 401 || response.status === 403) {
    return new ModelGatewayError('AUTH', false, '模型供应商鉴权失败', response.status)
  }
  if (response.status === 429) {
    return new ModelGatewayError('RATE_LIMIT', true, '模型供应商限流', response.status, retryAfterMs)
  }
  if (response.status === 408) {
    return new ModelGatewayError('TIMEOUT', true, '模型供应商请求超时', response.status, retryAfterMs)
  }
  if (response.status >= 500) {
    return new ModelGatewayError('UNAVAILABLE', true, '模型供应商暂不可用', response.status, retryAfterMs)
  }
  if (response.status === 400 || response.status === 409 || response.status === 422) {
    return new ModelGatewayError('CONTENT', false, '模型供应商拒绝请求内容', response.status)
  }
  return new ModelGatewayError('UNAVAILABLE', false, '模型供应商请求失败', response.status)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const at = Date.parse(value)
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now())
  return undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
