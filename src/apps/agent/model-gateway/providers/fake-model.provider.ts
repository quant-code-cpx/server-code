import type { IModelConfig } from 'src/config/model.config'
import {
  ModelAbortError,
  type ModelCapability,
  type ModelChunk,
  type ModelDataClass,
  type ModelDescriptor,
  type ModelProvider,
  type ModelReasoningEffort,
  type ProviderModelRequest,
} from '../model-gateway.port'

export class FakeModelProvider implements ModelProvider {
  readonly provider = 'fake'
  private readonly descriptor: ModelDescriptor

  constructor(config: IModelConfig) {
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
    assertNotAborted(signal)
    const response = request.responseSchema
      ? JSON.stringify(fakeValueFromSchema(request.responseSchema))
      : `fake:${request.messages.at(-1)?.content ?? ''}`
    const splitAt = Math.max(1, Math.floor(response.length / 2))

    yield { type: 'OUTPUT_TEXT_DELTA', text: response.slice(0, splitAt) }
    await Promise.resolve()
    assertNotAborted(signal)
    if (splitAt < response.length) yield { type: 'OUTPUT_TEXT_DELTA', text: response.slice(splitAt) }
    yield {
      type: 'USAGE',
      usage: {
        inputTokens: Math.ceil(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4),
        outputTokens: Math.ceil(response.length / 4),
      },
    }
    yield { type: 'COMPLETED', finishReason: 'stop', providerRequestId: `fake-${request.trace.modelCallId}` }
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ModelAbortError()
}

function fakeValueFromSchema(schema: Record<string, unknown>): unknown {
  if ('const' in schema) return schema.const
  if ('default' in schema) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  const type = schema.type
  if (Array.isArray(type)) {
    if (type.includes('null')) return null
    return fakeValueFromSchema({ ...schema, type: type[0] })
  }
  if (type === 'object' || (type == null && schema.properties && typeof schema.properties === 'object')) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const required = new Set(
      Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [],
    )
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(properties).sort()) {
      if (required.has(key) || 'default' in properties[key] || 'const' in properties[key]) {
        result[key] = fakeValueFromSchema(properties[key])
      }
    }
    return result
  }
  if (type === 'array') return []
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  if (type === 'string' && schema.format === 'date') return '2000-01-01'
  if (type === 'string' && schema.format === 'date-time') return '2000-01-01T00:00:00.000Z'
  return 'fake'
}
