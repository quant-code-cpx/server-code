import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import {
  AiMessageRole,
  AiMessageStatus,
  AiVersionStatus,
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
  type AiMessage,
  type User,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { createTemporaryAgentDatabase, type TemporaryAgentDatabase } from 'test/agent/support/temporary-agent-database'
import { AgentMessageRepository } from '../../conversation/agent-message.repository'
import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import { LoadContextNode } from '../../workflow/nodes/load-context.node'
import type { FrozenWorkflowDefinition } from '../../workflow/workflow.types'
import { ConversationSummaryGeneratorService } from '../conversation-summary-generator.service'
import { CONVERSATION_SUMMARY_PROMPT_V1 } from '../conversation-summary.prompt'
import { ConversationSummaryRepository } from '../conversation-summary.repository'
import { ConversationSummaryService } from '../conversation-summary.service'
import { ContextBuilderService } from '../context-builder.service'
import { ContextTokenEstimator } from '../context-token-estimator'
import { UserMemoryRepository } from '../user-memory.repository'

const runIntegration = process.env.RUN_AGENT_SUMMARY_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

integrationDescribe('自动滚动摘要 - 真实 PostgreSQL 跨层集成', () => {
  const config = {
    maxTokens: 50_000,
    recentMessageCount: 20,
    maxPageContextBytes: 20_000,
    summaryEnabled: true,
    summaryMinMessageCount: 8,
    summaryTriggerTokens: 2_048,
    summaryMaxSourceTokens: 8_192,
    summaryMaxMessageCount: 500,
    summaryMaxOutputTokens: 1_024,
  }
  const limits = {
    maxSteps: 8,
    maxToolCalls: 10,
    maxParallelTools: 3,
    maxInputTokens: 50_000,
    maxCost: 10,
    costCurrency: 'CNY',
  }
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService
  const models = { generateStructured: jest.fn() }
  let database: TemporaryAgentDatabase | undefined
  let client: PrismaClient
  let user: User
  let promptId: string
  let summaries: ConversationSummaryRepository
  let messageRepository: AgentMessageRepository
  let generator: ConversationSummaryGeneratorService
  let builder: ContextBuilderService

  beforeAll(async () => {
    database = await createTemporaryAgentDatabase()
    client = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } })
    await client.$connect()
    user = await client.user.create({
      data: {
        account: `rolling_summary_${randomUUID()}`,
        password: 'integration-test-only',
        nickname: 'Rolling Summary Integration',
        role: UserRole.USER,
      },
    })
    const prompt = await client.aiPromptVersion.create({
      data: {
        ...CONVERSATION_SUMMARY_PROMPT_V1,
        inputSchema: CONVERSATION_SUMMARY_PROMPT_V1.inputSchema as Prisma.InputJsonValue,
        outputSchema: CONVERSATION_SUMMARY_PROMPT_V1.outputSchema as Prisma.InputJsonValue,
        status: AiVersionStatus.PUBLISHED,
        createdBy: user.id,
        publishedBy: user.id,
        publishedAt: new Date(),
      },
    })
    promptId = prompt.id
    const prisma = client as unknown as PrismaService
    messageRepository = new AgentMessageRepository(prisma, logger)
    summaries = new ConversationSummaryRepository(prisma, logger)
    const estimator = new ContextTokenEstimator()
    generator = new ConversationSummaryGeneratorService(
      messageRepository,
      summaries,
      new ConversationSummaryService(summaries),
      models as never,
      estimator,
      config as never,
    )
    builder = new ContextBuilderService(
      messageRepository,
      summaries,
      new UserMemoryRepository(prisma, logger),
      estimator,
      config as never,
    )
  }, 240_000)

  beforeEach(async () => {
    jest.clearAllMocks()
    await client.aiConversation.updateMany({ where: { userId: user.id }, data: { currentSummaryId: null } })
    await client.aiConversationSummary.deleteMany({ where: { conversation: { userId: user.id } } })
    await client.aiMessage.deleteMany({ where: { userId: user.id } })
    await client.aiConversation.deleteMany({ where: { userId: user.id } })
  })

  afterAll(async () => {
    await client?.$disconnect()
    await database?.dispose()
  }, 60_000)

  it('达到阈值后自动提交摘要，并在同一 load_context 中消费新摘要和保护窗口', async () => {
    const fixture = await createConversation(29)
    models.generateStructured.mockImplementation(async (command) => modelResult(command, fixture.messages[0].id))
    const node = new LoadContextNode(builder, generator)

    const result = await node.execute(executionContext(fixture))

    const current = await summaries.findCurrent(user.id, fixture.conversationId)
    expect(current).toMatchObject({
      version: 1,
      fromMessageId: fixture.messages[0].id,
      throughMessageId: fixture.messages[8].id,
      promptVersionId: promptId,
    })
    expect(result.context?.summary?.id).toBe(current!.id)
    expect(result.context?.recentMessages.map((message) => message.id)).toEqual(
      fixture.messages.slice(9).map((message) => message.id),
    )
    expect(result.context?.recentMessages.at(-1)?.id).toBe(fixture.trigger.id)
    expect(result.warnings).not.toContain('HISTORY_GAP')
    expect(models.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'SUMMARIZE', promptVersionId: promptId, attemptCount: 1 }),
    )
  })

  it('两个 Worker 同时处理同一快照时只创建一个摘要版本，另一个幂等跳过', async () => {
    const fixture = await createConversation(29)
    const gate = deferred<void>()
    models.generateStructured.mockImplementation(async (command) => {
      await gate.promise
      return modelResult(command, fixture.messages[0].id)
    })
    const command = {
      run: run(fixture),
      stepId: 'step_load_context',
      usage: baseUsage(),
      limits,
    }
    const first = generator.maybeCompact(command)
    const second = generator.maybeCompact(command)
    await waitFor(() => models.generateStructured.mock.calls.length === 2)
    gate.resolve()

    const results = await Promise.all([first, second])

    expect(results.map((result) => result.status).sort()).toEqual(['CREATED', 'SKIPPED'])
    expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversationId } })).toBe(1)
    expect((await summaries.findCurrent(user.id, fixture.conversationId))?.version).toBe(1)
  })

  it('PERF：10,001 条消息中有界选择 500 条候选，记录 p50/p95/p99', async () => {
    const fixture = await createBulkConversation(10_001)
    for (let index = 0; index < 5; index += 1) await selectSummaryCandidates(fixture)
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now()
      const page = await selectSummaryCandidates(fixture)
      samples.push(performance.now() - startedAt)
      expect(page.items).toHaveLength(500)
      expect(page.hasMore).toBe(true)
    }
    samples.sort((left, right) => left - right)
    const metrics = {
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      p99Ms: percentile(samples, 0.99),
    }
    process.stdout.write(`ROLLING_SUMMARY_PERF ${JSON.stringify(metrics)}\n`)
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true)
  })

  it('LOAD：20 个不同会话并发生成，错误率为 0 且版本互不污染', async () => {
    const fixtures = await Promise.all(Array.from({ length: 20 }, () => createConversation(29)))
    models.generateStructured.mockImplementation(async (command) =>
      modelResult(command, sourceIdFromModelCommand(command)),
    )
    const startedAt = performance.now()
    const results = await Promise.allSettled(
      fixtures.map((fixture) =>
        generator.maybeCompact({
          run: run(fixture),
          stepId: 'step_load_context',
          usage: baseUsage(),
          limits,
        }),
      ),
    )
    const durationMs = performance.now() - startedAt
    const rejected = results.filter((result) => result.status === 'rejected').length
    const created = results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 'CREATED',
    ).length
    process.stdout.write(
      `ROLLING_SUMMARY_LOAD ${JSON.stringify({ conversations: 20, durationMs, errorRate: rejected / 20 })}\n`,
    )
    expect({ rejected, created }).toEqual({ rejected: 0, created: 20 })
    expect(
      await client.aiConversationSummary.count({
        where: { conversationId: { in: fixtures.map((fixture) => fixture.conversationId) } },
      }),
    ).toBe(20)
  })

  it('STRESS：同会话 50 并发只落一个版本，所有请求可控结束', async () => {
    const fixture = await createConversation(29)
    models.generateStructured.mockImplementation(async (command) =>
      modelResult(command, sourceIdFromModelCommand(command)),
    )
    const command = {
      run: run(fixture),
      stepId: 'step_load_context',
      usage: baseUsage(),
      limits,
    }
    const startedAt = performance.now()
    const results = await Promise.all(Array.from({ length: 50 }, () => generator.maybeCompact(command)))
    const durationMs = performance.now() - startedAt
    const counts = results.reduce<Record<string, number>>((result, item) => {
      result[item.status] = (result[item.status] ?? 0) + 1
      return result
    }, {})
    process.stdout.write(
      `ROLLING_SUMMARY_STRESS ${JSON.stringify({ concurrency: 50, durationMs, errorRate: 0, counts })}\n`,
    )
    expect(counts).toEqual({ CREATED: 1, SKIPPED: 49 })
    expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversationId } })).toBe(1)
  })

  async function createConversation(messageCount: number) {
    const conversation = await client.aiConversation.create({
      data: { userId: user.id, title: `rolling ${randomUUID()}`, clientRequestId: randomUUID() },
    })
    const messages: AiMessage[] = []
    const startedAt = Date.parse('2026-07-21T08:00:00.000Z')
    for (let index = 0; index < messageCount; index += 1) {
      const createdAt = new Date(startedAt + index * 1_000)
      messages.push(
        await client.aiMessage.create({
          data: {
            userId: user.id,
            conversationId: conversation.id,
            role: index % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT,
            status: AiMessageStatus.COMPLETED,
            contentText: `${index === 0 ? '保留旧结论' : ''}${'中'.repeat(252)}`,
            contentBlocks: [],
            version: 1,
            createdAt,
            completedAt: createdAt,
          },
        }),
      )
    }
    return { conversationId: conversation.id, messages, trigger: messages.at(-1)! }
  }

  async function createBulkConversation(messageCount: number) {
    const conversation = await client.aiConversation.create({
      data: { userId: user.id, title: `bulk rolling ${randomUUID()}`, clientRequestId: randomUUID() },
    })
    const startedAt = Date.parse('2026-07-21T09:00:00.000Z')
    for (let offset = 0; offset < messageCount - 1; offset += 500) {
      const size = Math.min(500, messageCount - 1 - offset)
      await client.aiMessage.createMany({
        data: Array.from({ length: size }, (_, index) => {
          const sequence = offset + index
          const createdAt = new Date(startedAt + sequence)
          return {
            userId: user.id,
            conversationId: conversation.id,
            role: sequence % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT,
            status: AiMessageStatus.COMPLETED,
            contentText: `bulk message ${sequence}`,
            contentBlocks: [],
            version: 1,
            createdAt,
            completedAt: createdAt,
          }
        }),
      })
    }
    const triggerCreatedAt = new Date(startedAt + messageCount - 1)
    const trigger = await client.aiMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: 'bulk trigger',
        contentBlocks: [],
        version: 1,
        createdAt: triggerCreatedAt,
        completedAt: triggerCreatedAt,
      },
    })
    return { conversationId: conversation.id, trigger }
  }

  function selectSummaryCandidates(fixture: Awaited<ReturnType<typeof createBulkConversation>>) {
    return messageRepository.listCompletedSummaryCandidates(user.id, fixture.conversationId, {
      afterMessageId: null,
      throughMessageId: fixture.trigger.id,
      protectedRecentCount: 20,
      maxCandidates: 500,
    })
  }

  function run(fixture: Awaited<ReturnType<typeof createConversation>>): AgentExecutionRun {
    return {
      id: `run_${randomUUID()}`,
      userId: user.id,
      conversationId: fixture.conversationId,
      triggerMessageId: fixture.trigger.id,
      responseMessageId: 'response_not_persisted',
      promptVersionId: promptId,
      preferredModel: null,
      modelPolicy: 'AUTO',
      traceId: `trace_${randomUUID()}`,
      deadlineAt: new Date(Date.now() + 60_000),
      inputSnapshot: {},
      user: { role: UserRole.USER, status: UserStatus.ACTIVE },
      triggerMessage: { id: fixture.trigger.id, contentText: fixture.trigger.contentText },
      promptVersion: {
        id: promptId,
        promptKey: 'stock_research_system',
        version: 1,
        template: 'workflow prompt',
        contentHash: 'a'.repeat(64),
      },
      workflowVersion: { id: 'workflow_1' },
    } as unknown as AgentExecutionRun
  }

  function executionContext(fixture: Awaited<ReturnType<typeof createConversation>>) {
    return {
      run: run(fixture),
      workflow: {
        key: 'stock_research',
        version: 1,
        contentHash: 'b'.repeat(64),
      } as FrozenWorkflowDefinition,
      state: { warnings: [], budget: baseUsage() },
      limits,
      stepId: 'step_load_context',
      workerId: 'worker_1',
    } as never
  }
})

function modelResult(command: { usage: ReturnType<typeof baseUsage> }, sourceMessageId: string) {
  return {
    data: {
      summaryText: '保留旧结论',
      facts: [{ text: '保留旧结论', sourceMessageIds: [sourceMessageId] }],
      sourceMessageIds: [sourceMessageId],
    },
    usage: { ...command.usage, inputTokens: command.usage.inputTokens + 2_400, outputTokens: 80 },
    modelCallId: `model_${randomUUID()}`,
    modelName: 'fake-summary-v1',
    repaired: false,
  }
}

function sourceIdFromModelCommand(command: { messages: Array<{ content: string }> }): string {
  const sourceId = command.messages.at(-1)?.content.match(/"id":"([^"]+)"/)?.[1]
  if (!sourceId) throw new Error('摘要模型输入缺少 source message id')
  return sourceId
}

function percentile(samples: number[], ratio: number): number {
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)]
}

function baseUsage() {
  return { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待并发模型调用超时')
}

jest.setTimeout(300_000)
