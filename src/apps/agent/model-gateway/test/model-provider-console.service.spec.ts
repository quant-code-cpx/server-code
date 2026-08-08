import { BadRequestException, ConflictException } from '@nestjs/common'
import { ModelProviderConsoleService } from '../model-provider-console.service'

const now = new Date('2026-08-06T00:00:00.000Z')

describe('ModelProviderConsoleService 管理台业务约束', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalSecret = process.env.ACCESS_TOKEN_SECRET

  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.ACCESS_TOKEN_SECRET = 'agent-model-console-test-secret-32-bytes'
  })

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalSecret === undefined) delete process.env.ACCESS_TOKEN_SECRET
    else process.env.ACCESS_TOKEN_SECRET = originalSecret
  })

  it('连接必须先保存草稿，探测通过后才允许启用，并使用 CAS 更新', async () => {
    let stored = connectionRow()
    const prisma = prismaMock()
    prisma.aiModelConnection.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      stored = connectionRow({ ...data, configVersion: 1 })
      return stored
    })
    prisma.aiModelConnection.findUnique.mockImplementation(async () => stored)
    prisma.aiModelConnection.findUniqueOrThrow.mockImplementation(async () => stored)
    prisma.aiModelConnection.updateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      stored = connectionRow({ ...stored, ...data, enabled: data.enabled ?? stored.enabled, configVersion: 2 })
      return { count: 1 }
    })
    const service = new ModelProviderConsoleService(prisma as never)

    expect(service.listAdapters().items.map((item) => item.kind)).toEqual([
      'openai-responses',
      'openai-chat-compatible',
      'anthropic-messages',
    ])
    await expect(
      service.createConnection({
        connectionKey: 'local-gateway',
        adapterKind: 'openai-chat-compatible',
        displayName: 'Local Gateway',
        baseUrl: 'http://127.0.0.1:18080/v1',
        apiKey: 'sk-test-secret',
        enabled: true,
      }),
    ).rejects.toThrow('新连接必须先保存草稿')

    const created = await service.createConnection({
      connectionKey: 'local-gateway',
      adapterKind: 'openai-chat-compatible',
      displayName: 'Local Gateway',
      baseUrl: 'http://127.0.0.1:18080/v1/',
      apiKey: 'sk-test-secret',
      enabled: false,
    })
    expect(created).toMatchObject({
      connectionKey: 'local-gateway',
      baseUrl: 'http://127.0.0.1:18080/v1',
      apiKeyConfigured: true,
      apiKeyLastFour: 'cret',
      enabled: false,
      version: 1,
    })
    expect(JSON.stringify(created)).not.toContain('sk-test-secret')

    await expect(service.updateConnection({ id: stored.id, version: 1, enabled: true })).rejects.toThrow(
      '连接测试通过后才能启用',
    )
    stored = connectionRow({ ...stored, lastProbeStatus: 'PASSED' })
    await expect(service.updateConnection({ id: stored.id, version: 1, enabled: true })).resolves.toMatchObject({
      enabled: true,
      version: 2,
    })
    expect(prisma.aiModelConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: stored.id, configVersion: 1 } }),
    )

    stored = connectionRow({ ...stored, enabled: true, lastProbeStatus: 'PASSED', configVersion: 2 })
    await service.updateConnection({
      id: stored.id,
      version: 2,
      baseUrl: 'http://127.0.0.1:18081/v1',
    })
    expect(prisma.aiModelConnection.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false, lastProbeStatus: null }),
      }),
    )
    expect(prisma.aiModelDeployment.updateMany).toHaveBeenCalledWith({
      where: { connectionId: stored.id },
      data: { enabled: false, lastProbeStatus: null, lastProbeAt: null, lastProbeDurationMs: null },
    })

    prisma.aiModelConnection.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.updateConnection({ id: stored.id, version: 1, displayName: 'stale' })).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('连接探测只保存公开步骤；401 失败不会回显密钥', async () => {
    const prisma = prismaMock()
    const stored = connectionRow({
      adapterKind: 'anthropic-messages',
      encryptedApiKey: encryptedSecretFromCreate(prisma),
      apiKeyLastFour: 'cret',
    })
    prisma.aiModelConnection.findUnique.mockResolvedValue(stored)
    const service = new ModelProviderConsoleService(prisma as never)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))

    await expect(service.testConnection({ id: stored.id, level: 'AUTH' })).resolves.toMatchObject({ status: 'PASSED' })
    await expect(service.testConnection({ id: stored.id, level: 'AUTH' })).resolves.toMatchObject({ status: 'FAILED' })

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: expect.objectContaining({ 'x-api-key': 'sk-test-secret' }),
    })
    const persisted = JSON.stringify(prisma.aiModelProbe.create.mock.calls)
    expect(persisted).toContain('鉴权失败，请检查 API key')
    expect(persisted).not.toContain('sk-test-secret')
    fetchSpy.mockRestore()
  })

  it('连接删除前返回部署影响；仍有部署时拒绝删除', async () => {
    const prisma = prismaMock()
    prisma.aiModelConnection.findUnique.mockResolvedValue(connectionRow())
    prisma.aiModelDeployment.findMany.mockResolvedValueOnce([
      { id: 'deployment-1', displayName: 'Model A', enabled: true },
    ])
    const service = new ModelProviderConsoleService(prisma as never)

    await expect(service.connectionDeleteImpact('connection-1')).resolves.toMatchObject({ canDelete: false })
    prisma.aiModelDeployment.findMany.mockResolvedValueOnce([
      { id: 'deployment-1', displayName: 'Model A', enabled: true },
    ])
    await expect(service.deleteConnection('connection-1')).rejects.toBeInstanceOf(BadRequestException)
    prisma.aiModelDeployment.findMany.mockResolvedValueOnce([])
    await expect(service.deleteConnection('connection-1')).resolves.toEqual({ id: 'connection-1', deleted: true })
    expect(prisma.aiModelConnection.delete).toHaveBeenCalledWith({ where: { id: 'connection-1' } })
  })

  it('模型部署能力由管理员声明，同时校验推理配置和数据分类，合法草稿可创建', async () => {
    const prisma = prismaMock()
    const connection = connectionRow({
      adapterKind: 'openai-chat-compatible',
      enabled: true,
      lastProbeStatus: 'PASSED',
    })
    prisma.aiModelConnection.findUnique.mockResolvedValue(connection)
    prisma.aiModelDeployment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      deploymentRow({ ...data, connection }),
    )
    const service = new ModelProviderConsoleService(prisma as never)
    const valid = deploymentDto()

    await expect(service.createDeployment({ ...valid, enabled: true })).rejects.toThrow('新部署必须先保存草稿')
    await expect(service.createDeployment({ ...valid, capabilities: [] })).rejects.toThrow('必须包含 STREAMING')
    await expect(
      service.createDeployment({
        ...valid,
        capabilities: ['STREAMING', 'PARALLEL_TOOL_CALLING'],
      }),
    ).resolves.toMatchObject({ capabilities: ['STREAMING', 'PARALLEL_TOOL_CALLING'] })
    await expect(service.createDeployment({ ...valid, capabilities: ['STREAMING', 'VISION'] })).resolves.toMatchObject({
      capabilities: ['STREAMING', 'VISION'],
    })
    await expect(service.createDeployment({ ...valid, reasoningMode: 'TOKEN_BUDGET' })).rejects.toThrow(
      '不支持 TOKEN_BUDGET',
    )
    await expect(
      service.createDeployment({ ...valid, reasoningMode: 'EFFORT', defaultReasoningEffort: undefined }),
    ).rejects.toThrow('必须设置默认推理档位')
    await expect(
      service.createDeployment({ ...valid, reasoningMode: 'EFFORT', defaultReasoningEffort: 'HIGH' }),
    ).rejects.toThrow('必须包含在支持档位中')
    await expect(service.createDeployment({ ...valid, reasoningEfforts: ['BAD SPACE'] })).rejects.toThrow('非法档位')
    await expect(service.createDeployment({ ...valid, dataClasses: [] })).rejects.toThrow('至少选择一个')

    await expect(service.createDeployment(valid)).resolves.toMatchObject({
      connectionKey: connection.connectionKey,
      modelId: 'test-model',
      enabled: false,
      version: 1,
    })
  })

  it('深度探测按部署的默认推理、输出上限、结构化输出与并行工具声明执行', async () => {
    const prisma = prismaMock()
    const connection = connectionRow({
      enabled: true,
      lastProbeStatus: 'PASSED',
      encryptedApiKey: encryptedSecretFromCreate(prisma),
      apiKeyLastFour: 'cret',
    })
    const deployment = deploymentRow({
      connection,
      maxOutputTokens: 54_000,
      timeoutMs: 120_000,
      capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'PARALLEL_TOOL_CALLING'],
      reasoningMode: 'EFFORT',
      reasoningEfforts: ['LOW', 'HIGH', 'XHIGH', 'MAX'],
      defaultReasoningEffort: 'XHIGH',
    })
    prisma.aiModelDeployment.findUnique.mockResolvedValue(deployment)
    const service = new ModelProviderConsoleService(prisma as never)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        sseResponse([
          {
            id: 'req-profile',
            choices: [{ index: 0, delta: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            id: 'req-tools',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call-alpha', function: { name: 'probe_alpha', arguments: '{}' } },
                    { index: 1, id: 'call-beta', function: { name: 'probe_beta', arguments: '{}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        ]),
      )

    const result = await service.probeDeployment({ id: deployment.id, confirmBillable: true })

    expect(result).toMatchObject({ status: 'PASSED', providerRequestId: 'req-tools' })
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'REASONING', status: 'PASSED' }),
        expect.objectContaining({ key: 'STRUCTURED_OUTPUT', status: 'PASSED' }),
        expect.objectContaining({ key: 'TOOLS', status: 'PASSED' }),
        expect.objectContaining({ key: 'STREAM', status: 'PASSED' }),
      ]),
    )
    const primaryBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as Record<string, unknown>
    const toolsBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)) as Record<string, unknown>
    expect(primaryBody).toMatchObject({
      model: deployment.modelId,
      max_tokens: 54_000,
      reasoning_effort: 'xhigh',
      response_format: { type: 'json_object' },
    })
    expect(toolsBody).toMatchObject({
      model: deployment.modelId,
      max_tokens: 54_000,
      reasoning_effort: 'xhigh',
      parallel_tool_calls: true,
    })
    expect(toolsBody.tools).toHaveLength(2)
    fetchSpy.mockRestore()
  })

  it('深度探测保存具体兼容阶段和安全错误，不把上游原文带入日志', async () => {
    const prisma = prismaMock()
    const connection = connectionRow({
      enabled: true,
      lastProbeStatus: 'PASSED',
      encryptedApiKey: encryptedSecretFromCreate(prisma),
      apiKeyLastFour: 'cret',
    })
    const deployment = deploymentRow({
      connection,
      capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
      reasoningMode: 'EFFORT',
      reasoningEfforts: ['XHIGH'],
      defaultReasoningEffort: 'XHIGH',
    })
    prisma.aiModelDeployment.findUnique.mockResolvedValue(deployment)
    const service = new ModelProviderConsoleService(prisma as never)
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('Unknown field: reasoning_effort PRIVATE_PROVIDER_CANARY', {
        status: 502,
        headers: { 'x-request-id': 'req-probe-502' },
      }),
    )

    const result = await service.probeDeployment({ id: deployment.id, confirmBillable: true })

    expect(result.status).toBe('FAILED')
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'REASONING',
          status: 'FAILED',
          message: expect.stringContaining('请改为“跟随模型”或调整推理档位'),
        }),
      ]),
    )
    const persisted = JSON.stringify(prisma.aiModelProbe.create.mock.calls)
    expect(persisted).toContain('HTTP 502')
    expect(persisted).toContain('req-probe-502')
    expect(persisted).not.toContain('PRIVATE_PROVIDER_CANARY')
    fetchSpy.mockRestore()
  })

  it('首次启用要求连接和自身探测通过，后续配置变更保留启用与探测状态', async () => {
    const prisma = prismaMock()
    let stored = deploymentRow({ enabled: false, lastProbeStatus: null })
    prisma.aiModelDeployment.findUnique.mockImplementation(async () => stored)
    prisma.aiModelDeployment.findUniqueOrThrow.mockImplementation(async () => stored)
    prisma.aiModelConnection.findUnique.mockResolvedValue(connectionRow({ enabled: true, lastProbeStatus: 'PASSED' }))
    prisma.aiModelDeployment.updateMany.mockResolvedValue({ count: 1 })
    const service = new ModelProviderConsoleService(prisma as never)

    await expect(service.updateDeployment({ id: stored.id, version: 1, enabled: true })).rejects.toThrow(
      '模型深度探测通过后才能启用',
    )
    stored = deploymentRow({ enabled: false, lastProbeStatus: 'PASSED' })
    await expect(service.updateDeployment({ id: stored.id, version: 1, enabled: true })).resolves.toMatchObject({
      deployment: { id: stored.id },
      previousEnabled: false,
      routingChanged: true,
    })
    stored = deploymentRow({ enabled: true, lastProbeStatus: 'PASSED' })
    await expect(service.updateDeployment({ id: stored.id, version: 1, enabled: false })).resolves.toMatchObject({
      previousEnabled: true,
      routingChanged: true,
    })
    await service.updateDeployment({ id: stored.id, version: 1, modelId: 'changed-model' })
    expect(prisma.aiModelDeployment.updateMany).toHaveBeenLastCalledWith({
      where: { id: stored.id, configVersion: stored.configVersion },
      data: { modelId: 'changed-model', configVersion: { increment: 1 } },
    })
    prisma.aiModelDeployment.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.updateDeployment({ id: stored.id, version: 1, priority: 2 })).rejects.toBeInstanceOf(
      ConflictException,
    )

    stored = deploymentRow({ enabled: true })
    await expect(service.deleteDeployment(stored.id)).rejects.toThrow('先停用模型部署')
    stored = deploymentRow({ enabled: false })
    prisma.aiModelConfigVersion.findFirst.mockResolvedValueOnce({ id: 'modelcfg-active' })
    await expect(service.deleteDeployment(stored.id)).rejects.toThrow('仍被活动版本 modelcfg-active 引用')
    prisma.aiModelConfigVersion.findFirst.mockResolvedValueOnce(null)
    await expect(service.deleteDeployment(stored.id)).resolves.toEqual({ id: stored.id, deleted: true })
  })

  it('发布活动路由快照并汇总连接、部署和探测状态', async () => {
    const prisma = prismaMock()
    const active = deploymentRow({ enabled: true })
    prisma.aiModelDeployment.findMany.mockResolvedValue([active])
    prisma.aiModelConnection.findMany.mockResolvedValue([
      { enabled: true, lastProbeStatus: 'PASSED' },
      { enabled: true, lastProbeStatus: 'FAILED' },
    ])
    prisma.aiModelConfigVersion.findFirst.mockResolvedValue({ id: 'modelcfg-old', deploymentIds: [active.id] })
    const service = new ModelProviderConsoleService(prisma as never)

    await expect(service.listDeployments({})).resolves.toMatchObject({
      items: [expect.objectContaining({ id: active.id, connectionKey: active.connection.connectionKey })],
    })
    await expect(service.createPublishedVersion()).resolves.toMatchObject({ deployments: [active.id] })
    expect(prisma.aiModelConfigVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'ACTIVE',
        deploymentIds: [active.id],
        snapshot: [expect.objectContaining({ deploymentId: active.id, modelId: active.modelId })],
      }),
    })
    await expect(service.consoleSummary()).resolves.toEqual({
      activeDeployments: 1,
      verifiedConnections: 1,
      failedProbes: 1,
      configurationIssues: 1,
      activeVersion: 'modelcfg-old',
    })
  })

  it('发布时原子迁移同一部署改名后的手动模型引用', async () => {
    const prisma = prismaMock()
    const renamed = deploymentRow({ id: 'deployment-1', modelId: 'new-model', enabled: true })
    prisma.aiModelDeployment.findMany.mockResolvedValue([renamed])
    prisma.aiModelConfigVersion.findFirst.mockResolvedValue({
      id: 'modelcfg-old',
      snapshot: [{ deploymentId: renamed.id, modelId: 'old-model' }],
    })
    prisma.aiConversation.findMany.mockResolvedValue([{ preferredModel: 'old-model' }])
    prisma.aiScheduledTask.findMany.mockResolvedValue([{ preferredModel: 'old-model' }])
    const service = new ModelProviderConsoleService(prisma as never)

    await expect(service.createPublishedVersion()).resolves.toMatchObject({ deployments: [renamed.id] })

    expect(prisma.aiConversation.updateMany).toHaveBeenCalledWith({
      where: { modelPolicy: 'MANUAL', preferredModel: 'old-model', status: { not: 'DELETED' } },
      data: { preferredModel: 'new-model' },
    })
    expect(prisma.aiScheduledTask.updateMany).toHaveBeenCalledWith({
      where: { modelPolicy: 'MANUAL', preferredModel: 'old-model', status: { not: 'DELETED' } },
      data: { preferredModel: 'new-model' },
    })
  })

  it('拒绝发布会让现有手动会话或定时任务失效的活动版本', async () => {
    const prisma = prismaMock()
    prisma.aiModelDeployment.findMany.mockResolvedValue([deploymentRow({ modelId: 'next-model', enabled: true })])
    prisma.aiConversation.findMany.mockResolvedValue([{ preferredModel: 'referenced-model' }])
    const service = new ModelProviderConsoleService(prisma as never)

    await expect(service.createPublishedVersion()).rejects.toThrow(
      '活动版本缺少仍被会话或定时任务引用的模型：referenced-model',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

function prismaMock() {
  const resolved = () => jest.fn().mockResolvedValue(undefined)
  return {
    aiModelConnection: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(connectionRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(connectionRow()),
      create: jest.fn(),
      update: resolved(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: resolved(),
    },
    aiModelDeployment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(deploymentRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(deploymentRow()),
      create: jest.fn(),
      update: resolved(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: resolved(),
    },
    aiModelProbe: { create: resolved() },
    aiModelConfigVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: resolved(),
      create: resolved(),
    },
    aiConversation: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aiScheduledTask: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
  }
}

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    connectionKey: 'local-gateway',
    adapterKind: 'openai-chat-compatible',
    displayName: 'Local Gateway',
    baseUrl: 'http://127.0.0.1:18080/v1',
    encryptedApiKey: null,
    apiKeyLastFour: null,
    enabled: false,
    configVersion: 1,
    lastProbeStatus: null,
    lastProbeAt: null,
    lastProbeDurationMs: null,
    lastProbeSteps: null,
    createdAt: now,
    updatedAt: now,
    _count: { deployments: 0 },
    ...overrides,
  }
}

function deploymentRow(overrides: Record<string, unknown> = {}) {
  const connection =
    (overrides.connection as ReturnType<typeof connectionRow>) ??
    connectionRow({ enabled: true, lastProbeStatus: 'PASSED' })
  return {
    id: 'deployment-1',
    connectionId: connection.id,
    modelId: 'test-model',
    displayName: 'Test Model',
    priority: 1,
    costTier: 'MEDIUM',
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
    reasoningMode: 'AUTO',
    reasoningEfforts: ['LOW'],
    defaultReasoningEffort: null,
    reasoningBudgetTokens: null,
    dataClasses: ['PUBLIC'],
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 0,
    enabled: false,
    configVersion: 1,
    lastProbeStatus: 'PASSED',
    lastProbeAt: now,
    lastProbeDurationMs: 10,
    createdAt: now,
    updatedAt: now,
    connection,
    ...overrides,
  }
}

function deploymentDto() {
  return {
    connectionId: 'connection-1',
    modelId: 'test-model',
    displayName: 'Test Model',
    priority: 1,
    costTier: 'MEDIUM' as const,
    contextWindow: 8_192,
    maxOutputTokens: 2_048,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
    reasoningMode: 'AUTO' as const,
    reasoningEfforts: ['LOW'],
    dataClasses: ['PUBLIC'],
    timeoutMs: 10_000,
    maxRetries: 1,
    retryBaseMs: 0,
    enabled: false,
  }
}

function encryptedSecretFromCreate(prisma: ReturnType<typeof prismaMock>): string {
  let encrypted = ''
  prisma.aiModelConnection.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    encrypted = String(data.encryptedApiKey)
    return connectionRow(data)
  })
  const service = new ModelProviderConsoleService(prisma as never)
  void service.createConnection({
    connectionKey: 'seed',
    adapterKind: 'anthropic-messages',
    displayName: 'Seed',
    baseUrl: 'http://127.0.0.1:18080/v1',
    apiKey: 'sk-test-secret',
    enabled: false,
  })
  return encrypted
}

function sseResponse(events: object[]): Response {
  const body = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
