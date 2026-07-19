import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AiAgentStepKind,
  AiAgentRunStatus,
  AiAuditPayloadMode,
  AiConversationStatus,
  AiMessageStatus,
  AiModelPolicy,
  AiToolCallStatus,
  AiVersionStatus,
  AiJobOutboxStatus,
  Prisma,
  PrismaClient,
  type User,
} from '@prisma/client'
import { Queue, type ConnectionOptions } from 'bullmq'
import { buildAgentApiConfig } from 'src/config/agent-api.config'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { AgentQueueService } from 'src/queue/agent/agent-queue.service'
import { AGENT_EXECUTION_QUEUE } from 'src/queue/agent/agent.queue.constants'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentRestReadRepository } from '../../api/agent-rest-read.repository'
import { sha256 } from '../../audit/agent-audit-sanitizer'
import {
  AgentConversationArchivedError,
  AgentConversationNotFoundError,
} from '../../conversation/agent-conversation.errors'
import { AgentConversationRepository } from '../../conversation/agent-conversation.repository'
import { AgentRunIdempotencyConflictError, AgentRunNotFoundError } from '../../execution/agent-execution.errors'
import { AgentEventRepository } from '../../execution/agent-event.repository'
import { ModelCapabilityRegistry } from '../../model-gateway/model-capability.registry'
import { AgentInteractionRepository, type AgentWorkflowPin } from '../agent-interaction.repository'

const runIntegration = process.env.RUN_AGENT_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip
const redisIt = process.env.RUN_AGENT_QUEUE_INTEGRATION === 'true' ? it : it.skip

integrationDescribe('AgentInteractionRepository - 独立 PostgreSQL 集成测试', () => {
  let admin: PrismaClient | undefined
  let client: PrismaClient | undefined
  let repository: AgentInteractionRepository
  let reads: AgentRestReadRepository
  let userA: User
  let userB: User
  let databaseName = ''
  let workflowPin: AgentWorkflowPin

  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService
  const executionConfig = buildAgentExecutionConfig({
    AGENT_RUN_MAX_DURATION_MS: '180000',
    AGENT_MAX_COST_PER_RUN: '10',
  })
  const apiConfig = buildAgentApiConfig({
    AGENT_MAX_ACTIVE_RUNS_PER_USER: '10',
    AGENT_DEFAULT_DAILY_BUDGET: '20',
  })
  const models = {
    get: jest.fn().mockReturnValue({ model: 'fake-deterministic-v1' }),
  } as unknown as ModelCapabilityRegistry

  beforeAll(async () => {
    const urls = makeTemporaryDatabaseUrls()
    databaseName = urls.databaseName
    admin = new PrismaClient({ datasources: { db: { url: urls.adminUrl } } })
    await admin.$connect()
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    execFileSync('corepack', ['pnpm', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
      stdio: 'pipe',
      timeout: 180_000,
    })

    client = new PrismaClient({ datasources: { db: { url: urls.databaseUrl } } })
    await client.$connect()
    userA = await client.user.create({
      data: { account: `agent_api_a_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent API A' },
    })
    userB = await client.user.create({
      data: { account: `agent_api_b_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent API B' },
    })
    const publishedAt = new Date()
    const promptHash = sha256('agent-api-prompt-v1')
    const workflowHash = sha256('agent-api-workflow-v1')
    const prompt = await client.aiPromptVersion.create({
      data: {
        promptKey: 'stock_research_system',
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        template: 'Use supplied facts only.',
        contentHash: promptHash,
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    const workflow = await client.aiWorkflowVersion.create({
      data: {
        workflowKey: 'stock_research',
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        definition: { nodes: ['load_context', 'complete'] },
        contentHash: workflowHash,
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    workflowPin = {
      workflowKey: workflow.workflowKey,
      workflowVersion: workflow.version,
      workflowContentHash: workflow.contentHash,
      promptKey: prompt.promptKey,
      promptVersion: prompt.version,
      promptContentHash: prompt.contentHash,
    }

    const events = new AgentEventRepository(client as unknown as PrismaService, executionConfig, logger)
    repository = new AgentInteractionRepository(
      client as unknown as PrismaService,
      events,
      apiConfig,
      executionConfig,
      models,
      logger,
    )
    reads = new AgentRestReadRepository(client as unknown as PrismaService)
  }, 240_000)

  afterAll(async () => {
    await client?.$disconnect()
    if (admin && databaseName) {
      await admin.$queryRaw(
        Prisma.sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`,
      )
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
      await admin.$disconnect()
    }
  }, 60_000)

  it('send 并发幂等：单事务只创建一组消息、Run、Event 与 outbox', async () => {
    const conversation = await createConversation(userA)
    const command = sendCommand(userA.id, conversation.id)
    const [first, repeated] = await Promise.all([repository.send(command), repository.send(command)])

    expect(repeated.run.id).toBe(first.run.id)
    expect(first.run.status).toBe(AiAgentRunStatus.QUEUED)
    expect(await client!.aiMessage.count({ where: { conversationId: conversation.id } })).toBe(2)
    expect(
      await client!.aiAgentRun.count({ where: { userId: userA.id, clientRequestId: command.clientRequestId } }),
    ).toBe(1)
    expect(await client!.aiRunEvent.count({ where: { runId: first.run.id } })).toBe(1)
    expect(await client!.aiJobOutbox.count({ where: { aggregateId: first.run.id } })).toBe(1)
    await expect(repository.send({ ...command, content: '不同请求内容' })).rejects.toBeInstanceOf(
      AgentRunIdempotencyConflictError,
    )
  })

  it('事务后段失败时 user/assistant/Run/Event/outbox 全部回滚', async () => {
    const conversation = await createConversation(userA)
    const events = {
      appendInTransaction: jest.fn().mockRejectedValue(new Error('forced event failure')),
    } as unknown as AgentEventRepository
    const failingRepository = new AgentInteractionRepository(
      client as unknown as PrismaService,
      events,
      apiConfig,
      executionConfig,
      models,
      logger,
    )
    const outboxCountBefore = await client!.aiJobOutbox.count()
    await expect(failingRepository.send(sendCommand(userA.id, conversation.id))).rejects.toThrow('forced event failure')
    expect(await client!.aiMessage.count({ where: { conversationId: conversation.id } })).toBe(0)
    expect(await client!.aiAgentRun.count({ where: { conversationId: conversation.id } })).toBe(0)
    expect(await client!.aiJobOutbox.count()).toBe(outboxCountBefore)
  })

  it('归档和跨租户会话拒绝发送，不产生任何写入', async () => {
    const archived = await createConversation(userA, AiConversationStatus.ARCHIVED)
    await expect(repository.send(sendCommand(userA.id, archived.id))).rejects.toBeInstanceOf(
      AgentConversationArchivedError,
    )
    await expect(repository.send(sendCommand(userB.id, archived.id))).rejects.toBeInstanceOf(
      AgentConversationNotFoundError,
    )
    expect(await client!.aiMessage.count({ where: { conversationId: archived.id } })).toBe(0)
  })

  it('会话 model update 只允许 owner，跨租户统一 not found', async () => {
    const conversation = await createConversation(userA)
    const conversations = new AgentConversationRepository(client as unknown as PrismaService, logger)
    await expect(
      conversations.updateModelPolicy(userA.id, conversation.id, AiModelPolicy.MANUAL, 'fake-deterministic-v1'),
    ).resolves.toMatchObject({ modelPolicy: AiModelPolicy.MANUAL, preferredModel: 'fake-deterministic-v1' })
    await expect(
      conversations.updateModelPolicy(userB.id, conversation.id, AiModelPolicy.AUTO, null),
    ).rejects.toBeInstanceOf(AgentConversationNotFoundError)
  })

  it('regenerate 创建 assistant 新版本，旧版本保留，并发幂等', async () => {
    const conversation = await createConversation(userA)
    const sent = await repository.send(sendCommand(userA.id, conversation.id))
    await client!.aiMessage.update({
      where: { id: sent.responseMessageId },
      data: { status: AiMessageStatus.COMPLETED, contentText: '首个回答', completedAt: new Date() },
    })
    const command = regenerateCommand(userA.id, sent.responseMessageId)
    const [first, repeated] = await Promise.all([repository.regenerate(command), repository.regenerate(command)])

    expect(repeated.run.id).toBe(first.run.id)
    const versions = await client!.aiMessage.findMany({
      where: { parentMessageId: sent.triggerMessageId },
      orderBy: { version: 'asc' },
    })
    expect(versions.map((message) => message.version)).toEqual([1, 2])
    expect(versions[0]).toMatchObject({ id: sent.responseMessageId, contentText: '首个回答' })
    expect(versions[1]).toMatchObject({ id: first.responseMessageId, status: AiMessageStatus.PENDING })
  })

  it('活跃 Run 达到配置上限后拒绝新 Run，已存数据不变', async () => {
    const quotaUser = await client!.user.create({
      data: { account: `agent_quota_${Date.now()}`, password: 'integration-test-only', nickname: 'Quota' },
    })
    const firstConversation = await createConversation(quotaUser)
    const secondConversation = await createConversation(quotaUser)
    const quotaRepository = new AgentInteractionRepository(
      client as unknown as PrismaService,
      new AgentEventRepository(client as unknown as PrismaService, executionConfig, logger),
      buildAgentApiConfig({ AGENT_MAX_ACTIVE_RUNS_PER_USER: '1', AGENT_DEFAULT_DAILY_BUDGET: '20' }),
      executionConfig,
      models,
      logger,
    )
    await quotaRepository.send(sendCommand(quotaUser.id, firstConversation.id))
    await expect(quotaRepository.send(sendCommand(quotaUser.id, secondConversation.id))).rejects.toMatchObject({
      code: 'AI_COST_QUOTA_EXCEEDED',
    })
    expect(await client!.aiMessage.count({ where: { conversationId: secondConversation.id } })).toBe(0)
  })

  it('上海自然日成本达到上限后拒绝新 Run', async () => {
    const budgetUser = await client!.user.create({
      data: { account: `agent_budget_${Date.now()}`, password: 'integration-test-only', nickname: 'Budget' },
    })
    const firstConversation = await createConversation(budgetUser)
    const first = await repository.send(sendCommand(budgetUser.id, firstConversation.id))
    const prompt = await client!.aiPromptVersion.findFirstOrThrow({ where: { promptKey: workflowPin.promptKey } })
    await client!.aiModelCall.create({
      data: {
        userId: budgetUser.id,
        scopeId: 'daily-budget',
        runId: first.run.id,
        promptVersionId: prompt.id,
        provider: 'fake',
        model: 'fake-deterministic-v1',
        purpose: 'SYNTHESIS',
        status: 'SUCCEEDED',
        requestSummary: {},
        requestHash: sha256('daily-budget-request'),
        outputSummary: {},
        responseHash: sha256('daily-budget-response'),
        cost: new Prisma.Decimal(1),
        costCurrency: 'CNY',
        finishedAt: new Date(),
      },
    })
    const secondConversation = await createConversation(budgetUser)
    const budgetRepository = new AgentInteractionRepository(
      client as unknown as PrismaService,
      new AgentEventRepository(client as unknown as PrismaService, executionConfig, logger),
      buildAgentApiConfig({ AGENT_MAX_ACTIVE_RUNS_PER_USER: '10', AGENT_DEFAULT_DAILY_BUDGET: '1' }),
      executionConfig,
      models,
      logger,
    )
    await expect(budgetRepository.send(sendCommand(budgetUser.id, secondConversation.id))).rejects.toMatchObject({
      code: 'AI_COST_QUOTA_EXCEEDED',
    })
    expect(await client!.aiMessage.count({ where: { conversationId: secondConversation.id } })).toBe(0)
  })

  it('入队失败把真实 PostgreSQL outbox 标记 RETRY，Run 不丢失', async () => {
    const conversation = await createConversation(userA)
    const sent = await repository.send(sendCommand(userA.id, conversation.id))
    const queueService = new AgentQueueService(
      { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockRejectedValue(new Error('redis down')) } as never,
      client as unknown as PrismaService,
      buildAgentQueueConfig({ AGENT_JOB_ATTEMPTS: '3', AGENT_JOB_BACKOFF_MS: '100' }),
      logger,
    )
    await expect(queueService.enqueueRun(sent.run.id)).rejects.toThrow('redis down')
    await expect(
      client!.aiJobOutbox.findUniqueOrThrow({
        where: { kind_aggregateId: { kind: 'AGENT_RUN_EXECUTION', aggregateId: sent.run.id } },
      }),
    ).resolves.toMatchObject({ status: AiJobOutboxStatus.RETRY, lastError: 'redis down' })
    await expect(client!.aiAgentRun.findUnique({ where: { id: sent.run.id } })).resolves.toMatchObject({
      status: AiAgentRunStatus.QUEUED,
    })
  })

  it('Run/消息/Tool read 全部 user-scoped，Tool 响应不泄露 ref/hash', async () => {
    const conversation = await createConversation(userA)
    const sent = await repository.send(sendCommand(userA.id, conversation.id))
    const step = await client!.aiAgentStep.create({
      data: {
        runId: sent.run.id,
        stepKey: 'tool-step',
        kind: AiAgentStepKind.TOOL,
        ordinal: 1,
        inputSummary: {},
        inputHash: sha256('tool-step-input'),
      },
    })
    await client!.aiToolCall.create({
      data: {
        userId: userA.id,
        scopeId: 'scope-1',
        runId: sent.run.id,
        stepId: step.id,
        logicalNodeKey: 'tool-node',
        toolName: 'get_stock_overview',
        toolVersion: '1',
        status: AiToolCallStatus.SUCCEEDED,
        payloadMode: AiAuditPayloadMode.ENCRYPTED_REF,
        inputSummary: { tsCode: '600519.SH', apiKey: '[REDACTED]' },
        inputHash: sha256('secret-input'),
        inputRef: 'vault://secret-input',
        outputSummary: { name: '贵州茅台' },
        outputHash: sha256('secret-output'),
        outputRef: 'vault://secret-output',
        finishedAt: new Date(),
      },
    })

    const calls = await reads.listToolCalls(userA.id, sent.run.id)
    expect(calls).toEqual([
      expect.objectContaining({
        toolName: 'get_stock_overview',
        inputSummary: { tsCode: '600519.SH', apiKey: '[REDACTED]' },
        outputSummary: { name: '贵州茅台' },
      }),
    ])
    expect(JSON.stringify(calls)).not.toContain('vault://')
    expect(JSON.stringify(calls)).not.toContain(sha256('secret-input'))
    await expect(reads.listToolCalls(userB.id, sent.run.id)).rejects.toBeInstanceOf(AgentRunNotFoundError)
    await expect(reads.getRunStatus(userB.id, sent.run.id)).rejects.toBeInstanceOf(AgentRunNotFoundError)
    await expect(reads.listMessages(userB.id, conversation.id, null, 50)).rejects.toBeInstanceOf(
      AgentConversationNotFoundError,
    )
  })

  redisIt(
    '真实 PostgreSQL outbox 提交后可入真实 Redis，并可移除 waiting job',
    async () => {
      const connection = resolveRedisConnection()
      const prefix = `quant:agent-rest-it:${process.pid}:${Date.now()}`
      const queue = new Queue(AGENT_EXECUTION_QUEUE, { connection, prefix })
      await queue.waitUntilReady()
      await queue.obliterate({ force: true })
      try {
        const queueService = new AgentQueueService(
          queue as never,
          client as unknown as PrismaService,
          buildAgentQueueConfig({ AGENT_JOB_ATTEMPTS: '3', AGENT_JOB_BACKOFF_MS: '100' }),
          logger,
        )
        const conversation = await createConversation(userA)
        const sent = await repository.send(sendCommand(userA.id, conversation.id))
        await expect(
          client!.aiJobOutbox.findUniqueOrThrow({
            where: { kind_aggregateId: { kind: 'AGENT_RUN_EXECUTION', aggregateId: sent.run.id } },
          }),
        ).resolves.toMatchObject({ status: AiJobOutboxStatus.PENDING })

        await expect(queueService.enqueueRun(sent.run.id)).resolves.toMatchObject({ state: 'enqueued' })
        await expect(queue.getJob(sent.run.id)).resolves.toMatchObject({
          data: { runId: sent.run.id, schemaVersion: 1 },
        })
        await expect(
          client!.aiJobOutbox.findUniqueOrThrow({
            where: { kind_aggregateId: { kind: 'AGENT_RUN_EXECUTION', aggregateId: sent.run.id } },
          }),
        ).resolves.toMatchObject({ status: AiJobOutboxStatus.PUBLISHED })
        await expect(queueService.removeWaitingRun(sent.run.id)).resolves.toBe(true)
        await expect(queue.getJob(sent.run.id)).resolves.toBeUndefined()
      } finally {
        await queue.obliterate({ force: true })
        await queue.close()
      }
    },
    30_000,
  )

  async function createConversation(user: User, status: AiConversationStatus = AiConversationStatus.ACTIVE) {
    return client!.aiConversation.create({
      data: {
        userId: user.id,
        title: 'Agent API 集成测试',
        status,
        archivedAt: status === AiConversationStatus.ARCHIVED ? new Date() : null,
        clientRequestId: randomUUID(),
      },
    })
  }

  function sendCommand(userId: number, conversationId: string) {
    return {
      userId,
      clientRequestId: randomUUID(),
      conversationId,
      content: '分析 600519.SH',
      pageContext: { route: '/stock/detail', entityType: 'STOCK', entityId: '600519.SH' },
      modelPolicy: AiModelPolicy.AUTO,
      allowedCapabilities: ['INTERNAL_DATA'],
      allowedScopes: ['PUBLIC_MARKET_DATA'],
      traceId: `trace_${randomUUID()}`,
      workflow: workflowPin,
    }
  }

  function regenerateCommand(userId: number, sourceMessageId: string) {
    return {
      userId,
      clientRequestId: randomUUID(),
      sourceMessageId,
      modelPolicy: AiModelPolicy.AUTO,
      traceId: `trace_${randomUUID()}`,
      workflow: workflowPin,
    }
  }
})

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent REST DB 集成测试需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname) && process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent REST DB 集成测试默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_rest_it_${process.pid}_${Date.now()}`
  if (!/^quant_agent_rest_it_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

function resolveRedisConnection(): ConnectionOptions {
  const env = readLocalEnv()
  const redisUrl = process.env.AGENT_QUEUE_REDIS_URL || env.AGENT_QUEUE_REDIS_URL
  let host = process.env.REDIS_HOST || env.REDIS_HOST || '127.0.0.1'
  let port = Number(process.env.REDIS_PORT || env.REDIS_PORT || 6379)
  let username = process.env.REDIS_USERNAME || env.REDIS_USERNAME || undefined
  let password = process.env.REDIS_PASSWORD || env.REDIS_PASSWORD || undefined
  let db = 0
  let tls: Record<string, never> | undefined
  if (redisUrl) {
    const url = new URL(redisUrl)
    host = url.hostname
    port = url.port ? Number(url.port) : 6379
    username = url.username ? decodeURIComponent(url.username) : undefined
    password = url.password ? decodeURIComponent(url.password) : undefined
    db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0
    tls = url.protocol === 'rediss:' ? {} : undefined
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.AGENT_QUEUE_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent REST Redis 集成测试默认只允许本机 Redis')
  }
  return { host, port, username, password, db, tls, maxRetriesPerRequest: null }
}

function readLocalEnv(): Record<string, string> {
  const path = join(process.cwd(), '.env')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|([^#]*))/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], (match[2] ?? match[3]).trim()]),
  )
}
