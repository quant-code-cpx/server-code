import { buildModelConfig, type IModelConfig } from 'src/config/model.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ModelCapabilityRegistry } from '../model-capability.registry'
import {
  ModelGatewayError,
  type ModelChunk,
  type ModelDescriptor,
  type ModelGatewayObserver,
  type ModelProvider,
  type ModelRequest,
  type ProviderModelRequest,
} from '../model-gateway.port'
import { ModelGatewayService } from '../model-gateway.service'
import { ModelRouterService } from '../model-router.service'
import { ProviderHealthService } from '../provider-health.service'

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService
const observer = { record: jest.fn() } as unknown as ModelGatewayObserver

describe('ModelRouterService', () => {
  it('AUTO 按配置优先级选择首个合格模型，route decision 不含密钥', () => {
    const { router } = createRouting()

    const decision = router.select(request())

    expect(decision.selected).toMatchObject({ provider: 'primary', model: 'primary-v1' })
    expect(decision.candidates.map((candidate) => candidate.descriptor.model)).toEqual(['primary-v1', 'secondary-v1'])
    expect(JSON.stringify(decision)).not.toContain('secret-provider-key')
  })

  it('MANUAL 只允许明确选择的合格模型', () => {
    const { router } = createRouting()

    const decision = router.select(request({ modelPolicy: 'MANUAL', preferredModel: 'secondary-v1' }))

    expect(decision.candidates).toHaveLength(1)
    expect(decision.selected).toMatchObject({ provider: 'secondary', model: 'secondary-v1' })
    expect(decision.considered).toContainEqual(
      expect.objectContaining({ model: 'primary-v1', reasonCodes: expect.arrayContaining(['MANUAL_MODEL_MISMATCH']) }),
    )
  })

  it('数据等级、capability 与最大输出限制不会被候选模型绕过', () => {
    const { router } = createRouting()

    expect(() => router.select(request({ dataClass: 'PORTFOLIO_SENSITIVE' }))).toThrow('没有满足策略的可用模型')
    expect(() => router.select(request({ maxOutputTokens: 8_193 }))).toThrow('没有满足策略的可用模型')
    expect(() => router.select(request({ tools: [tool()] }))).toThrow('没有满足策略的可用模型')
  })

  it('三次 retry-safe 失败打开 circuit，过期后自动恢复', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-22T00:00:00.000Z'))
    const { health, descriptors } = createRouting({ AGENT_MODEL_CIRCUIT_OPEN_MS: '1000' })
    const error = new ModelGatewayError('UNAVAILABLE', true, 'provider unavailable')

    health.recordFailure(descriptors[0], error)
    health.recordFailure(descriptors[0], error)
    expect(health.isAvailable(descriptors[0])).toBe(true)
    health.recordFailure(descriptors[0], error)
    expect(health.snapshot(descriptors[0])).toMatchObject({ status: 'OPEN', retryAfterMs: 1000 })

    jest.advanceTimersByTime(1_001)
    expect(health.isAvailable(descriptors[0])).toBe(true)
    expect(health.snapshot(descriptors[0])).toMatchObject({ status: 'HEALTHY', retryAfterMs: null })
    jest.useRealTimers()
  })
})

describe('ModelGatewayService routing fallback', () => {
  beforeEach(() => jest.clearAllMocks())

  it('首 provider 无输出且可重试失败时切到后备 provider', async () => {
    const primary = new ScriptedProvider(descriptor('primary', 'primary-v1'), async function* () {
      throw new ModelGatewayError('UNAVAILABLE', true, 'primary unavailable')
    })
    const secondary = new ScriptedProvider(descriptor('secondary', 'secondary-v1'), async function* () {
      yield { type: 'OUTPUT_TEXT_DELTA', text: 'fallback answer' }
      yield { type: 'COMPLETED', finishReason: 'stop' }
    })
    const gateway = createGateway([primary, secondary])

    const chunks = await collect(gateway.stream(request()))

    expect(primary.calls).toBe(1)
    expect(secondary.calls).toBe(1)
    expect(chunks).toContainEqual({ type: 'OUTPUT_TEXT_DELTA', text: 'fallback answer' })
  })

  it('首 provider 已输出后异常，不拼接后备半流', async () => {
    const primary = new ScriptedProvider(descriptor('primary', 'primary-v1'), async function* () {
      yield { type: 'OUTPUT_TEXT_DELTA', text: 'partial' }
      throw new ModelGatewayError('UNAVAILABLE', true, 'stream interrupted')
    })
    const secondary = new ScriptedProvider(descriptor('secondary', 'secondary-v1'), async function* () {
      yield { type: 'OUTPUT_TEXT_DELTA', text: 'must not emit' }
      yield { type: 'COMPLETED', finishReason: 'stop' }
    })
    const gateway = createGateway([primary, secondary])

    await expect(collect(gateway.stream(request()))).rejects.toMatchObject({
      category: 'UNAVAILABLE',
      visibleOutput: true,
    })
    expect(primary.calls).toBe(1)
    expect(secondary.calls).toBe(0)
  })
})

class ScriptedProvider implements ModelProvider {
  calls = 0

  constructor(
    readonly descriptor: ModelDescriptor,
    private readonly script: (request: ProviderModelRequest, signal: AbortSignal) => AsyncIterable<ModelChunk>,
  ) {}

  get provider(): string {
    return this.descriptor.provider
  }

  listModels(): readonly ModelDescriptor[] {
    return [this.descriptor]
  }

  supports(model: string, required: readonly string[]): boolean {
    return (
      model === this.descriptor.model &&
      required.every((capability) => this.descriptor.capabilities.includes(capability as never))
    )
  }

  async *stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk> {
    this.calls += 1
    yield* this.script(request, signal)
  }
}

function createRouting(overrides: Record<string, string> = {}) {
  const config = routingConfig(overrides)
  const descriptors = [descriptor('primary', 'primary-v1'), descriptor('secondary', 'secondary-v1')]
  const registry = new ModelCapabilityRegistry(descriptors.map((item) => new ScriptedProvider(item, emptyStream)))
  const health = new ProviderHealthService(config)
  return { router: new ModelRouterService(registry, health), health, descriptors }
}

function createGateway(providers: ModelProvider[]): ModelGatewayService {
  const config = routingConfig()
  const registry = new ModelCapabilityRegistry(providers)
  const health = new ProviderHealthService(config)
  return new ModelGatewayService(registry, new ModelRouterService(registry, health), health, config, logger, observer)
}

function routingConfig(overrides: Record<string, string> = {}): IModelConfig {
  return buildModelConfig(
    {
      AGENT_MODEL_PROVIDERS: JSON.stringify([
        {
          id: 'primary',
          kind: 'fake',
          displayName: 'Primary',
          model: 'primary-v1',
          priority: 0,
          costTier: 'LOW',
          capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
          contextWindow: 8192,
          maxOutputTokens: 8192,
          dataClasses: ['PUBLIC', 'USER_PRIVATE'],
        },
        {
          id: 'secondary',
          kind: 'fake',
          displayName: 'Secondary',
          model: 'secondary-v1',
          priority: 1,
          costTier: 'HIGH',
          capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
          contextWindow: 8192,
          maxOutputTokens: 8192,
          dataClasses: ['PUBLIC', 'USER_PRIVATE'],
        },
      ]),
      AGENT_MODEL_CIRCUIT_FAILURE_THRESHOLD: '3',
      AGENT_MODEL_CIRCUIT_OPEN_MS: '30000',
      ...overrides,
    },
    'test',
  )
}

function descriptor(provider: string, model: string): ModelDescriptor {
  return {
    provider,
    model,
    contextWindow: 8192,
    maxOutputTokens: 8192,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
    reasoningEfforts: [],
    dataClasses: ['PUBLIC', 'USER_PRIVATE'],
  }
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    modelPolicy: 'AUTO',
    preferredModel: null,
    purpose: 'SYNTHESIZE',
    messages: [{ role: 'user', content: 'analyze stock' }],
    maxOutputTokens: 256,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    dataClass: 'USER_PRIVATE',
    trace: { runId: 'run_route_1', modelCallId: 'call_route_1', traceId: 'trace_route_1' },
    ...overrides,
  }
}

function tool() {
  return { name: 'read_stock', description: 'read stock', parameters: { type: 'object' } }
}

async function* emptyStream(): AsyncIterable<ModelChunk> {}

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const chunks: ModelChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
