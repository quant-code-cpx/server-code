/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AiAgentRunStatus, AiJobOutboxStatus } from '@prisma/client'
import { Job, Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq'
import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { AgentProcessor } from '../agent.processor'
import { AgentQueueService } from '../agent-queue.service'
import { AgentReconcilerService } from '../agent-reconciler.service'
import { AGENT_EXECUTION_QUEUE } from '../agent.queue.constants'

const integrationDescribe = process.env.RUN_AGENT_QUEUE_INTEGRATION === 'true' ? describe : describe.skip

integrationDescribe('Agent BullMQ - 本机 Redis 集成测试', () => {
  let queue: Queue
  let queueEvents: QueueEvents
  let connection: ConnectionOptions
  let prefix: string
  let queueService: AgentQueueService
  let prisma: ReturnType<typeof createInMemoryAuthority>
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const config = buildAgentQueueConfig({ AGENT_JOB_ATTEMPTS: '3', AGENT_JOB_BACKOFF_MS: '100' })

  beforeAll(async () => {
    connection = resolveRedisConnection()
    prefix = `quant:agent-it:${process.pid}:${Date.now()}`
    queue = new Queue(AGENT_EXECUTION_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    })
    queueEvents = new QueueEvents(AGENT_EXECUTION_QUEUE, { connection, prefix })
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady()])
    await queue.obliterate({ force: true })
    prisma = createInMemoryAuthority(['run_duplicate', 'run_retry', 'run_recovery'])
    queueService = new AgentQueueService(queue as never, prisma as never, config, logger as never)
  })

  afterAll(async () => {
    await queue?.obliterate({ force: true })
    await Promise.all([queueEvents?.close(), queue?.close()])
  })

  it('duplicate enqueue 只有一个 job；基础设施 retry 使用新 identity', async () => {
    await expect(queueService.enqueueRun('run_duplicate')).resolves.toMatchObject({ state: 'enqueued' })
    await expect(queueService.enqueueRun('run_duplicate')).resolves.toMatchObject({ state: 'existing' })
    expect(await queue.getWaitingCount()).toBe(1)

    const identities: string[] = []
    let retryCalls = 0
    const processor = new AgentProcessor(
      {
        resume: jest.fn(async (runId: string, context: { workerId: string }) => {
          identities.push(context.workerId)
          if (runId === 'run_retry' && retryCalls++ === 0) throw new Error('temporary infrastructure failure')
          return { status: 'COMPLETED', runId }
        }),
      } as never,
      config,
      logger as never,
    )
    const worker = new Worker(AGENT_EXECUTION_QUEUE, (job) => processor.process(job as Job), {
      connection,
      prefix,
      concurrency: 2,
    })
    await worker.waitUntilReady()

    const duplicateJob = await queue.getJob('run_duplicate')
    await duplicateJob!.waitUntilFinished(queueEvents, 10_000)
    await queueService.enqueueRun('run_retry')
    const retryJob = await queue.getJob('run_retry')
    await retryJob!.waitUntilFinished(queueEvents, 10_000)
    await worker.close()

    const retryIdentities = identities.slice(-2)
    expect(retryIdentities).toHaveLength(2)
    expect(retryIdentities[0]).not.toBe(retryIdentities[1])
  }, 30_000)

  it('队列 key 被清空后，Reconciler 依据 PostgreSQL authority 等价数据重建 job', async () => {
    await queueService.enqueueRun('run_recovery')
    expect(await queue.getJob('run_recovery')).not.toBeNull()
    await queue.obliterate({ force: true })
    expect(await queue.getJob('run_recovery')).toBeFalsy()

    prisma.recoverableRows = [{ id: 'run_recovery' }]
    const reconciler = new AgentReconcilerService(prisma as never, queueService, config, logger as never)
    await expect(reconciler.requeueRecoverableRuns()).resolves.toBe(1)
    await expect(queue.getJob('run_recovery')).resolves.not.toBeNull()
  }, 20_000)
})

function createInMemoryAuthority(runIds: string[]) {
  const now = new Date()
  const runs = new Map(
    runIds.map((id) => [
      id,
      {
        id,
        status: AiAgentRunStatus.QUEUED,
        attempt: 0,
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 120_000),
      },
    ]),
  )
  const outboxes = new Map<string, any>()
  let nextId = 1n
  return {
    recoverableRows: [] as Array<{ id: string }>,
    aiAgentRun: {
      findUnique: jest.fn(async ({ where }: any) => runs.get(where.id) ?? null),
    },
    aiJobOutbox: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = `${where.kind_aggregateId.kind}:${where.kind_aggregateId.aggregateId}`
        const existing = outboxes.get(key)
        if (existing) return existing
        const created = {
          id: nextId++,
          status: AiJobOutboxStatus.PENDING,
          attempt: 0,
          nextAttemptAt: now,
          publishedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          ...create,
        }
        outboxes.set(key, created)
        return created
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = [...outboxes.values()].find((item) => item.id === where.id)
        if (!row) throw new Error('outbox missing')
        if (data.attempt?.increment) row.attempt += data.attempt.increment
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'attempt') row[key] = value
        }
        return row
      }),
      findMany: jest.fn(async () =>
        [...outboxes.values()]
          .filter((row) => [AiJobOutboxStatus.PENDING, AiJobOutboxStatus.RETRY].includes(row.status))
          .map((row) => ({ aggregateId: row.aggregateId })),
      ),
    },
    $queryRaw: jest.fn(async function () {
      return this.recoverableRows
    }),
  }
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
    throw new Error('Agent queue integration test 默认只允许本机 Redis')
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
