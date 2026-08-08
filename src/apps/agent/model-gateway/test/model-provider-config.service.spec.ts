import { buildModelConfig } from 'src/config/model.config'
import { ModelProviderConfigService } from '../model-provider-config.service'

describe('ModelProviderConfigService', () => {
  const modelConfig = buildModelConfig({ AGENT_MODEL_CONFIG_SOURCE: 'database' }, 'test')

  it('数据库为空时不写入占位供应商，只返回真实启用 provider', async () => {
    const prisma = {
      aiModelDeployment: {
        count: jest.fn().mockResolvedValue(0),
      },
      aiModelProvider: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    const providers = await service.loadActive()

    expect(prisma.aiModelProvider.createMany).not.toHaveBeenCalled()
    expect(prisma.aiModelProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enabled: true,
          kind: { in: expect.arrayContaining(['openai-compatible']) },
        },
      }),
    )
    expect(providers).toEqual([])
  })

  it('v2 草稿未发布时明确失败，不静默绕回 legacy 配置', async () => {
    const prisma = {
      aiModelDeployment: { count: jest.fn().mockResolvedValue(2) },
      aiModelConfigVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      aiModelProvider: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    await expect(service.loadActive()).rejects.toThrow('没有 ACTIVE 配置版本')
    expect(prisma.aiModelProvider.findMany).not.toHaveBeenCalled()
  })

  it('创建 openai-compatible provider 时加密 apiKey，管理响应不暴露明文', async () => {
    const createdAt = new Date('2026-07-25T00:00:00.000Z')
    const prisma = {
      aiModelProvider: {
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt,
          updatedAt: createdAt,
        })),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    const result = await service.create({
      providerId: 'local-openai',
      kind: 'openai-compatible',
      displayName: 'Local OpenAI',
      model: 'local-model',
      priority: 1,
      costTier: 'MEDIUM',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'test-api-key',
      contextWindow: 8192,
      maxOutputTokens: 2048,
      capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
      reasoningEfforts: ['LOW'],
      dataClasses: ['PUBLIC', 'USER_PRIVATE'],
      timeoutMs: 10000,
      maxRetries: 1,
      retryBaseMs: 100,
      enabled: true,
    })

    const persisted = prisma.aiModelProvider.create.mock.calls[0][0].data
    expect(persisted.id).toEqual(expect.any(String))
    expect(persisted.providerId).toBe('local-openai')
    expect(persisted.encryptedApiKey).toEqual(expect.any(String))
    expect(persisted.encryptedApiKey).not.toContain('test-api-key')
    expect(result).toMatchObject({ providerId: 'local-openai', apiKeyConfigured: true, apiKeyLastFour: '-key' })
    expect(JSON.stringify(result)).not.toContain('test-api-key')
  })

  it('不允许停用最后一个启用中的 provider，避免网关无可用模型', async () => {
    const prisma = {
      aiModelProvider: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'row-id',
          providerId: 'local-openai',
          kind: 'openai-compatible',
          enabled: true,
        }),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    await expect(service.update({ id: 'local-openai', enabled: false })).rejects.toThrow(
      '至少保留一个启用中的模型供应商',
    )
    expect(prisma.aiModelProvider.update).not.toHaveBeenCalled()
  })

  it('AGT2-BIZ-001: legacy 活动配置解密密钥并保持模型能力、成本和重试边界', async () => {
    const row = await encryptedProviderRow(modelConfig)
    const prisma = {
      aiModelDeployment: { count: jest.fn().mockResolvedValue(0) },
      aiModelProvider: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([row]),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    await expect(service.loadActive()).resolves.toEqual([
      expect.objectContaining({
        id: row.id,
        kind: 'openai-compatible',
        apiKey: 'test-api-key',
        descriptor: expect.objectContaining({
          contextWindow: 8_192,
          maxOutputTokens: 2_048,
          capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
        }),
      }),
    ])
  })

  it('AGT2-DATA-001: 已发布快照优先于 legacy，并完整恢复 TOKEN_BUDGET 推理策略', async () => {
    const encrypted = await encryptedProviderRow(modelConfig)
    const snapshot = snapshotFixture({
      encryptedApiKey: encrypted.encryptedApiKey,
      reasoningMode: 'TOKEN_BUDGET',
      reasoningBudgetTokens: 4_096,
      defaultReasoningEffort: 'HIGH',
    })
    const prisma = {
      aiModelDeployment: { count: jest.fn().mockResolvedValue(2) },
      aiModelConfigVersion: { findFirst: jest.fn().mockResolvedValue({ snapshot: [snapshot] }) },
      aiModelProvider: { count: jest.fn(), findMany: jest.fn() },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    const active = await service.loadActive()

    expect(active).toEqual([
      expect.objectContaining({
        id: 'deployment_1',
        defaultModel: 'gpt-test',
        priority: 1,
        costTier: 'MEDIUM',
        timeoutMs: 10_000,
        maxRetries: 1,
        retryBaseMs: 100,
        descriptor: expect.objectContaining({
          contextWindow: 32_768,
          maxOutputTokens: 4_096,
          capabilities: ['STREAMING'],
          reasoningEfforts: ['LOW', 'MEDIUM', 'HIGH'],
          defaultReasoning: { mode: 'TOKEN_BUDGET', budgetTokens: 4_096, effort: 'HIGH' },
          dataClasses: ['PUBLIC'],
        }),
      }),
    ])
    expect(prisma.aiModelProvider.findMany).not.toHaveBeenCalled()
  })

  it('AGT2-DATA-007: 草稿部署按 DISABLED/EFFORT/TOKEN_BUDGET/AUTO 生成一致请求快照', async () => {
    const encrypted = await encryptedProviderRow(modelConfig)
    const connection = {
      enabled: true,
      adapterKind: 'openai-compatible',
      connectionKey: 'connection_1',
      baseUrl: 'http://127.0.0.1:8080/v1',
      encryptedApiKey: encrypted.encryptedApiKey,
    }
    const rows = [
      deploymentFixture({ id: 'disabled', reasoningMode: 'DISABLED', connection }),
      deploymentFixture({
        id: 'effort',
        reasoningMode: 'EFFORT',
        defaultReasoningEffort: 'MEDIUM',
        connection,
      }),
      deploymentFixture({
        id: 'budget',
        reasoningMode: 'TOKEN_BUDGET',
        reasoningBudgetTokens: 2_048,
        defaultReasoningEffort: 'HIGH',
        connection,
      }),
      deploymentFixture({ id: 'auto', reasoningMode: 'AUTO', connection }),
    ]
    const prisma = { aiModelDeployment: { findMany: jest.fn().mockResolvedValue(rows) } }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    const draft = await service.loadDraft()

    expect(draft.map((item) => item.descriptor.defaultReasoning)).toEqual([
      { mode: 'DISABLED' },
      { mode: 'EFFORT', effort: 'MEDIUM' },
      { mode: 'TOKEN_BUDGET', budgetTokens: 2_048, effort: 'HIGH' },
      { mode: 'AUTO' },
    ])
  })

  it('AGT2-EDGE-001: 不支持的 adapter、缺失密钥和不可解密密钥全部 fail-closed', async () => {
    const unsupported = new ModelProviderConfigService(
      {
        aiModelDeployment: {
          findMany: jest
            .fn()
            .mockResolvedValue([deploymentFixture({ connection: { adapterKind: 'unknown', enabled: true } })]),
        },
      } as never,
      modelConfig,
    )
    await expect(unsupported.loadDraft()).rejects.toThrow('adapter unknown 不受支持')

    const missingKey = new ModelProviderConfigService(
      {
        aiModelDeployment: {
          findMany: jest.fn().mockResolvedValue([
            deploymentFixture({
              connection: {
                adapterKind: 'openai-compatible',
                enabled: true,
                connectionKey: 'missing-key',
                encryptedApiKey: null,
              },
            }),
          ]),
        },
      } as never,
      modelConfig,
    )
    await expect(missingKey.loadDraft()).rejects.toThrow('connection missing-key 缺少 apiKey')

    const badCipher = new ModelProviderConfigService(
      {
        aiModelDeployment: {
          findMany: jest.fn().mockResolvedValue([
            deploymentFixture({
              connection: {
                adapterKind: 'openai-compatible',
                enabled: true,
                connectionKey: 'bad-cipher',
                encryptedApiKey: '{"iv":"bad"}',
              },
            }),
          ]),
        },
      } as never,
      modelConfig,
    )
    await expect(badCipher.loadDraft()).rejects.toThrow('provider apiKey 无法解密')
  })

  it('AGT2-SEC-003: 环境 seed 仅落库支持的 Provider，密钥只保存密文和末四位', async () => {
    const environmentConfig = {
      ...modelConfig,
      source: 'environment',
      providers: [
        {
          id: 'seeded-provider',
          kind: 'openai-compatible',
          displayName: 'Seeded Provider',
          defaultModel: 'seed-model',
          priority: 5,
          costTier: 'LOW',
          baseUrl: 'http://127.0.0.1:8080/v1',
          apiKey: 'seed-secret',
          timeoutMs: 8_000,
          maxRetries: 1,
          retryBaseMs: 50,
          descriptor: {
            contextWindow: 16_384,
            maxOutputTokens: 4_096,
            capabilities: ['STREAMING'],
            reasoningEfforts: [],
            dataClasses: ['PUBLIC'],
          },
        },
      ],
    }
    const prisma = {
      aiModelProvider: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, environmentConfig as never)

    await service.listAdmin()

    const data = prisma.aiModelProvider.createMany.mock.calls[0][0].data[0]
    expect(data).toMatchObject({ providerId: 'seeded-provider', apiKeyLastFour: 'cret' })
    expect(data.encryptedApiKey).not.toContain('seed-secret')
  })

  it('AGT2-BIZ-004: 更新复用既有密钥；停用记录可删除，启用记录仅在仍有替代项时删除', async () => {
    const current = await encryptedProviderRow(modelConfig, { id: 'row-id' })
    const prisma = {
      aiModelProvider: {
        findUnique: jest.fn().mockResolvedValue(current),
        count: jest.fn().mockResolvedValue(2),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...current,
          ...data,
          updatedAt: new Date('2026-08-07T00:00:00.000Z'),
        })),
        delete: jest.fn().mockResolvedValue(current),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    const updated = await service.update({ id: 'row-id', displayName: 'Updated Provider' })
    expect(updated).toMatchObject({ id: 'row-id', displayName: 'Updated Provider', apiKeyConfigured: true })
    expect(prisma.aiModelProvider.update.mock.calls[0][0].data).not.toHaveProperty('encryptedApiKey')

    await expect(service.remove({ id: 'row-id' })).resolves.toEqual({ id: 'row-id', deleted: true })
    expect(prisma.aiModelProvider.delete).toHaveBeenCalledWith({ where: { id: 'row-id' } })

    prisma.aiModelProvider.findUnique.mockResolvedValueOnce({ ...current, enabled: false })
    await expect(service.remove({ id: 'row-id' })).resolves.toEqual({ id: 'row-id', deleted: true })
  })

  it.each([
    ['providerId', 'bad provider id'],
    ['kind', 'unsupported'],
    ['model', 'bad model id'],
    ['displayName', ''],
    ['priority', -1],
    ['costTier', 'EXTREME'],
    ['contextWindow', 0],
    ['maxOutputTokens', 0],
    ['timeoutMs', 99],
    ['maxRetries', 3],
    ['retryBaseMs', -1],
    ['capabilities', []],
    ['capabilities', ['STRUCTURED_OUTPUT']],
    ['reasoningEfforts', ['bad effort']],
    ['dataClasses', []],
    ['baseUrl', 'https://user:secret@example.com/v1'],
  ])('AGT2-EDGE-004: 非法 Provider 配置字段 %s 被拒绝', async (field, value) => {
    const prisma = { aiModelProvider: { create: jest.fn() } }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)
    const dto = { ...validProviderDto(), [field]: value }

    await expect(service.create(dto as never)).rejects.toThrow()
    expect(prisma.aiModelProvider.create).not.toHaveBeenCalled()
  })

  it('AGT2-REG-002: 已发布快照自身不满足 Provider 业务约束时拒绝路由', async () => {
    const encrypted = await encryptedProviderRow(modelConfig)
    const prisma = {
      aiModelDeployment: { count: jest.fn().mockResolvedValue(1) },
      aiModelConfigVersion: {
        findFirst: jest.fn().mockResolvedValue({
          snapshot: [snapshotFixture({ encryptedApiKey: encrypted.encryptedApiKey, costTier: 'EXTREME' })],
        }),
      },
    }
    const service = new ModelProviderConfigService(prisma as never, modelConfig)

    await expect(service.loadActive()).rejects.toThrow('costTier 不支持')
  })
})

function validProviderDto() {
  return {
    providerId: 'local-openai',
    kind: 'openai-compatible' as const,
    displayName: 'Local OpenAI',
    model: 'local-model',
    priority: 1,
    costTier: 'MEDIUM' as const,
    baseUrl: 'http://127.0.0.1:8080/v1',
    apiKey: 'test-api-key',
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
    reasoningEfforts: ['LOW'],
    dataClasses: ['PUBLIC', 'USER_PRIVATE'],
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 100,
    enabled: true,
  }
}

async function encryptedProviderRow(modelConfig: ReturnType<typeof buildModelConfig>, overrides = {}) {
  const createdAt = new Date('2026-08-07T00:00:00.000Z')
  const prisma = {
    aiModelProvider: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        createdAt,
        updatedAt: createdAt,
      })),
    },
  }
  const service = new ModelProviderConfigService(prisma as never, modelConfig)
  await service.create(validProviderDto())
  return { ...prisma.aiModelProvider.create.mock.calls[0][0].data, createdAt, updatedAt: createdAt, ...overrides }
}

function snapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    deploymentId: 'deployment_1',
    adapterKind: 'openai-compatible',
    displayName: 'Published Provider',
    modelId: 'gpt-test',
    priority: 1,
    costTier: 'MEDIUM',
    baseUrl: 'http://127.0.0.1:8080/v1',
    encryptedApiKey: null,
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 100,
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    capabilities: ['STREAMING'],
    reasoningEfforts: ['LOW', 'MEDIUM', 'HIGH'],
    reasoningMode: 'AUTO',
    defaultReasoningEffort: null,
    reasoningBudgetTokens: null,
    dataClasses: ['PUBLIC'],
    ...overrides,
  }
}

function deploymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deployment_1',
    enabled: true,
    displayName: 'Draft Provider',
    modelId: 'gpt-test',
    priority: 1,
    costTier: 'MEDIUM',
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 100,
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    capabilities: ['STREAMING'],
    reasoningEfforts: ['LOW', 'MEDIUM', 'HIGH'],
    reasoningMode: 'AUTO',
    defaultReasoningEffort: null,
    reasoningBudgetTokens: null,
    dataClasses: ['PUBLIC'],
    connection: {
      enabled: true,
      adapterKind: 'openai-compatible',
      connectionKey: 'connection_1',
      baseUrl: 'http://127.0.0.1:8080/v1',
      encryptedApiKey: null,
    },
    ...overrides,
  }
}
