import { buildModelConfig } from 'src/config/model.config'
import { ModelProviderConfigService } from '../model-provider-config.service'

describe('ModelProviderConfigService', () => {
  const modelConfig = buildModelConfig({ AGENT_MODEL_CONFIG_SOURCE: 'database' }, 'test')

  it('数据库为空时不写入占位供应商，只返回真实启用 provider', async () => {
    const prisma = {
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
      expect.objectContaining({ where: { enabled: true, kind: 'openai-compatible' } }),
    )
    expect(providers).toEqual([])
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
})
