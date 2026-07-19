import { Inject, Injectable } from '@nestjs/common'
import Ajv, { type ValidateFunction } from 'ajv'
import { ModelConfig, type IModelConfig } from 'src/config/model.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ModelCapabilityRegistry } from './model-capability.registry'
import {
  MODEL_GATEWAY_OBSERVER,
  MODEL_PROVIDER,
  ModelAbortError,
  ModelGatewayError,
  type ModelChunk,
  type ModelCompletion,
  type ModelDescriptor,
  type ModelGatewayMetricEvent,
  type ModelGatewayObserver,
  type ModelGatewayPort,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  type ModelUsage,
  type ProviderModelRequest,
} from './model-gateway.port'

interface AttemptSignal {
  signal: AbortSignal
  cleanup(): void
  timedOut(): boolean
}

@Injectable()
export class ModelGatewayService implements ModelGatewayPort {
  private readonly ajv = new Ajv({ strict: true, allErrors: true })

  constructor(
    @Inject(MODEL_PROVIDER) private readonly provider: ModelProvider,
    private readonly registry: ModelCapabilityRegistry,
    @Inject(ModelConfig.KEY) private readonly config: IModelConfig,
    private readonly logger: LoggerService,
    @Inject(MODEL_GATEWAY_OBSERVER) private readonly observer: ModelGatewayObserver,
  ) {}

  getCapabilities(modelRef?: string | null): ModelDescriptor {
    return this.registry.get(modelRef?.trim() || this.config.defaultModel)
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelChunk> {
    validateRequest(request)
    if (request.responseSchema) this.compileSchema(request.responseSchema, 'responseSchema')
    for (const tool of request.tools ?? []) this.compileSchema(tool.parameters, `Tool ${tool.name} parameters`)
    const parentSignal = signal ?? new AbortController().signal
    if (parentSignal.aborted) throw new ModelAbortError()
    const model = this.resolveModel(request)
    this.registry.assertRequestSupported(model, request)
    const providerRequest: ProviderModelRequest = { ...request, model }
    const deadlineAt = Date.parse(request.deadlineAt)

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      const startedAt = Date.now()
      const bounded = createAttemptSignal(parentSignal, deadlineAt, this.config.timeoutMs)
      let emittedOutput = false
      let ttftMs: number | null = null
      let usage: ModelUsage | null = null

      try {
        for await (const chunk of this.provider.stream(providerRequest, bounded.signal)) {
          if (isVisibleOutput(chunk)) {
            emittedOutput = true
            if (ttftMs == null) ttftMs = Date.now() - startedAt
          }
          if (chunk.type === 'USAGE') usage = chunk.usage
          yield chunk
        }
        const event: ModelGatewayMetricEvent = {
          provider: this.provider.provider,
          model,
          purpose: request.purpose,
          attempt,
          durationMs: Date.now() - startedAt,
          ttftMs,
          status: 'SUCCEEDED',
          usage,
        }
        this.record(event, request)
        return
      } catch (rawError) {
        const error = normalizeAttemptError(rawError, parentSignal, bounded)
        const cancelled = error instanceof ModelAbortError
        const event: ModelGatewayMetricEvent = {
          provider: this.provider.provider,
          model,
          purpose: request.purpose,
          attempt,
          durationMs: Date.now() - startedAt,
          ttftMs,
          status: cancelled ? 'CANCELLED' : 'FAILED',
          ...(!cancelled && error instanceof ModelGatewayError ? { errorCategory: error.category } : {}),
        }
        this.record(event, request)
        if (cancelled) throw error
        if (!(error instanceof ModelGatewayError)) throw error
        if (!error.retryable || emittedOutput || attempt > this.config.maxRetries) throw error
        await delayBeforeRetry(error, attempt, deadlineAt, parentSignal, this.config.retryBaseMs)
      } finally {
        bounded.cleanup()
      }
    }
  }

  async generateStructured<T>(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult<T>> {
    if (!request.responseSchema) {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'generateStructured 必须提供 responseSchema')
    }
    const validate = this.compileSchema(request.responseSchema, 'responseSchema')
    let currentRequest = request
    let lastCompletion: ModelCompletion | null = null

    for (let repairAttempt = 0; repairAttempt <= 1; repairAttempt += 1) {
      const completion = await this.collectCompletion(currentRequest, signal)
      lastCompletion = completion
      const parsed = parseStructuredText(completion.text)
      if (parsed.ok && validate(parsed.value)) {
        return { data: parsed.value as T, completion, repaired: repairAttempt === 1 }
      }
      if (repairAttempt === 0) currentRequest = createRepairRequest(request, completion.text)
    }

    throw new ModelGatewayError(
      'INVALID_OUTPUT',
      false,
      `模型结构化输出校验失败${lastCompletion?.finishReason ? ` (${lastCompletion.finishReason})` : ''}`,
    )
  }

  private resolveModel(request: ModelRequest): string {
    const preferredModel = request.preferredModel?.trim() || null
    if ((request.modelPolicy ?? 'AUTO') === 'MANUAL') {
      if (!preferredModel)
        throw new ModelGatewayError('UNAVAILABLE', false, 'MANUAL modelPolicy 必须指定 preferredModel')
      return preferredModel
    }
    return preferredModel ?? this.config.defaultModel
  }

  private compileSchema(schema: Record<string, unknown>, label: string): ValidateFunction {
    try {
      return this.ajv.compile(schema)
    } catch {
      throw new ModelGatewayError('INVALID_OUTPUT', false, `${label} 不是有效 strict JSON Schema`)
    }
  }

  private async collectCompletion(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
    let text = ''
    const toolCalls = new Map<number, ModelCompletion['toolCalls'][number]>()
    let usage: ModelUsage | null = null
    let finishReason: string | null = null
    let providerRequestId: string | null = null
    let completed = false
    const model = this.resolveModel(request)

    for await (const chunk of this.stream(request, signal)) {
      if (chunk.type === 'OUTPUT_TEXT_DELTA') text += chunk.text
      if (chunk.type === 'TOOL_CALL_COMPLETED') {
        toolCalls.set(chunk.index, {
          providerToolCallId: chunk.providerToolCallId,
          name: chunk.name,
          arguments: chunk.arguments,
        })
      }
      if (chunk.type === 'USAGE') usage = chunk.usage
      if (chunk.type === 'COMPLETED') {
        completed = true
        finishReason = chunk.finishReason
        providerRequestId = chunk.providerRequestId ?? null
      }
    }
    if (!completed) throw new ModelGatewayError('INVALID_OUTPUT', false, '模型流缺少 COMPLETED 事件')

    return {
      provider: this.provider.provider,
      model,
      text,
      toolCalls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call),
      usage,
      finishReason,
      providerRequestId,
    }
  }

  private record(event: ModelGatewayMetricEvent, request: ModelRequest): void {
    try {
      this.observer.record(event)
    } catch {
      this.logger.warn(
        { operation: 'modelGatewayObserver', status: 'FAILED', provider: event.provider, model: event.model },
        ModelGatewayService.name,
      )
    }
    const payload = {
      operation: 'modelGatewayAttempt',
      provider: event.provider,
      model: event.model,
      purpose: event.purpose,
      modelCallId: request.trace.modelCallId,
      traceId: request.trace.traceId,
      attempt: event.attempt,
      durationMs: event.durationMs,
      ttftMs: event.ttftMs,
      status: event.status,
      errorCategory: event.errorCategory,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
      cachedTokens: event.usage?.cachedTokens,
    }
    if (event.status === 'SUCCEEDED') this.logger.log(payload, ModelGatewayService.name)
    else this.logger.warn(payload, ModelGatewayService.name)
  }
}

function validateRequest(request: ModelRequest): void {
  if (!['AUTO', 'MANUAL'].includes(request.modelPolicy ?? 'AUTO')) {
    throw new ModelGatewayError('CONTENT', false, 'modelPolicy 非法')
  }
  if (!['CLASSIFY', 'PLAN', 'SYNTHESIZE', 'SUMMARIZE', 'VERIFY'].includes(request.purpose)) {
    throw new ModelGatewayError('CONTENT', false, 'purpose 非法')
  }
  if (request.reasoningEffort && !['LOW', 'MEDIUM', 'HIGH'].includes(request.reasoningEffort)) {
    throw new ModelGatewayError('CONTENT', false, 'reasoningEffort 非法')
  }
  if (request.dataClass && !['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'].includes(request.dataClass)) {
    throw new ModelGatewayError('CONTENT', false, 'dataClass 非法')
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ModelGatewayError('CONTENT', false, '模型请求 messages 不能为空')
  }
  if (request.messages.length > 1_000) {
    throw new ModelGatewayError('CONTENT', false, '模型请求 messages 超过限制')
  }
  if (request.tools && (!Array.isArray(request.tools) || request.tools.length > 64)) {
    throw new ModelGatewayError('CONTENT', false, '模型请求 tools 非法或超过限制')
  }
  if (
    request.responseSchema &&
    (Array.isArray(request.responseSchema) ||
      typeof request.responseSchema !== 'object' ||
      request.responseSchema.type !== 'object')
  ) {
    throw new ModelGatewayError('INVALID_OUTPUT', false, 'responseSchema 根节点必须是 object schema')
  }
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
    throw new ModelGatewayError('CONTENT', false, 'maxOutputTokens 必须为正整数')
  }
  if (
    request.temperature != null &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
  ) {
    throw new ModelGatewayError('CONTENT', false, 'temperature 必须在 0-2')
  }
  const deadlineAt = Date.parse(request.deadlineAt)
  if (Number.isNaN(deadlineAt) || deadlineAt <= Date.now()) {
    throw new ModelGatewayError('TIMEOUT', false, '模型请求 deadlineAt 已过期或无效')
  }
  const trace = request.trace as unknown
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    throw new ModelGatewayError('CONTENT', false, 'trace 字段不完整')
  }
  const traceRecord = trace as Record<string, unknown>
  const traceKeys = Object.keys(traceRecord).sort()
  if (traceKeys.join(',') !== 'modelCallId,runId,traceId') {
    throw new ModelGatewayError('CONTENT', false, 'trace 字段不完整或包含未知字段')
  }
  for (const [name, value] of Object.entries(traceRecord)) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      throw new ModelGatewayError('CONTENT', false, `trace.${name} 非法`)
    }
  }
  for (const message of request.messages) {
    if (!message || typeof message !== 'object' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
      throw new ModelGatewayError('CONTENT', false, 'message role 非法')
    }
    if (typeof message.content !== 'string' || message.content.length > 1_000_000) {
      throw new ModelGatewayError('CONTENT', false, 'message content 非法或超过限制')
    }
    if (message.role === 'tool' && !message.toolCallId) {
      throw new ModelGatewayError('CONTENT', false, 'Tool message 缺少 toolCallId')
    }
  }
  const toolNames = new Set<string>()
  for (const tool of request.tools ?? []) {
    if (!tool || typeof tool !== 'object') {
      throw new ModelGatewayError('CONTENT', false, 'Tool definition 非法')
    }
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(tool.name) || toolNames.has(tool.name)) {
      throw new ModelGatewayError('CONTENT', false, 'Tool 名称非法或重复')
    }
    if (
      !tool.parameters ||
      Array.isArray(tool.parameters) ||
      typeof tool.parameters !== 'object' ||
      tool.parameters.type !== 'object'
    ) {
      throw new ModelGatewayError('INVALID_OUTPUT', false, 'Tool parameters 根节点必须是 object schema')
    }
    toolNames.add(tool.name)
  }
  for (const [key, value] of Object.entries(request.metadata ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw new ModelGatewayError('CONTENT', false, 'metadata key 非法')
    }
    if (typeof value === 'string' && value.length > 256) {
      throw new ModelGatewayError('CONTENT', false, 'metadata string 超过限制')
    }
  }
}

function createAttemptSignal(parent: AbortSignal, deadlineAt: number, timeoutMs: number): AttemptSignal {
  const remainingMs = Math.min(timeoutMs, deadlineAt - Date.now())
  if (remainingMs <= 0) throw new ModelGatewayError('TIMEOUT', false, '模型调用 deadline 已到期')
  const controller = new AbortController()
  let timeoutReached = false
  const onParentAbort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    timeoutReached = true
    controller.abort(new DOMException('Model timeout', 'TimeoutError'))
  }, remainingMs)
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    cleanup: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    },
  }
}

function normalizeAttemptError(error: unknown, parent: AbortSignal, attempt: AttemptSignal): Error {
  if (parent.aborted) return new ModelAbortError()
  if (attempt.timedOut()) return new ModelGatewayError('TIMEOUT', true, '模型调用超时')
  if (error instanceof ModelAbortError || error instanceof ModelGatewayError) return error
  if (error instanceof Error && error.name === 'AbortError') return new ModelAbortError()
  if (error instanceof TypeError) return new ModelGatewayError('UNAVAILABLE', true, '模型供应商网络不可用')
  return new ModelGatewayError('UNAVAILABLE', false, '模型供应商调用失败')
}

async function delayBeforeRetry(
  error: ModelGatewayError,
  attempt: number,
  deadlineAt: number,
  signal: AbortSignal,
  retryBaseMs: number,
): Promise<void> {
  if (signal.aborted) throw new ModelAbortError()
  const exponentialMs = retryBaseMs * 2 ** (attempt - 1)
  const jitteredMs = Math.round(exponentialMs * (0.75 + Math.random() * 0.5))
  const delayMs = error.retryAfterMs ?? jitteredMs
  if (Date.now() + delayMs >= deadlineAt) throw new ModelGatewayError('TIMEOUT', false, '重试等待将超过 deadline')
  if (delayMs === 0) return

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ModelAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isVisibleOutput(chunk: ModelChunk): boolean {
  return chunk.type === 'OUTPUT_TEXT_DELTA' || chunk.type === 'TOOL_CALL_DELTA' || chunk.type === 'TOOL_CALL_COMPLETED'
}

function createRepairRequest(request: ModelRequest, invalidOutput: string): ModelRequest {
  return {
    ...request,
    messages: [
      ...request.messages,
      { role: 'assistant', content: invalidOutput },
      {
        role: 'user',
        content:
          'Return only one JSON value that strictly matches the supplied JSON Schema. Do not add markdown or commentary.',
      },
    ],
    metadata: { ...request.metadata, repairAttempt: 1 },
  }
}

function parseStructuredText(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}
