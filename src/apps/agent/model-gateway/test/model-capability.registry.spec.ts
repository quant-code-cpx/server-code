import { buildModelConfig } from 'src/config/model.config'
import type { ModelDescriptor, ModelRequest } from '../model-gateway.port'
import { ModelCapabilityRegistry, requiredCapabilities } from '../model-capability.registry'
import { FakeModelProvider } from '../providers/fake-model.provider'

describe('ModelCapabilityRegistry', () => {
  it('测试环境 fake provider 不被空数据库热加载清除', async () => {
    const config = buildModelConfig({ AGENT_MODEL_PROVIDER: 'fake' }, 'test')
    const configStore = { loadActive: jest.fn().mockResolvedValue([]) }
    const registry = new ModelCapabilityRegistry(
      new FakeModelProvider(config.providers[0]),
      config,
      configStore as never,
    )

    await registry.onModuleInit()

    expect(configStore.loadActive).not.toHaveBeenCalled()
    expect(registry.list()).toEqual([expect.objectContaining({ provider: 'fake', model: 'fake-deterministic-v1' })])
    registry.onModuleDestroy()
  })

  it('发布前验证失败时不替换当前 Registry', async () => {
    const config = buildModelConfig({ AGENT_MODEL_PROVIDER: 'fake' }, 'test')
    const brokenDraft = {
      ...config.providers[0],
      id: 'broken-responses',
      kind: 'openai-responses' as const,
      baseUrl: null,
      apiKey: null,
    }
    const configStore = { loadDraft: jest.fn().mockResolvedValue([brokenDraft]) }
    const registry = new ModelCapabilityRegistry(
      new FakeModelProvider(config.providers[0]),
      config,
      configStore as never,
    )

    await expect(registry.validateDraft()).rejects.toThrow('配置不完整')
    expect(registry.list()).toEqual([expect.objectContaining({ provider: 'fake' })])
  })

  it('数据库热加载成功后原子替换模型并保留部署运行时配置', async () => {
    const config = buildModelConfig({}, 'test')
    const active = providerConfig()
    const configStore = { loadActive: jest.fn().mockResolvedValue([active]) }
    const registry = new ModelCapabilityRegistry(provider(), config, configStore as never)

    await registry.reload()

    expect(registry.list()).toEqual([expect.objectContaining({ provider: active.id, model: active.defaultModel })])
    expect(registry.getProviderConfig(active.id)).toEqual(active)
    expect(registry.executionBudgetConfigs(active.defaultModel)).toEqual([
      {
        providerId: active.id,
        model: active.defaultModel,
        timeoutMs: active.timeoutMs,
        maxRetries: active.maxRetries,
        retryBaseMs: active.retryBaseMs,
      },
    ])
    expect(registry.get(active.defaultModel)).toMatchObject({ provider: active.id })
    expect(registry.getProvider(active.defaultModel).provider).toBe(active.id)
    registry.onModuleDestroy()
  })

  it('数据库模式初始化失败会阻止启动，环境模式则保留当前可用配置', async () => {
    const failure = new Error('database unavailable')
    const configStore = { loadActive: jest.fn().mockRejectedValue(failure) }
    const databaseRegistry = new ModelCapabilityRegistry(
      provider(),
      { source: 'database' } as never,
      configStore as never,
    )
    const envRegistry = new ModelCapabilityRegistry(provider(), { source: 'env' } as never, configStore as never)

    await expect(databaseRegistry.onModuleInit()).rejects.toThrow('database unavailable')
    await expect(envRegistry.onModuleInit()).resolves.toBeUndefined()
    expect(envRegistry.list()).toHaveLength(1)
    envRegistry.onModuleDestroy()
  })

  it('空发布草稿被拒绝，合法草稿只做构造验证而不提前替换活动 Registry', async () => {
    const current = provider()
    const emptyStore = { loadDraft: jest.fn().mockResolvedValue([]) }
    const emptyRegistry = new ModelCapabilityRegistry(current, { source: 'database' } as never, emptyStore as never)
    await expect(emptyRegistry.validateDraft()).rejects.toThrow('至少需要一个可发布的模型部署')

    const draftStore = { loadDraft: jest.fn().mockResolvedValue([providerConfig()]) }
    const registry = new ModelCapabilityRegistry(current, { source: 'database' } as never, draftStore as never)
    await expect(registry.validateDraft()).resolves.toBeUndefined()
    expect(registry.list()).toEqual([descriptor()])
  })

  it('能力、输出上限、推理档位和数据分类均在请求进入供应商前校验', () => {
    const modelProvider = provider()
    const registry = new ModelCapabilityRegistry(modelProvider)

    expect(requiredCapabilities(request())).toEqual(['STREAMING'])
    expect(
      requiredCapabilities(
        request({
          responseSchema: { type: 'object' },
          tools: [{ name: 'lookup', description: 'lookup', parameters: {} }],
          reasoning: { mode: 'EFFORT', effort: 'HIGH' },
        }),
      ),
    ).toEqual(['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'REASONING_EFFORT'])
    expect(requiredCapabilities(request({ reasoningEffort: 'LOW' }))).toContain('REASONING_EFFORT')

    expect(
      registry.assertRequestSupported('model-1', request({ reasoning: { mode: 'EFFORT', effort: ' high ' } })),
    ).toEqual(descriptor())
    expect(modelProvider.supports).toHaveBeenCalledWith('model-1', ['STREAMING', 'REASONING_EFFORT'])

    modelProvider.supports.mockReturnValueOnce(false)
    expect(() => registry.assertRequestSupported('model-1', request())).toThrow('不满足所需 capability')
    expect(() => registry.assertRequestSupported('model-1', request({ maxOutputTokens: 2_049 }))).toThrow(
      '超过模型配置上限',
    )
    expect(() =>
      registry.assertRequestSupported('model-1', request({ reasoning: { mode: 'EFFORT', effort: 'MAX' } })),
    ).toThrow('不支持指定 reasoning effort')
    expect(() => registry.assertRequestSupported('model-1', request({ dataClass: 'USER_PRIVATE' }))).toThrow(
      '不允许处理当前数据分类',
    )
  })

  it('同名模型按 descriptor.provider 精确选择，并对未知模型保持明确错误', () => {
    const first = provider('provider-1')
    const second = provider('provider-2')
    const registry = new ModelCapabilityRegistry([first, second])

    expect(registry.getProviderForDescriptor({ ...descriptor(), provider: 'provider-2' })).toBe(second)
    expect(() => registry.get('unknown')).toThrow('未在 capability registry 注册')
    expect(() => registry.getProvider('unknown')).toThrow('未在 capability registry 注册')
    expect(() => registry.getProviderForDescriptor({ ...descriptor(), provider: 'unknown' })).toThrow(
      '未在 capability registry 注册',
    )
  })

  it('[REG] Run 创建时冻结 Manual/AUTO 候选、模型能力与默认推理策略', () => {
    const first = provider('provider-1')
    const second = provider('provider-2')
    first.listModels.mockReturnValue([{ ...descriptor('provider-1'), dataClasses: ['PUBLIC', 'USER_PRIVATE'] }])
    second.listModels.mockReturnValue([{ ...descriptor('provider-2'), dataClasses: ['PUBLIC', 'USER_PRIVATE'] }])
    const registry = new ModelCapabilityRegistry([first, second])

    const manual = registry.snapshotRunProfile('MANUAL', 'model-1')
    const auto = registry.snapshotRunProfile('AUTO', null)
    const original = first.listModels()[0]

    expect(manual).toMatchObject({ schemaVersion: 1, source: 'RUN_CREATION', selectedProvider: 'provider-1' })
    expect(manual.candidates.map((candidate) => candidate.provider)).toEqual(['provider-1', 'provider-2'])
    expect(auto.candidates.map((candidate) => candidate.provider)).toEqual(['provider-1', 'provider-2'])
    expect(manual.candidates[0]).not.toBe(original)
    expect(manual.candidates[0].capabilities).not.toBe(original.capabilities)
    expect(() => registry.snapshotRunProfile('MANUAL', null)).toThrow('必须指定 preferredModel')
    expect(() => registry.snapshotRunProfile('MANUAL', 'unknown')).toThrow('没有可冻结')
  })

  it('[REG] Run 快照只纳入满足工作流协议与数据等级的真实 fallback 候选', () => {
    const eligible = provider('eligible')
    eligible.listModels.mockReturnValue([{ ...descriptor('eligible'), dataClasses: ['USER_PRIVATE'] }])
    const noStructured = provider('no-structured')
    noStructured.listModels.mockReturnValue([
      { ...descriptor('no-structured'), capabilities: ['STREAMING'], dataClasses: ['USER_PRIVATE'] },
    ])
    const publicOnly = provider('public-only')
    publicOnly.listModels.mockReturnValue([{ ...descriptor('public-only'), dataClasses: ['PUBLIC'] }])
    const registry = new ModelCapabilityRegistry([eligible, noStructured, publicOnly])

    expect(registry.snapshotRunProfile('AUTO', null).candidates.map((candidate) => candidate.provider)).toEqual([
      'eligible',
    ])
    expect(() =>
      registry.snapshotRunProfile('MANUAL', 'model-1', {
        capabilities: ['VISION'],
        dataClass: 'USER_PRIVATE',
      }),
    ).toThrow('没有可冻结')
  })
})

function descriptor(providerId = 'provider-1'): ModelDescriptor {
  return {
    provider: providerId,
    model: 'model-1',
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'REASONING_EFFORT'],
    reasoningEfforts: ['LOW', 'HIGH'],
    dataClasses: ['PUBLIC'],
  }
}

function provider(providerId = 'provider-1') {
  const modelDescriptor = descriptor(providerId)
  return {
    provider: providerId,
    listModels: jest.fn().mockReturnValue([modelDescriptor]),
    supports: jest.fn().mockReturnValue(true),
    stream: jest.fn(),
  }
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    purpose: 'VERIFY',
    messages: [{ role: 'user', content: 'test' }],
    maxOutputTokens: 128,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    trace: { runId: 'run-1', modelCallId: 'call-1', traceId: 'trace-1' },
    ...overrides,
  }
}

function providerConfig() {
  return {
    id: 'responses-deployment',
    kind: 'openai-responses' as const,
    displayName: 'Responses',
    defaultModel: 'gpt-test',
    priority: 1,
    costTier: 'MEDIUM' as const,
    baseUrl: 'https://provider.example/v1',
    apiKey: 'test-key',
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 100,
    descriptor: {
      contextWindow: 8_192,
      maxOutputTokens: 2_048,
      capabilities: ['STREAMING' as const],
      reasoningEfforts: ['LOW'],
      dataClasses: ['PUBLIC' as const],
    },
  }
}
