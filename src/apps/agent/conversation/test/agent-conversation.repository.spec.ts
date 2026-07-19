import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AiMessageRole, AiMessageStatus, AiModelPolicy, Prisma, PrismaClient, type User } from '@prisma/client'
import { MESSAGE_BLOCK_FIXTURES } from 'src/apps/agent/contracts'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  AgentConversationArchivedError,
  AgentConversationNotFoundError,
  AgentIdempotencyConflictError,
  AgentMessageValidationError,
  AgentStoredMessageInvalidError,
} from '../agent-conversation.errors'
import { AgentConversationRepository } from '../agent-conversation.repository'
import { AgentMessageRepository } from '../agent-message.repository'

const runIntegration = process.env.RUN_AGENT_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent DB integration test 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname) && process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent DB integration test 默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_it_${process.pid}_${Date.now()}`
  if (!/^quant_agent_it_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

integrationDescribe('Agent 会话/消息 Repository — 临时数据库集成测试', () => {
  let admin: PrismaClient | undefined
  let client: PrismaClient | undefined
  let conversationRepository: AgentConversationRepository
  let messageRepository: AgentMessageRepository
  let userA: User
  let userB: User
  let databaseName = ''

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

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
      stdio: 'pipe',
      timeout: 180_000,
    })

    client = new PrismaClient({ datasources: { db: { url: urls.databaseUrl } } })
    await client.$connect()
    userA = await client.user.create({
      data: { account: `agent_it_a_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent IT A' },
    })
    userB = await client.user.create({
      data: { account: `agent_it_b_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent IT B' },
    })
    conversationRepository = new AgentConversationRepository(client as unknown as PrismaService, logger)
    messageRepository = new AgentMessageRepository(client as unknown as PrismaService, logger)
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

  it('并发重复 createConversation 只创建一行，不同请求内容返回幂等冲突', async () => {
    const command = {
      clientRequestId: randomUUID(),
      title: '贵州茅台估值研究',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    }
    const [first, second] = await Promise.all([
      conversationRepository.createConversation(userA.id, command),
      conversationRepository.createConversation(userA.id, command),
    ])

    expect(second.id).toBe(first.id)
    expect(
      await client!.aiConversation.count({ where: { userId: userA.id, clientRequestId: command.clientRequestId } }),
    ).toBe(1)
    await expect(
      conversationRepository.createConversation(userA.id, { ...command, title: '不同研究主题' }),
    ).rejects.toBeInstanceOf(AgentIdempotencyConflictError)

    const otherTenant = await conversationRepository.createConversation(userB.id, command)
    expect(otherTenant.id).not.toBe(first.id)
  })

  it('所有会话与消息查询同时校验 userId，跨租户 ID 无法读取或写入', async () => {
    const conversation = await conversationRepository.createConversation(userA.id, {
      clientRequestId: randomUUID(),
      title: '租户隔离测试',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })

    await expect(conversationRepository.findById(userB.id, conversation.id)).rejects.toBeInstanceOf(
      AgentConversationNotFoundError,
    )
    await expect(
      messageRepository.appendMessage(userB.id, conversation.id, {
        clientRequestId: randomUUID(),
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: '越权消息',
        contentBlocks: [],
      }),
    ).rejects.toBeInstanceOf(AgentConversationNotFoundError)

    const userBPage = await conversationRepository.listByCursor(userB.id, {
      limit: 100,
      includeArchived: true,
    })
    expect(userBPage.items.map((item) => item.id)).not.toContain(conversation.id)
  })

  it('写入与读取都校验内容块，归档后禁止追加，完成消息正文不可覆盖', async () => {
    const conversation = await conversationRepository.createConversation(userA.id, {
      clientRequestId: randomUUID(),
      title: '不可变消息测试',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })

    await expect(
      messageRepository.appendMessage(userA.id, conversation.id, {
        clientRequestId: randomUUID(),
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.COMPLETED,
        contentBlocks: [{ blockId: 'unsafe', schemaVersion: 1, type: 'MARKDOWN', text: '<script>x</script>' }],
      }),
    ).rejects.toBeInstanceOf(AgentMessageValidationError)
    await expect(
      messageRepository.appendMessage(userA.id, conversation.id, {
        clientRequestId: randomUUID(),
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.COMPLETED,
        contentBlocks: [],
      }),
    ).rejects.toBeInstanceOf(AgentMessageValidationError)

    const completed = await messageRepository.appendMessage(userA.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.COMPLETED,
      contentText: '不可被覆盖的结论',
      contentBlocks: [MESSAGE_BLOCK_FIXTURES[0]],
    })
    await expect(
      client!.aiMessage.update({ where: { id: completed.id }, data: { contentText: '被篡改的结论' } }),
    ).rejects.toThrow('completed AI message content and identity are immutable')

    await conversationRepository.archiveConversation(userA.id, conversation.id)
    await expect(
      messageRepository.appendMessage(userA.id, conversation.id, {
        clientRequestId: randomUUID(),
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: '归档后追加',
        contentBlocks: [],
      }),
    ).rejects.toBeInstanceOf(AgentConversationArchivedError)
    expect(JSON.stringify((logger.log as unknown as jest.Mock).mock.calls)).not.toContain('不可被覆盖的结论')
  })

  it('同毫秒消息使用 createdAt + id 稳定游标，无重复或遗漏', async () => {
    const conversation = await conversationRepository.createConversation(userA.id, {
      clientRequestId: randomUUID(),
      title: '稳定游标测试',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })
    const createdAt = new Date('2026-07-19T04:00:00.000Z')
    const ids = Array.from({ length: 5 }, (_, index) => `msg_cursor_0${index + 1}`)
    await client!.aiMessage.createMany({
      data: ids.map((id, index) => ({
        id,
        userId: userA.id,
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: `游标消息 ${index + 1}`,
        contentBlocks: JSON.parse(JSON.stringify([MESSAGE_BLOCK_FIXTURES[0]])) as Prisma.InputJsonValue,
        clientRequestId: randomUUID(),
        createdAt,
        completedAt: createdAt,
      })),
    })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await messageRepository.listMessages(userA.id, conversation.id, { cursor, limit: 2 })
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)

    expect(new Set(seen).size).toBe(5)
    expect([...seen].sort()).toEqual([...ids].sort())
  })

  it('读取历史消息时重新校验内容协议，非法持久化块不会进入上层', async () => {
    const conversation = await conversationRepository.createConversation(userA.id, {
      clientRequestId: randomUUID(),
      title: '读取协议校验',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })
    await client!.aiMessage.create({
      data: {
        userId: userA.id,
        conversationId: conversation.id,
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.PENDING,
        contentBlocks: [{ blockId: 'legacy-invalid', schemaVersion: 1, type: 'UNKNOWN' }],
        clientRequestId: randomUUID(),
      },
    })

    await expect(messageRepository.listMessages(userA.id, conversation.id, { limit: 10 })).rejects.toBeInstanceOf(
      AgentStoredMessageInvalidError,
    )
  })

  it('并发 regenerate 创建递增 assistant sibling version，重复 clientRequestId 返回原行', async () => {
    const conversation = await conversationRepository.createConversation(userA.id, {
      clientRequestId: randomUUID(),
      title: '消息版本测试',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })
    const userMessage = await messageRepository.appendMessage(userA.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.USER,
      status: AiMessageStatus.COMPLETED,
      contentText: '分析银行板块',
      contentBlocks: [],
    })
    const firstAssistant = await messageRepository.appendMessage(userA.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.COMPLETED,
      contentText: '第一版结论',
      contentBlocks: [MESSAGE_BLOCK_FIXTURES[0]],
      parentMessageId: userMessage.id,
      version: 1,
    })
    const requestA = randomUUID()
    const requestB = randomUUID()
    const [versionA, versionB] = await Promise.all([
      messageRepository.createAssistantVersion(userA.id, firstAssistant.id, { clientRequestId: requestA }),
      messageRepository.createAssistantVersion(userA.id, firstAssistant.id, { clientRequestId: requestB }),
    ])
    const repeated = await messageRepository.createAssistantVersion(userA.id, firstAssistant.id, {
      clientRequestId: requestA,
    })

    expect(repeated.id).toBe(versionA.id)
    expect([versionA.version, versionB.version].sort()).toEqual([2, 3])
    const versions = await client!.aiMessage.findMany({
      where: { parentMessageId: userMessage.id },
      orderBy: { version: 'asc' },
      select: { version: true },
    })
    expect(versions.map((item) => item.version)).toEqual([1, 2, 3])
  })

  it('migration 落地必需 FK、唯一约束、CHECK 和不可变 trigger', async () => {
    const constraints = await client!.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid IN ('ai_conversations'::regclass, 'ai_messages'::regclass)
    `)
    const triggers = await client!.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT tgname AS name
      FROM pg_trigger
      WHERE tgrelid = 'ai_messages'::regclass AND NOT tgisinternal
    `)
    const names = constraints.map((item) => item.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'ai_conversations_user_id_fkey',
        'ai_messages_conversation_id_fkey',
        'ai_messages_user_id_fkey',
        'ai_messages_parent_message_id_fkey',
        'ai_messages_completed_content_check',
      ]),
    )
    expect(triggers.map((item) => item.name)).toContain('ai_messages_completed_immutable_trigger')
  })
})

jest.setTimeout(300_000)
