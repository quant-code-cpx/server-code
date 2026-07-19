import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AiAgentRunStatus,
  AiAgentStepKind,
  AiAgentStepStatus,
  AiMessageRole,
  AiMessageStatus,
  AiModelPolicy,
  AiVersionStatus,
  Prisma,
  PrismaClient,
  type AiPromptVersion,
  type AiWorkflowVersion,
  type User,
} from '@prisma/client'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { sha256 } from '../../audit/agent-audit-sanitizer'
import { AgentEventRepository } from '../agent-event.repository'
import {
  AgentRunConflictError,
  AgentRunIdempotencyConflictError,
  AgentRunNotFoundError,
} from '../agent-execution.errors'
import type { CreateAgentRunCommand } from '../agent-execution.types'
import { AgentRunRepository } from '../agent-run.repository'
import { AgentStateMachineService } from '../agent-state-machine.service'

const runIntegration = process.env.RUN_AGENT_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent execution DB integration test 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname) && process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent execution DB integration test 默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_execution_it_${process.pid}_${Date.now()}`
  if (!/^quant_agent_execution_it_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

integrationDescribe('Agent Run/Step/Event Repository - 独立 PostgreSQL 集成测试', () => {
  let admin: PrismaClient | undefined
  let client: PrismaClient | undefined
  let events: AgentEventRepository
  let runs: AgentRunRepository
  let userA: User
  let userB: User
  let promptVersion: AiPromptVersion
  let workflowVersion: AiWorkflowVersion
  let databaseName = ''

  const config = buildAgentExecutionConfig({
    AGENT_RUN_LEASE_MS: '30000',
    AGENT_EVENT_REPLAY_LIMIT: '1000',
    AGENT_RUN_MAX_DURATION_MS: '180000',
  })
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService

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
      data: { account: `agent_run_a_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent Run A' },
    })
    userB = await client.user.create({
      data: { account: `agent_run_b_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent Run B' },
    })
    const publishedAt = new Date()
    promptVersion = await client.aiPromptVersion.create({
      data: {
        promptKey: `agent-run-prompt-${randomUUID()}`,
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        template: 'Use supplied facts only.',
        contentHash: sha256('agent-run-prompt-v1'),
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    workflowVersion = await client.aiWorkflowVersion.create({
      data: {
        workflowKey: `agent-run-workflow-${randomUUID()}`,
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        definition: { nodes: ['plan', 'finalize'] },
        contentHash: sha256('agent-run-workflow-v1'),
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    events = new AgentEventRepository(client as unknown as PrismaService, config, logger)
    runs = new AgentRunRepository(
      client as unknown as PrismaService,
      events,
      new AgentStateMachineService(),
      config,
      logger,
    )
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

  async function makeRunCommand(user = userA, overrides: Partial<CreateAgentRunCommand> = {}) {
    const conversation = await client!.aiConversation.create({
      data: { userId: user.id, title: 'Agent Run 集成测试', clientRequestId: randomUUID() },
    })
    const trigger = await client!.aiMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: '分析 600000.SH',
        contentBlocks: [],
        clientRequestId: randomUUID(),
        completedAt: new Date(),
      },
    })
    const response = await client!.aiMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.PENDING,
        contentBlocks: [],
        clientRequestId: randomUUID(),
      },
    })
    return {
      userId: user.id,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      responseMessageId: response.id,
      clientRequestId: randomUUID(),
      traceId: `trace_${randomUUID()}`,
      workflowVersionId: workflowVersion.id,
      promptVersionId: promptVersion.id,
      toolPolicyVersion: 'tool-policy-v1',
      modelPolicy: AiModelPolicy.AUTO,
      inputSnapshot: { questionRef: trigger.id },
      budget: { maxOutputTokens: 2048, maxToolCalls: 10 },
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() + 170_000),
      ...overrides,
    } satisfies CreateAgentRunCommand
  }

  it('createRun 并发幂等、不同 hash 冲突，并强制 owner scope', async () => {
    const command = await makeRunCommand()
    const [first, repeated] = await Promise.all([runs.createRun(command), runs.createRun(command)])

    expect(repeated.id).toBe(first.id)
    expect(first.status).toBe(AiAgentRunStatus.QUEUED)
    expect(first.statusVersion).toBe(1)
    expect(first.nextEventSequence).toBe(2n)
    expect(
      await client!.aiAgentRun.count({ where: { userId: userA.id, clientRequestId: command.clientRequestId } }),
    ).toBe(1)
    expect(await client!.aiRunEvent.count({ where: { runId: first.id } })).toBe(1)
    await expect(
      runs.createRun({
        ...command,
        budget: { maxToolCalls: 10, maxOutputTokens: 2048 },
      }),
    ).resolves.toMatchObject({ id: first.id })
    await expect(runs.createRun({ ...command, inputSnapshot: { questionRef: 'different' } })).rejects.toBeInstanceOf(
      AgentRunIdempotencyConflictError,
    )
    await expect(runs.findById(userB.id, first.id)).rejects.toBeInstanceOf(AgentRunNotFoundError)
    await expect(events.replay(userB.id, first.id)).rejects.toBeInstanceOf(AgentRunNotFoundError)
    await expect(
      runs.requestCancel({ userId: userB.id, runId: first.id, expectedVersion: first.statusVersion }),
    ).rejects.toBeInstanceOf(AgentRunNotFoundError)

    const userBCommand = await makeRunCommand(userB)
    await expect(
      runs.createRun({
        ...userBCommand,
        conversationId: command.conversationId,
        triggerMessageId: command.triggerMessageId,
        responseMessageId: command.responseMessageId,
      }),
    ).rejects.toThrow('AI Agent Run owner/message scope mismatch')
  })

  it('领取、Step、checkpoint、完成与 replay 构成可恢复闭环，终态后禁止迟到写入', async () => {
    const created = await runs.createRun(await makeRunCommand())
    const claimed = await runs.claimRun(created.id, 'worker-happy')
    expect(claimed).toMatchObject({ status: AiAgentRunStatus.RUNNING, statusVersion: 2, attempt: 1 })
    expect(claimed.leaseOwner).toBe('worker-happy')

    const heartbeat = await runs.heartbeat(created.id, 'worker-happy')
    expect(heartbeat.heartbeatAt!.getTime()).toBeGreaterThanOrEqual(claimed.heartbeatAt!.getTime())
    const step = await runs.createStep(created.id, 'worker-happy', {
      stepKey: 'plan',
      kind: AiAgentStepKind.PLAN,
      ordinal: 0,
      input: { factsRef: 'facts_1' },
    })
    const runningStep = await runs.transitionStep(created.id, step.id, {
      workerId: 'worker-happy',
      targetStatus: AiAgentStepStatus.RUNNING,
      event: {
        eventType: 'agent.progress',
        traceId: created.traceId,
        payload: { stepKey: 'plan', label: '规划', completed: 0, total: 1 },
      },
    })
    expect(runningStep.status).toBe(AiAgentStepStatus.RUNNING)

    const checkpoint = await runs.saveCheckpoint(created.id, {
      workerId: 'worker-happy',
      expectedCheckpointVersion: 0,
      checkpoint: {
        completedStepIds: [],
        nextStepKey: 'plan',
        authorization: 'Bearer private-token',
        hiddenReasoning: 'private reasoning',
      },
    })
    expect(checkpoint.checkpointVersion).toBe(1)
    expect(JSON.stringify(checkpoint.checkpoint)).not.toContain('private-token')
    expect(JSON.stringify(checkpoint.checkpoint)).not.toContain('private reasoning')
    await expect(
      runs.saveCheckpoint(created.id, {
        workerId: 'worker-happy',
        expectedCheckpointVersion: 0,
        checkpoint: { stale: true },
      }),
    ).rejects.toBeInstanceOf(AgentRunConflictError)

    const completedStep = await runs.transitionStep(created.id, step.id, {
      workerId: 'worker-happy',
      targetStatus: AiAgentStepStatus.COMPLETED,
      output: { planRef: 'plan_1' },
      event: {
        eventType: 'agent.progress',
        traceId: created.traceId,
        payload: { stepKey: 'plan', label: '规划', completed: 1, total: 1 },
      },
    })
    expect(completedStep.status).toBe(AiAgentStepStatus.COMPLETED)

    const completed = await runs.transition(created.id, {
      workerId: 'worker-happy',
      expectedVersion: claimed.statusVersion,
      targetStatus: AiAgentRunStatus.COMPLETED,
      resultSummary: { finalMessageId: created.responseMessageId, citationIds: [] },
      event: {
        eventType: 'agent.completed',
        traceId: created.traceId,
        payload: { finalMessageId: created.responseMessageId, usage: {}, warnings: [] },
      },
    })
    expect(completed).toMatchObject({ status: AiAgentRunStatus.COMPLETED, statusVersion: 3, leaseOwner: null })
    const replayed = await events.replay(userA.id, created.id, 0, 10)
    expect(replayed.map((event) => Number(event.sequence))).toEqual([1, 2, 3, 4, 5])
    expect(replayed.at(-1)?.eventType).toBe('agent.completed')
    expect(JSON.stringify(replayed.map((event) => event.payload))).not.toContain('private-token')
    await expect(
      events.appendEvent(created.id, {
        workerId: 'worker-happy',
        eventType: 'agent.progress',
        traceId: created.traceId,
        payload: { late: true },
      }),
    ).rejects.toBeInstanceOf(AgentRunConflictError)
    expect((await runs.findById(userA.id, created.id)).status).toBe(AiAgentRunStatus.COMPLETED)
  })

  it('queued 取消直接终态；running 取消先请求再协作完成，重复取消幂等', async () => {
    const queued = await runs.createRun(await makeRunCommand())
    const queuedCancelled = await runs.requestCancel({
      userId: userA.id,
      runId: queued.id,
      expectedVersion: 1,
      reason: '用户撤销',
    })
    const repeatedQueuedCancel = await runs.requestCancel({
      userId: userA.id,
      runId: queued.id,
      expectedVersion: 1,
      reason: '重复请求',
    })
    expect(queuedCancelled.status).toBe(AiAgentRunStatus.CANCELLED)
    expect(repeatedQueuedCancel.statusVersion).toBe(queuedCancelled.statusVersion)
    expect(await client!.aiRunEvent.count({ where: { runId: queued.id } })).toBe(2)

    const running = await runs.createRun(await makeRunCommand())
    const claimed = await runs.claimRun(running.id, 'worker-cancel')
    const cancelRequested = await runs.requestCancel({
      userId: userA.id,
      runId: running.id,
      expectedVersion: claimed.statusVersion,
      reason: '停止研究',
    })
    expect(cancelRequested.status).toBe(AiAgentRunStatus.CANCEL_REQUESTED)
    await expect(
      runs.transition(running.id, {
        workerId: 'worker-cancel',
        expectedVersion: cancelRequested.statusVersion,
        targetStatus: AiAgentRunStatus.COMPLETED,
        resultSummary: { invalid: true },
        event: { eventType: 'agent.completed', traceId: running.traceId, payload: { invalid: true } },
      }),
    ).rejects.toBeInstanceOf(AgentRunConflictError)
    const cancelled = await runs.transition(running.id, {
      workerId: 'worker-cancel',
      expectedVersion: cancelRequested.statusVersion,
      targetStatus: AiAgentRunStatus.CANCELLED,
      event: {
        eventType: 'agent.cancelled',
        traceId: running.traceId,
        payload: { cancelledBy: userA.id, reason: '停止研究' },
      },
    })
    expect(cancelled.status).toBe(AiAgentRunStatus.CANCELLED)
    await expect(
      client!.aiAgentRun.update({
        where: { id: running.id },
        data: { status: AiAgentRunStatus.COMPLETED, resultSummary: { late: true } },
      }),
    ).rejects.toThrow('terminal AI Agent Run is immutable')
  })

  it('双 Worker 只有一个 claim；过期 lease 可由新 identity 接管，旧 owner 不能续租', async () => {
    const created = await runs.createRun(await makeRunCommand())
    const claims = await Promise.allSettled([
      runs.claimRun(created.id, 'worker-race-a'),
      runs.claimRun(created.id, 'worker-race-b'),
    ])
    const winners = claims.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof runs.claimRun>>> =>
        result.status === 'fulfilled',
    )
    const losers = claims.filter((result) => result.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    const winner = winners[0].value
    const idempotent = await runs.claimRun(created.id, winner.leaseOwner!)
    expect(idempotent.attempt).toBe(1)
    expect(idempotent.statusVersion).toBe(2)

    await client!.$executeRaw(Prisma.sql`
      UPDATE "ai_agent_runs"
      SET "lease_expires_at" = clock_timestamp() - INTERVAL '1 second'
      WHERE "id" = ${created.id}
    `)
    const takenOver = await runs.claimRun(created.id, 'worker-takeover')
    expect(takenOver).toMatchObject({ leaseOwner: 'worker-takeover', attempt: 2, statusVersion: 3 })
    await expect(runs.heartbeat(created.id, winner.leaseOwner!)).rejects.toBeInstanceOf(AgentRunConflictError)
    await expect(runs.heartbeat(created.id, 'worker-takeover')).resolves.toMatchObject({
      leaseOwner: 'worker-takeover',
    })
    expect(await client!.aiRunEvent.count({ where: { runId: created.id } })).toBe(2)
  })

  it('cancel-vs-complete 共享 expectedVersion 时只产生一个状态突变和一条对应事件', async () => {
    const created = await runs.createRun(await makeRunCommand())
    const claimed = await runs.claimRun(created.id, 'worker-cancel-race')
    await Promise.allSettled([
      runs.requestCancel({ userId: userA.id, runId: created.id, expectedVersion: claimed.statusVersion }),
      runs.transition(created.id, {
        workerId: 'worker-cancel-race',
        expectedVersion: claimed.statusVersion,
        targetStatus: AiAgentRunStatus.COMPLETED,
        resultSummary: { finalMessageId: created.responseMessageId },
        event: {
          eventType: 'agent.completed',
          traceId: created.traceId,
          payload: { finalMessageId: created.responseMessageId },
        },
      }),
    ])
    const final = await client!.aiAgentRun.findUniqueOrThrow({ where: { id: created.id } })
    const storedEvents = await client!.aiRunEvent.findMany({
      where: { runId: created.id },
      orderBy: { sequence: 'asc' },
    })

    expect([AiAgentRunStatus.CANCEL_REQUESTED, AiAgentRunStatus.COMPLETED]).toContain(final.status)
    expect(final.statusVersion).toBe(3)
    expect(storedEvents.map((event) => Number(event.sequence))).toEqual([1, 2, 3])
    if (final.status === AiAgentRunStatus.CANCEL_REQUESTED) {
      expect(storedEvents.at(-1)?.eventType).toBe('run.cancel_requested')
      expect(storedEvents.some((event) => event.eventType === 'agent.completed')).toBe(false)
    } else {
      expect(storedEvents.at(-1)?.eventType).toBe('agent.completed')
    }
  })

  it('CANCEL_REQUESTED 清理阶段允许当前 Worker 续租，其他 Worker 仍被拒绝', async () => {
    const created = await runs.createRun(await makeRunCommand())
    const claimed = await runs.claimRun(created.id, 'worker-cancel-cleanup')
    const cancelling = await runs.requestCancel({
      userId: userA.id,
      runId: created.id,
      expectedVersion: claimed.statusVersion,
    })

    expect(cancelling.status).toBe(AiAgentRunStatus.CANCEL_REQUESTED)
    await expect(runs.heartbeat(created.id, 'worker-other')).rejects.toBeInstanceOf(AgentRunConflictError)
    await expect(runs.heartbeat(created.id, 'worker-cancel-cleanup')).resolves.toMatchObject({
      status: AiAgentRunStatus.CANCEL_REQUESTED,
      leaseOwner: 'worker-cancel-cleanup',
    })
  })

  it('20 路并发 append 无重复/缺口；1000-event replay 使用 run+sequence 索引', async () => {
    const created = await runs.createRun(await makeRunCommand())
    await runs.claimRun(created.id, 'worker-events', 300_000)
    const append = (index: number) =>
      events.appendEvent(created.id, {
        workerId: 'worker-events',
        eventType: 'model.delta',
        traceId: created.traceId,
        payload: { modelCallId: 'model_1', blockIndex: 0, delta: `${index}`, apiKey: 'private-key' },
      })

    const startedAt = Date.now()
    await Promise.all(Array.from({ length: 20 }, (_, index) => append(index)))
    for (let offset = 20; offset < 1_000; offset += 20) {
      await Promise.all(Array.from({ length: 20 }, (_, index) => append(offset + index)))
    }
    const elapsedMs = Date.now() - startedAt
    const allEvents = await client!.aiRunEvent.findMany({ where: { runId: created.id }, orderBy: { sequence: 'asc' } })
    const replayed = await events.replay(userA.id, created.id, 2, 1_000)

    expect(allEvents).toHaveLength(1_002)
    expect(allEvents.map((event) => Number(event.sequence))).toEqual(
      Array.from({ length: 1_002 }, (_, index) => index + 1),
    )
    expect(replayed).toHaveLength(1_000)
    expect(JSON.stringify(replayed[0].payload)).not.toContain('private-key')
    expect(elapsedMs).toBeLessThan(30_000)
    await expect(events.replay(userA.id, created.id, 0, 1_001)).rejects.toThrow('limit')

    const plan = await client!.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`
      return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
        EXPLAIN SELECT * FROM "ai_run_events"
        WHERE "run_id" = ${created.id} AND "sequence" > 500
        ORDER BY "sequence" ASC
        LIMIT 100
      `)
    })
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('ai_run_events_run_sequence')
  }, 60_000)

  it('Step attempt 幂等且复合 FK 阻止跨 Run parent/event；migration 约束与 trigger 完整', async () => {
    const runA = await runs.createRun(await makeRunCommand())
    const runB = await runs.createRun(await makeRunCommand())
    await runs.claimRun(runA.id, 'worker-fk-a')
    await runs.claimRun(runB.id, 'worker-fk-b')
    const command = {
      stepKey: 'tool-lookup',
      kind: AiAgentStepKind.TOOL,
      ordinal: 1,
      attempt: 1,
      input: { tsCode: '600000.SH' },
    }
    const stepA = await runs.createStep(runA.id, 'worker-fk-a', command)
    const repeated = await runs.createStep(runA.id, 'worker-fk-a', command)
    const stepB = await runs.createStep(runB.id, 'worker-fk-b', command)
    expect(repeated.id).toBe(stepA.id)
    await expect(
      runs.createStep(runA.id, 'worker-fk-a', { ...command, input: { tsCode: '000001.SZ' } }),
    ).rejects.toBeInstanceOf(AgentRunConflictError)
    await expect(
      client!.aiAgentStep.create({
        data: {
          runId: runA.id,
          parentStepId: stepB.id,
          stepKey: 'cross-run-parent',
          kind: AiAgentStepKind.VALIDATION,
          ordinal: 2,
          inputHash: sha256('{}'),
        },
      }),
    ).rejects.toThrow()
    const beforeSequence = (await client!.aiAgentRun.findUniqueOrThrow({ where: { id: runA.id } })).nextEventSequence
    await expect(
      events.appendEvent(runA.id, {
        workerId: 'worker-fk-a',
        stepId: stepB.id,
        eventType: 'agent.progress',
        traceId: runA.traceId,
        payload: { invalid: true },
      }),
    ).rejects.toThrow()
    expect((await client!.aiAgentRun.findUniqueOrThrow({ where: { id: runA.id } })).nextEventSequence).toBe(
      beforeSequence,
    )

    const constraints = await client!.$queryRaw<Array<{ name: string; deferrable: boolean }>>(Prisma.sql`
      SELECT conname AS name, condeferrable AS deferrable
      FROM pg_constraint
      WHERE conrelid IN (
        'ai_agent_runs'::regclass,
        'ai_agent_steps'::regclass,
        'ai_run_events'::regclass,
        'ai_tool_calls'::regclass,
        'ai_model_calls'::regclass
      )
    `)
    const triggers = await client!.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT tgname AS name
      FROM pg_trigger
      WHERE tgrelid IN ('ai_agent_runs'::regclass, 'ai_agent_steps'::regclass, 'ai_run_events'::regclass)
        AND NOT tgisinternal
    `)
    const names = constraints.map((item) => item.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'ai_agent_runs_user_id_fkey',
        'ai_agent_steps_parent_step_id_run_id_fkey',
        'ai_run_events_step_id_run_id_fkey',
        'ai_tool_calls_step_id_run_id_fkey',
        'ai_model_calls_run_id_fkey',
      ]),
    )
    const batch005ForeignKeys = new Set([
      'ai_agent_runs_user_id_fkey',
      'ai_agent_steps_parent_step_id_run_id_fkey',
      'ai_run_events_step_id_run_id_fkey',
      'ai_tool_calls_run_id_fkey',
      'ai_tool_calls_step_id_run_id_fkey',
      'ai_model_calls_run_id_fkey',
      'ai_model_calls_step_id_run_id_fkey',
    ])
    expect(constraints.filter((item) => batch005ForeignKeys.has(item.name)).every((item) => item.deferrable)).toBe(true)
    expect(triggers.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'ai_agent_runs_owner_trigger',
        'ai_agent_runs_status_transition_trigger',
        'ai_agent_steps_status_transition_trigger',
        'ai_run_events_integrity_trigger',
      ]),
    )
  })
})

jest.setTimeout(300_000)
