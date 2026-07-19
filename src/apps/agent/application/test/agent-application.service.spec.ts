import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AiAgentRunStatus, AiConversationStatus, AiModelPolicy } from '@prisma/client'
import { buildAgentApiConfig } from 'src/config/agent-api.config'
import { AgentQueueService } from 'src/queue/agent/agent-queue.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AgentRestReadRepository } from '../../api/agent-rest-read.repository'
import { AgentConversationRepository } from '../../conversation/agent-conversation.repository'
import { AgentRunRepository } from '../../execution/agent-run.repository'
import { ModelCapabilityRegistry } from '../../model-gateway/model-capability.registry'
import { WorkflowRegistryService } from '../../workflow/workflow-registry.service'
import { AgentConversationService } from '../agent-conversation.service'
import { AgentInteractionRepository } from '../agent-interaction.repository'
import { AgentRunService } from '../agent-run.service'

const now = new Date('2026-07-20T01:00:00.000Z')

describe('AgentConversationService', () => {
  let service: AgentConversationService
  let repository: Record<string, jest.Mock>
  let models: Record<string, jest.Mock>

  beforeEach(async () => {
    repository = {
      createConversation: jest.fn().mockResolvedValue(conversation()),
      listByCursor: jest.fn().mockResolvedValue({ items: [conversation()], nextCursor: 'next' }),
      findById: jest.fn().mockResolvedValue(conversation()),
      updateModelPolicy: jest
        .fn()
        .mockResolvedValue(conversation({ modelPolicy: AiModelPolicy.MANUAL, preferredModel: 'model-v1' })),
    }
    models = { get: jest.fn().mockReturnValue({ model: 'model-v1' }) }
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentConversationService,
        { provide: AgentConversationRepository, useValue: repository },
        { provide: AgentRestReadRepository, useValue: { listMessages: jest.fn() } },
        { provide: ModelCapabilityRegistry, useValue: models },
      ],
    }).compile()
    service = moduleRef.get(AgentConversationService)
  })

  it('AUTO 禁止 preferredModel；MANUAL 强制已注册模型', async () => {
    await expect(
      service.create(1, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        title: '研究',
        modelPolicy: AiModelPolicy.AUTO,
        preferredModel: 'model-v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.create(1, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        title: '研究',
        modelPolicy: AiModelPolicy.MANUAL,
        preferredModel: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    models.get.mockImplementationOnce(() => {
      throw new Error('missing')
    })
    await expect(
      service.create(1, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        title: '研究',
        modelPolicy: AiModelPolicy.MANUAL,
        preferredModel: 'missing-model',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('create/list/detail/update 只返回 REST contract 字段', async () => {
    await expect(
      service.create(1, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        title: '研究',
        modelPolicy: AiModelPolicy.AUTO,
        preferredModel: null,
      }),
    ).resolves.toEqual({ conversationId: 'cm_1', status: 'ACTIVE', createdAt: now.toISOString() })
    await expect(service.list(1, { cursor: null, limit: 30, includeArchived: false })).resolves.toMatchObject({
      items: [{ conversationId: 'cm_1', title: '研究', messageCount: 0 }],
      nextCursor: 'next',
    })
    await expect(service.detail(1, { conversationId: 'cm_1' })).resolves.toMatchObject({
      conversationId: 'cm_1',
      statusVersion: 1,
    })
    await expect(
      service.updateModel(1, {
        conversationId: 'cm_1',
        modelPolicy: AiModelPolicy.MANUAL,
        preferredModel: 'model-v1',
      }),
    ).resolves.toMatchObject({ modelPolicy: 'MANUAL', preferredModel: 'model-v1' })
  })
})

describe('AgentRunService', () => {
  let service: AgentRunService
  let interactions: Record<string, jest.Mock>
  let queue: Record<string, jest.Mock>
  let runs: Record<string, jest.Mock>
  let reads: Record<string, jest.Mock>

  beforeEach(async () => {
    interactions = {
      send: jest.fn().mockResolvedValue(interaction()),
      regenerate: jest.fn().mockResolvedValue({ ...interaction(), sourceMessageId: 'msg_assistant_v1' }),
    }
    queue = { enqueueRun: jest.fn().mockResolvedValue({ state: 'enqueued' }), removeWaitingRun: jest.fn() }
    runs = {
      requestCancel: jest.fn().mockResolvedValue({ id: 'run_1', status: AiAgentRunStatus.CANCELLED, statusVersion: 2 }),
    }
    reads = {
      getRunStatus: jest.fn().mockResolvedValue({ runId: 'run_1' }),
      listToolCalls: jest.fn().mockResolvedValue([{ toolCallId: 'tool_1' }]),
    }
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AgentRunService,
        { provide: AgentInteractionRepository, useValue: interactions },
        { provide: AgentRestReadRepository, useValue: reads },
        { provide: AgentRunRepository, useValue: runs },
        { provide: AgentQueueService, useValue: queue },
        {
          provide: WorkflowRegistryService,
          useValue: {
            snapshot: jest.fn().mockReturnValue({
              workflowKey: 'stock_research',
              version: 1,
              contentHash: 'workflow-hash',
              prompt: { promptKey: 'stock_research_system', version: 1, contentHash: 'prompt-hash' },
            }),
          },
        },
        { provide: LoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(AgentRunService)
  })

  it('send 只收窄 capability，并在 Redis 失败时保留已提交结果', async () => {
    queue.enqueueRun.mockRejectedValueOnce(new Error('redis down'))
    const result = await service.send(7, {
      clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
      conversationId: 'cm_1',
      content: '分析 600519.SH',
      pageContext: { route: '/stock/detail' },
      modelPolicy: AiModelPolicy.AUTO,
      allowedCapabilities: ['WEB_SEARCH', 'INTERNAL_DATA'],
    })

    expect(result).toMatchObject({ runId: 'run_1', runStatus: 'QUEUED' })
    expect(interactions.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        allowedCapabilities: ['INTERNAL_DATA', 'WEB_SEARCH'],
        allowedScopes: ['PUBLIC_MARKET_DATA', 'PUBLIC_WEB', 'USER_PRIVATE'],
      }),
    )
  })

  it('非法 pageContext 时间范围在写库前拒绝', async () => {
    await expect(
      service.send(7, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        conversationId: 'cm_1',
        content: '分析',
        pageContext: { route: '/stock/detail', selectedRange: { start: '2026-07-20', end: '2026-07-19' } },
        modelPolicy: AiModelPolicy.AUTO,
        allowedCapabilities: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(interactions.send).not.toHaveBeenCalled()

    await expect(
      service.send(7, {
        clientRequestId: '8e598a53-84d5-45bd-b06a-d8d10d3fb125',
        conversationId: 'cm_1',
        content: '分析',
        pageContext: { route: '/stock/detail', entityId: '600519.SH' },
        modelPolicy: AiModelPolicy.AUTO,
        allowedCapabilities: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('终态幂等取消成功；waiting job 移除失败不回滚 DB 状态', async () => {
    queue.removeWaitingRun.mockRejectedValueOnce(new Error('redis unavailable'))
    await expect(service.cancel(7, { runId: 'run_1', expectedStatusVersion: 1 })).resolves.toEqual({
      runId: 'run_1',
      status: AiAgentRunStatus.CANCELLED,
      statusVersion: 2,
      cancellationAccepted: true,
    })
    expect(queue.removeWaitingRun).toHaveBeenCalledWith('run_1')
  })

  it('RUNNING 取消只写 CANCEL_REQUESTED，不尝试删除 active job', async () => {
    runs.requestCancel.mockResolvedValueOnce({
      id: 'run_1',
      status: AiAgentRunStatus.CANCEL_REQUESTED,
      statusVersion: 3,
    })
    await expect(service.cancel(7, { runId: 'run_1', expectedStatusVersion: 2 })).resolves.toMatchObject({
      status: AiAgentRunStatus.CANCEL_REQUESTED,
      cancellationAccepted: true,
    })
    expect(queue.removeWaitingRun).not.toHaveBeenCalled()
  })

  it('Tool 列表即使请求 includePayload 也只返回脱敏摘要标记', async () => {
    await expect(service.listToolCalls(7, { runId: 'run_1', includePayload: true })).resolves.toEqual({
      items: [{ toolCallId: 'tool_1' }],
      payloadIncluded: false,
    })
  })
})

describe('AgentApiConfig', () => {
  it('开发使用安全默认值；生产强制显式配置并校验范围', () => {
    expect(buildAgentApiConfig({}, 'development')).toEqual({ maxActiveRunsPerUser: 3, defaultDailyBudget: 20 })
    expect(() => buildAgentApiConfig({}, 'production')).toThrow('AGENT_MAX_ACTIVE_RUNS_PER_USER')
    expect(() =>
      buildAgentApiConfig({ AGENT_MAX_ACTIVE_RUNS_PER_USER: '0', AGENT_DEFAULT_DAILY_BUDGET: '20' }, 'production'),
    ).toThrow('AGENT_MAX_ACTIVE_RUNS_PER_USER')
    expect(
      buildAgentApiConfig({ AGENT_MAX_ACTIVE_RUNS_PER_USER: '5', AGENT_DEFAULT_DAILY_BUDGET: '100.5' }, 'production'),
    ).toEqual({ maxActiveRunsPerUser: 5, defaultDailyBudget: 100.5 })
  })
})

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cm_1',
    userId: 1,
    title: '研究',
    status: AiConversationStatus.ACTIVE,
    modelPolicy: AiModelPolicy.AUTO,
    preferredModel: null,
    clientRequestId: 'request-1',
    summaryVersion: 0,
    statusVersion: 1,
    messageCount: 0,
    lastMessageAt: now,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function interaction() {
  return {
    conversationId: 'cm_1',
    triggerMessageId: 'msg_user',
    responseMessageId: 'msg_assistant',
    sourceMessageId: null,
    run: { id: 'run_1', status: AiAgentRunStatus.QUEUED },
  }
}
