import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AiModelPolicy,
  AiScheduledTaskTrigger,
  AiTaskExecutionStatus,
  Prisma,
  PrismaClient,
  type AiScheduledTask,
  type User,
} from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { ScheduledResearchRepository } from '../scheduled-research.repository'

const runIntegration = process.env.RUN_SCHEDULED_RESEARCH_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('定时研究 DB integration 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname)) throw new Error('定时研究 integration 仅允许本机 PostgreSQL')
  const databaseName = `quant_scheduled_research_it_${process.pid}_${Date.now()}`
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

integrationDescribe('ScheduledResearchRepository - 独立 PostgreSQL 集成测试', () => {
  let admin: PrismaClient | undefined
  let client: PrismaClient | undefined
  let repository: ScheduledResearchRepository
  let userA: User
  let userB: User
  let databaseName = ''

  beforeAll(async () => {
    const urls = makeTemporaryDatabaseUrls()
    databaseName = urls.databaseName
    admin = new PrismaClient({ datasources: { db: { url: urls.adminUrl } } })
    await admin.$connect()
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
      stdio: 'pipe',
      timeout: 180_000,
    })
    client = new PrismaClient({ datasources: { db: { url: urls.databaseUrl } } })
    await client.$connect()
    userA = await client.user.create({
      data: { account: `schedule_it_a_${Date.now()}`, password: 'integration-test-only', nickname: 'Schedule IT A' },
    })
    userB = await client.user.create({
      data: { account: `schedule_it_b_${Date.now()}`, password: 'integration-test-only', nickname: 'Schedule IT B' },
    })
    repository = new ScheduledResearchRepository(client as unknown as PrismaService)
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

  it('两个 scanner 竞争同一 due task 时，只有一个 DB CAS claim 成功', async () => {
    const now = new Date('2026-07-22T10:30:00.000Z')
    const task = await createTask(client!, userA, now)
    expect((await repository.findDue(now, 10)).map((item) => item.id)).toContain(task.id)

    const [first, second] = await Promise.all([
      repository.claimDue(task.id, now, 'scanner-a', new Date(now.getTime() + 120_000)),
      repository.claimDue(task.id, now, 'scanner-b', new Date(now.getTime() + 120_000)),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    const claimed = await client!.aiScheduledTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(['scanner-a', 'scanner-b']).toContain(claimed.leaseOwner)
  })

  it('execution 的逻辑触发点和手动 request key 都由数据库唯一键兜底', async () => {
    const task = await createTask(client!, userA, new Date('2026-07-22T10:29:00.000Z'))
    const scheduledFor = new Date('2026-07-22T10:30:00.000Z')
    const command = {
      task,
      scheduledFor,
      requestKey: `manual:${randomUUID()}`,
      taskSnapshot: { schemaVersion: 1, taskId: task.id, prompt: task.prompt },
      gateEvidence: { reason: 'READY' },
    }

    const [first, second] = await Promise.all([
      repository.createExecutionOnce(command),
      repository.createExecutionOnce(command),
    ])

    expect(second.execution.id).toBe(first.execution.id)
    expect(await client!.aiTaskExecution.count({ where: { taskId: task.id, scheduledFor } })).toBe(1)
    await repository.deferExecution(first.execution.id, { reason: 'WATERMARK_MISSING' })
    await expect(
      client!.aiTaskExecution.findUniqueOrThrow({ where: { id: first.execution.id } }),
    ).resolves.toMatchObject({
      status: AiTaskExecutionStatus.DEFERRED,
      gateEvidence: { reason: 'WATERMARK_MISSING' },
    })

    await expect(
      client!.aiTaskExecution.create({
        data: {
          taskId: task.id,
          userId: userA.id,
          requestKey: `schedule:${scheduledFor.toISOString()}`,
          scheduledFor,
          taskSnapshot: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('task 与 execution 的 owner scope 不泄露给其他用户', async () => {
    const task = await createTask(client!, userA, new Date('2026-07-22T10:29:00.000Z'))
    const execution = await repository.createExecutionOnce({
      task,
      scheduledFor: new Date('2026-07-22T10:30:00.000Z'),
      requestKey: `manual:${randomUUID()}`,
      taskSnapshot: {},
      gateEvidence: {},
    })

    await expect(repository.findTaskForUser(userB.id, task.id)).resolves.toBeNull()
    await expect(repository.findExecutionForUser(userB.id, execution.execution.id)).resolves.toBeNull()
    await expect(
      repository.listExecutions({ userId: userB.id, taskId: task.id, cursor: null, limit: 10 }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
    })
  })
})

function createTask(client: PrismaClient, user: User, nextRunAt: Date): Promise<AiScheduledTask> {
  return client.aiScheduledTask.create({
    data: {
      userId: user.id,
      clientRequestId: randomUUID(),
      name: '定时研究 integration',
      trigger: AiScheduledTaskTrigger.CRON,
      cronExpression: '0 30 18 * * 1-5',
      timeZone: 'Asia/Shanghai',
      tradingDayOnly: false,
      prompt: '总结市场变化。',
      input: {},
      allowedCapabilities: ['INTERNAL_DATA'],
      requiredWatermarks: [],
      workflowKey: 'stock_research',
      workflowVersion: 1,
      workflowContentHash: 'a'.repeat(64),
      promptKey: 'stock_research_system',
      promptVersion: 1,
      promptContentHash: 'b'.repeat(64),
      modelPolicy: AiModelPolicy.AUTO,
      maxCostCny: 2,
      nextRunAt,
    },
  })
}
