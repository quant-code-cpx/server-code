import { randomUUID } from 'node:crypto'
import {
  AiMemoryCategory,
  AiMemorySensitivity,
  AiMemoryStatus,
  AiMessageRole,
  AiMessageStatus,
  AiVersionStatus,
  PrismaClient,
  type AiConversation,
  type AiMessage,
  type AiPromptVersion,
  type User,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { createTemporaryAgentDatabase, type TemporaryAgentDatabase } from 'test/agent/support/temporary-agent-database'
import { AgentMessageRepository } from '../../conversation/agent-message.repository'
import {
  AgentMemoryConflictError,
  AgentMemoryNotFoundError,
  AgentSummaryValidationError,
  AgentSummaryVersionConflictError,
} from '../memory-repository.errors'
import { ConversationSummaryRepository } from '../conversation-summary.repository'
import { MemoryPolicyError } from '../memory-policy'
import { UserMemoryRepository } from '../user-memory.repository'

const runIntegration = process.env.RUN_AGENT_MEMORY_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip
const DAY_MS = 86_400_000
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

integrationDescribe('Agent 摘要/记忆 Repository - 临时 PostgreSQL 集成测试', () => {
  let database: TemporaryAgentDatabase | undefined
  let client: PrismaClient
  let summaries: ConversationSummaryRepository
  let messages: AgentMessageRepository
  let memories: UserMemoryRepository
  let userA: User
  let userB: User
  let prompt: AiPromptVersion

  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService

  beforeAll(async () => {
    database = await createTemporaryAgentDatabase()
    client = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } })
    await client.$connect()
    userA = await createUser('memory_a')
    userB = await createUser('memory_b')
    prompt = await client.aiPromptVersion.create({
      data: {
        promptKey: `summary_${randomUUID()}`,
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        template: 'summarize',
        contentHash: HASH_A,
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt: new Date('2026-07-21T00:00:00.000Z'),
      },
    })
    summaries = new ConversationSummaryRepository(client as unknown as PrismaService, logger)
    messages = new AgentMessageRepository(client as unknown as PrismaService, logger)
    memories = new UserMemoryRepository(client as unknown as PrismaService, logger)
  }, 240_000)

  beforeEach(async () => {
    if (!client || !userA || !userB) return
    const userIds = [userA.id, userB.id]
    await client.aiUserMemory.deleteMany({ where: { userId: { in: userIds } } })
    await client.aiConversation.updateMany({
      where: { userId: { in: userIds } },
      data: { currentSummaryId: null, summaryVersion: 0 },
    })
    await client.aiConversationSummary.deleteMany({ where: { conversation: { userId: { in: userIds } } } })
    await client.aiMessage.deleteMany({ where: { userId: { in: userIds } } })
    await client.aiConversation.deleteMany({ where: { userId: { in: userIds } } })
  })

  afterAll(async () => {
    await client?.$disconnect()
    await database?.dispose()
  }, 60_000)

  describe('ConversationSummaryRepository', () => {
    it('原子创建版本 1/2、推进 current，并保持历史摘要不可变', async () => {
      const fixture = await createConversationFixture(userA.id, 4)
      const first = await summaries.createAndAdvance(userA.id, fixture.conversation.id, {
        expectedSummaryVersion: 0,
        fromMessageId: fixture.messages[0].id,
        throughMessageId: fixture.messages[1].id,
        summaryText: '第一版摘要',
        facts: [{ claim: '用户关注银行板块', sourceMessageId: fixture.messages[0].id }],
        sourceMessageIds: fixture.messages.slice(0, 2).map((message) => message.id),
        promptVersionId: prompt.id,
        modelName: 'fake-summary-model',
        sourceTokenCount: 120,
        contentHash: HASH_A,
      })
      const firstSnapshot = await client.aiConversationSummary.findUniqueOrThrow({ where: { id: first.id } })

      const second = await summaries.createAndAdvance(userA.id, fixture.conversation.id, {
        expectedSummaryVersion: 1,
        fromMessageId: fixture.messages[0].id,
        throughMessageId: fixture.messages[3].id,
        summaryText: '第二版摘要',
        facts: [{ claim: '用户改为关注红利策略', sourceMessageId: fixture.messages[2].id }],
        sourceMessageIds: fixture.messages.map((message) => message.id),
        promptVersionId: prompt.id,
        modelName: 'fake-summary-model',
        sourceTokenCount: 240,
        contentHash: HASH_B,
      })

      expect([first.version, second.version]).toEqual([1, 2])
      expect(await summaries.findCurrent(userA.id, fixture.conversation.id)).toMatchObject({
        id: second.id,
        version: 2,
      })
      expect((await summaries.listHistory(userA.id, fixture.conversation.id)).map((item) => item.version)).toEqual([
        2, 1,
      ])
      expect(await client.aiConversationSummary.findUniqueOrThrow({ where: { id: first.id } })).toEqual(firstSnapshot)
      expect(await client.aiConversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })).toMatchObject({
        currentSummaryId: second.id,
        summaryVersion: 2,
      })
    })

    it('无摘要返回 null/空历史，且跨租户查询表现为安全 not-found', async () => {
      const fixture = await createConversationFixture(userA.id, 1)

      expect(await summaries.findCurrent(userA.id, fixture.conversation.id)).toBeNull()
      expect(await summaries.listHistory(userA.id, fixture.conversation.id)).toEqual([])
      await expect(summaries.findCurrent(userB.id, fixture.conversation.id)).rejects.toMatchObject({
        code: 'AI_CONVERSATION_NOT_FOUND',
      })
      await expect(summaries.listHistory(userB.id, fixture.conversation.id)).rejects.toMatchObject({
        code: 'AI_CONVERSATION_NOT_FOUND',
      })
      await expect(
        summaries.createAndAdvance(userB.id, fixture.conversation.id, summaryCommand(fixture.messages, prompt.id)),
      ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND' })
    })

    it('单消息区间合法，但 DRAFT Prompt 不能生成持久摘要', async () => {
      const fixture = await createConversationFixture(userA.id, 1)
      const single = await summaries.createAndAdvance(
        userA.id,
        fixture.conversation.id,
        summaryCommand(fixture.messages, prompt.id),
      )
      expect(single).toMatchObject({
        fromMessageId: fixture.messages[0].id,
        throughMessageId: fixture.messages[0].id,
        version: 1,
      })

      const other = await createConversationFixture(userA.id, 1)
      const draft = await client.aiPromptVersion.create({
        data: {
          promptKey: `summary_draft_${randomUUID()}`,
          version: 1,
          status: AiVersionStatus.DRAFT,
          template: 'draft summarize',
          contentHash: HASH_B,
          createdBy: userA.id,
        },
      })
      await expect(
        summaries.createAndAdvance(userA.id, other.conversation.id, summaryCommand(other.messages, draft.id)),
      ).rejects.toBeInstanceOf(AgentSummaryValidationError)
      expect(await client.aiConversationSummary.count({ where: { conversationId: other.conversation.id } })).toBe(0)
    })

    it('拒绝倒序、跨会话和区间外来源，失败后无摘要或版本推进', async () => {
      const fixture = await createConversationFixture(userA.id, 3)
      const other = await createConversationFixture(userA.id, 1)
      const base = {
        expectedSummaryVersion: 0,
        summaryText: '非法摘要',
        facts: [],
        promptVersionId: prompt.id,
        modelName: 'fake-summary-model',
        sourceTokenCount: 10,
        contentHash: HASH_A,
      }

      await expect(
        summaries.createAndAdvance(userA.id, fixture.conversation.id, {
          ...base,
          fromMessageId: fixture.messages[2].id,
          throughMessageId: fixture.messages[0].id,
          sourceMessageIds: [fixture.messages[2].id],
        }),
      ).rejects.toBeInstanceOf(AgentSummaryValidationError)
      await expect(
        summaries.createAndAdvance(userA.id, fixture.conversation.id, {
          ...base,
          fromMessageId: fixture.messages[0].id,
          throughMessageId: other.messages[0].id,
          sourceMessageIds: [fixture.messages[0].id],
        }),
      ).rejects.toBeInstanceOf(AgentSummaryValidationError)
      await expect(
        summaries.createAndAdvance(userA.id, fixture.conversation.id, {
          ...base,
          fromMessageId: fixture.messages[1].id,
          throughMessageId: fixture.messages[2].id,
          sourceMessageIds: [fixture.messages[0].id],
        }),
      ).rejects.toBeInstanceOf(AgentSummaryValidationError)

      expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversation.id } })).toBe(0)
      expect(await client.aiConversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })).toMatchObject({
        currentSummaryId: null,
        summaryVersion: 0,
      })
    })

    it('Prompt FK 失败与旧 expected version 都完整回滚', async () => {
      const fixture = await createConversationFixture(userA.id, 2)
      const command = summaryCommand(fixture.messages, 'missing_prompt_version')

      await expect(summaries.createAndAdvance(userA.id, fixture.conversation.id, command)).rejects.toThrow()
      expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversation.id } })).toBe(0)
      expect(
        (await client.aiConversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })).summaryVersion,
      ).toBe(0)

      await summaries.createAndAdvance(userA.id, fixture.conversation.id, summaryCommand(fixture.messages, prompt.id))
      await expect(
        summaries.createAndAdvance(userA.id, fixture.conversation.id, summaryCommand(fixture.messages, prompt.id)),
      ).rejects.toBeInstanceOf(AgentSummaryVersionConflictError)
      expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversation.id } })).toBe(1)
    })

    it('相同 expected version 并发推进时恰好一个成功且无孤儿摘要', async () => {
      const fixture = await createConversationFixture(userA.id, 2)
      const results = await Promise.allSettled([
        summaries.createAndAdvance(userA.id, fixture.conversation.id, summaryCommand(fixture.messages, prompt.id)),
        summaries.createAndAdvance(userA.id, fixture.conversation.id, {
          ...summaryCommand(fixture.messages, prompt.id),
          summaryText: '并发摘要 B',
          contentHash: HASH_B,
        }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        AgentSummaryVersionConflictError,
      )
      expect(await client.aiConversationSummary.count({ where: { conversationId: fixture.conversation.id } })).toBe(1)
      expect(await client.aiConversation.findUniqueOrThrow({ where: { id: fixture.conversation.id } })).toMatchObject({
        summaryVersion: 1,
      })
    })
  })

  describe('AgentMessageRepository 摘要候选范围', () => {
    it('只返回保护窗口之前的 canonical 已完成消息，并按最旧优先分页', async () => {
      const fixture = await createConversationFixture(userA.id, 33)
      const firstCreatedAt = fixture.messages[0].createdAt
      await client.aiMessage.createMany({
        data: [
          {
            userId: userA.id,
            conversationId: fixture.conversation.id,
            role: AiMessageRole.SYSTEM,
            status: AiMessageStatus.COMPLETED,
            contentText: '系统消息不可摘要',
            contentBlocks: [],
            createdAt: new Date(firstCreatedAt.getTime() + 250),
            completedAt: new Date(firstCreatedAt.getTime() + 250),
          },
          {
            userId: userA.id,
            conversationId: fixture.conversation.id,
            role: AiMessageRole.ASSISTANT,
            status: AiMessageStatus.COMPLETED,
            contentText: '重新生成旁支不可自动摘要',
            contentBlocks: [],
            parentMessageId: fixture.messages[0].id,
            version: 2,
            createdAt: new Date(firstCreatedAt.getTime() + 500),
            completedAt: new Date(firstCreatedAt.getTime() + 500),
          },
        ],
      })

      const page = await messages.listCompletedSummaryCandidates(userA.id, fixture.conversation.id, {
        afterMessageId: null,
        throughMessageId: fixture.messages[32].id,
        protectedRecentCount: 20,
        maxCandidates: 8,
      })

      expect(page).toMatchObject({ anchorFound: true, throughFound: true, hasMore: true })
      expect(page.items.map((message) => message.id)).toEqual(fixture.messages.slice(0, 8).map((message) => message.id))
      expect(page.items.every((message) => message.status === AiMessageStatus.COMPLETED)).toBe(true)

      const contextPage = await messages.listCompletedContextRange(userA.id, fixture.conversation.id, {
        afterMessageId: null,
        throughMessageId: fixture.messages[32].id,
        limit: 100,
      })
      expect(contextPage.items.map((message) => message.id)).toEqual(fixture.messages.map((message) => message.id))

      const incremental = await messages.listCompletedSummaryCandidates(userA.id, fixture.conversation.id, {
        afterMessageId: fixture.messages[3].id,
        throughMessageId: fixture.messages[32].id,
        protectedRecentCount: 20,
        maxCandidates: 100,
      })
      expect(incremental.items.map((message) => message.id)).toEqual(
        fixture.messages.slice(4, 13).map((message) => message.id),
      )
    })

    it('跨租户和非 USER 触发消息安全失败，不泄露候选', async () => {
      const fixture = await createConversationFixture(userA.id, 22)

      await expect(
        messages.listCompletedSummaryCandidates(userB.id, fixture.conversation.id, {
          afterMessageId: null,
          throughMessageId: fixture.messages[20].id,
          protectedRecentCount: 20,
          maxCandidates: 100,
        }),
      ).rejects.toMatchObject({ code: 'AI_CONVERSATION_NOT_FOUND' })

      const assistantTrigger = await messages.listCompletedSummaryCandidates(userA.id, fixture.conversation.id, {
        afterMessageId: null,
        throughMessageId: fixture.messages[21].id,
        protectedRecentCount: 20,
        maxCandidates: 100,
      })
      expect(assistantTrigger).toEqual({ anchorFound: true, throughFound: false, hasMore: false, items: [] })
    })
  })

  describe('UserMemoryRepository', () => {
    it('候选默认不 active；显式确认后应用默认 TTL 并进入 active', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const candidate = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.PREFERENCE,
        key: `display.compact.${randomUUID()}`,
        value: { enabled: true },
        sensitivity: AiMemorySensitivity.NORMAL,
        confidence: 0.9,
        topic: 'GENERAL',
      })

      expect(candidate).toMatchObject({ status: AiMemoryStatus.CANDIDATE, version: 1 })
      expect(await memories.listActive(userA.id, now)).toEqual([])

      const confirmed = await memories.confirm(userA.id, candidate.id, {
        now,
        source: 'USER_SETTING',
        topic: 'GENERAL',
      })
      expect(confirmed).toMatchObject({ status: AiMemoryStatus.CONFIRMED, version: 1 })
      expect(confirmed.confirmedAt).toEqual(now)
      expect(confirmed.expiresAt).toEqual(new Date(now.getTime() + 365 * DAY_MS))
      expect((await memories.listActive(userA.id, now)).map((item) => item.id)).toEqual([candidate.id])
    })

    it('过期边界立即排除，超过类别最大 TTL 拒绝且候选不变', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const expiresAt = new Date(now.getTime() + DAY_MS)
      const candidate = await createCandidate(userA.id, AiMemoryCategory.CONSTRAINT)
      await memories.confirm(userA.id, candidate.id, {
        now,
        expiresAt,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
      })

      expect((await memories.listActive(userA.id, new Date(expiresAt.getTime() - 1))).map((item) => item.id)).toContain(
        candidate.id,
      )
      expect((await memories.listActive(userA.id, expiresAt)).map((item) => item.id)).not.toContain(candidate.id)

      const tooLong = await createCandidate(userA.id, AiMemoryCategory.CONSTRAINT)
      await expect(
        memories.confirm(userA.id, tooLong.id, {
          now,
          expiresAt: new Date(now.getTime() + 731 * DAY_MS),
          source: 'USER_COMMAND',
          topic: 'GENERAL',
        }),
      ).rejects.toBeInstanceOf(MemoryPolicyError)
      expect(await client.aiUserMemory.findUniqueOrThrow({ where: { id: tooLong.id } })).toMatchObject({
        status: AiMemoryStatus.CANDIDATE,
        confirmedAt: null,
      })
    })

    it('确认同 key 新候选时原子标记已过期旧版本，不让过期行占用 active unique', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const expiresAt = new Date(now.getTime() + DAY_MS)
      const key = `preference.expiry.${randomUUID()}`
      const oldCandidate = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.PREFERENCE,
        key,
        value: { mode: 'old' },
        sensitivity: AiMemorySensitivity.NORMAL,
        topic: 'GENERAL',
      })
      await memories.confirm(userA.id, oldCandidate.id, {
        now,
        expiresAt,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
      })
      const newCandidate = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.PREFERENCE,
        key,
        value: { mode: 'new' },
        sensitivity: AiMemorySensitivity.NORMAL,
        topic: 'GENERAL',
      })

      const confirmed = await memories.confirm(userA.id, newCandidate.id, {
        now: expiresAt,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
      })

      expect(confirmed).toMatchObject({ status: AiMemoryStatus.CONFIRMED, version: 2 })
      expect(await client.aiUserMemory.findUniqueOrThrow({ where: { id: oldCandidate.id } })).toMatchObject({
        status: AiMemoryStatus.EXPIRED,
      })
      expect((await memories.listActive(userA.id, expiresAt)).map((item) => item.id)).toEqual([confirmed.id])
    })

    it('禁止主题与非法金融类别在持久化前拒绝', async () => {
      await expect(
        memories.createCandidate(userA.id, {
          category: AiMemoryCategory.PROFILE,
          key: `portfolio.position.${randomUUID()}`,
          value: { tsCode: '600519.SH', cost: 1_500 },
          sensitivity: AiMemorySensitivity.FINANCIAL,
          topic: 'PORTFOLIO_POSITION',
        }),
      ).rejects.toBeInstanceOf(MemoryPolicyError)

      const candidate = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.DOMAIN_FACT,
        key: `domain.fact.${randomUUID()}`,
        value: { text: '阶段事实' },
        sensitivity: AiMemorySensitivity.NORMAL,
        topic: 'GENERAL',
      })
      await expect(
        memories.confirm(userA.id, candidate.id, {
          now: new Date('2026-07-21T00:00:00.000Z'),
          sensitivity: AiMemorySensitivity.FINANCIAL,
          source: 'USER_COMMAND',
          topic: 'GENERAL',
        }),
      ).rejects.toBeInstanceOf(MemoryPolicyError)
      expect(await client.aiUserMemory.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
        status: AiMemoryStatus.CANDIDATE,
        sensitivity: AiMemorySensitivity.NORMAL,
      })
    })

    it('来源必须同用户、同会话；跨租户 provenance 不落库', async () => {
      const fixtureA = await createConversationFixture(userA.id, 1)
      const fixtureB = await createConversationFixture(userB.id, 1)

      await expect(
        memories.createCandidate(userA.id, {
          category: AiMemoryCategory.PROFILE,
          key: `profile.source.${randomUUID()}`,
          value: { occupation: 'analyst' },
          sensitivity: AiMemorySensitivity.PERSONAL,
          sourceConversationId: fixtureA.conversation.id,
          sourceMessageId: fixtureB.messages[0].id,
          topic: 'GENERAL',
        }),
      ).rejects.toMatchObject({ code: 'AI_MEMORY_VALIDATION_FAILED' })
      expect(
        await client.aiUserMemory.count({
          where: { userId: userA.id, sourceMessageId: fixtureB.messages[0].id },
        }),
      ).toBe(0)
    })

    it('纠错原子撤销旧版、创建 version + 1，历史可追溯', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const candidate = await createCandidate(userA.id, AiMemoryCategory.PREFERENCE)
      const confirmed = await memories.confirm(userA.id, candidate.id, {
        now,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
      })
      const correctedAt = new Date(now.getTime() + DAY_MS)
      const corrected = await memories.correct(userA.id, confirmed.id, {
        value: { style: 'detailed' },
        now: correctedAt,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
      })

      expect(corrected).toMatchObject({
        category: confirmed.category,
        key: confirmed.key,
        version: 2,
        status: AiMemoryStatus.CONFIRMED,
        value: { style: 'detailed' },
      })
      expect(await client.aiUserMemory.findUniqueOrThrow({ where: { id: confirmed.id } })).toMatchObject({
        status: AiMemoryStatus.REVOKED,
        revokedAt: correctedAt,
        version: 1,
      })
      const history = await memories.listHistory(userA.id, confirmed.category, confirmed.key)
      expect(history.map((item) => item.version)).toEqual([2, 1])
      expect((await memories.listActive(userA.id, correctedAt)).map((item) => item.id)).toEqual([corrected.id])
    })

    it('纠错新版本插入失败时旧版保持 CONFIRMED', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const candidate = await createCandidate(userA.id, AiMemoryCategory.PREFERENCE)
      await memories.confirm(userA.id, candidate.id, { now, source: 'USER_COMMAND', topic: 'GENERAL' })
      await client.$executeRawUnsafe(`
        CREATE FUNCTION reject_agent_memory_v2() RETURNS trigger AS $$
        BEGIN
          IF NEW.version = 2 THEN RAISE EXCEPTION 'injected memory v2 failure'; END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `)
      await client.$executeRawUnsafe(`
        CREATE TRIGGER reject_agent_memory_v2_trigger
        BEFORE INSERT ON ai_user_memories
        FOR EACH ROW EXECUTE FUNCTION reject_agent_memory_v2()
      `)

      try {
        await expect(
          memories.correct(userA.id, candidate.id, {
            value: { style: 'rollback-check' },
            now: new Date(now.getTime() + DAY_MS),
            source: 'USER_COMMAND',
            topic: 'GENERAL',
          }),
        ).rejects.toThrow('injected memory v2 failure')
        expect(await client.aiUserMemory.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({
          status: AiMemoryStatus.CONFIRMED,
          revokedAt: null,
        })
        expect(await client.aiUserMemory.count({ where: { userId: userA.id, key: candidate.key } })).toBe(1)
      } finally {
        await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_agent_memory_v2_trigger ON ai_user_memories')
        await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_agent_memory_v2()')
      }
    })

    it('撤销和删除立即失效，跨租户修改统一安全 not-found', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const revokeCandidate = await createCandidate(userA.id, AiMemoryCategory.CONSTRAINT)
      await memories.confirm(userA.id, revokeCandidate.id, { now, source: 'USER_COMMAND', topic: 'GENERAL' })

      expect(await memories.listActive(userB.id, now)).toEqual([])
      expect(await memories.listHistory(userB.id, revokeCandidate.category, revokeCandidate.key)).toEqual([])
      await expect(
        memories.confirm(userA.id, revokeCandidate.id, {
          now,
          source: 'USER_COMMAND',
          topic: 'GENERAL',
        }),
      ).rejects.toBeInstanceOf(AgentMemoryConflictError)

      for (const operation of [
        () =>
          memories.confirm(userB.id, revokeCandidate.id, {
            now,
            source: 'USER_COMMAND',
            topic: 'GENERAL',
          }),
        () =>
          memories.correct(userB.id, revokeCandidate.id, {
            value: { changed: true },
            now,
            source: 'USER_COMMAND',
            topic: 'GENERAL',
          }),
        () => memories.revoke(userB.id, revokeCandidate.id, now),
        () => memories.softDelete(userB.id, revokeCandidate.id, now),
      ]) {
        await expect(operation()).rejects.toBeInstanceOf(AgentMemoryNotFoundError)
      }

      await memories.revoke(userA.id, revokeCandidate.id, now)
      expect((await memories.listActive(userA.id, now)).map((item) => item.id)).not.toContain(revokeCandidate.id)

      const deleteCandidate = await createCandidate(userA.id, AiMemoryCategory.PROFILE)
      const deleted = await memories.softDelete(userA.id, deleteCandidate.id, now)
      expect(deleted).toMatchObject({ status: AiMemoryStatus.REVOKED, deletedAt: now, revokedAt: now })
      expect((await memories.listActive(userA.id, now)).map((item) => item.id)).not.toContain(deleteCandidate.id)
    })

    it('同 key 两候选并发确认时 partial unique 保证仅一个 active', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const key = `constraint.concurrent.${randomUUID()}`
      const first = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.CONSTRAINT,
        key,
        value: { maxDrawdown: 0.1 },
        sensitivity: AiMemorySensitivity.FINANCIAL,
        topic: 'GENERAL',
      })
      const second = await memories.createCandidate(userA.id, {
        category: AiMemoryCategory.CONSTRAINT,
        key,
        value: { maxDrawdown: 0.2 },
        sensitivity: AiMemorySensitivity.FINANCIAL,
        topic: 'GENERAL',
      })
      const results = await Promise.allSettled(
        [first, second].map((candidate) =>
          memories.confirm(userA.id, candidate.id, {
            now,
            source: 'USER_COMMAND',
            topic: 'GENERAL',
          }),
        ),
      )

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        AgentMemoryConflictError,
      )
      expect(
        await client.aiUserMemory.count({
          where: { userId: userA.id, category: AiMemoryCategory.CONSTRAINT, key, status: AiMemoryStatus.CONFIRMED },
        }),
      ).toBe(1)
    })

    it('同一 active 记忆并发纠错时仅产生一个 version 2', async () => {
      const now = new Date('2026-07-21T00:00:00.000Z')
      const candidate = await createCandidate(userA.id, AiMemoryCategory.PREFERENCE)
      await memories.confirm(userA.id, candidate.id, { now, source: 'USER_COMMAND', topic: 'GENERAL' })
      const results = await Promise.allSettled([
        memories.correct(userA.id, candidate.id, {
          value: { mode: 'concise' },
          now: new Date(now.getTime() + 1_000),
          source: 'USER_COMMAND',
          topic: 'GENERAL',
        }),
        memories.correct(userA.id, candidate.id, {
          value: { mode: 'detailed' },
          now: new Date(now.getTime() + 1_000),
          source: 'USER_COMMAND',
          topic: 'GENERAL',
        }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(await client.aiUserMemory.count({ where: { userId: userA.id, key: candidate.key, version: 2 } })).toBe(1)
      expect(
        await client.aiUserMemory.count({
          where: { userId: userA.id, key: candidate.key, status: AiMemoryStatus.CONFIRMED },
        }),
      ).toBe(1)
    })
  })

  async function createUser(prefix: string): Promise<User> {
    return client.user.create({
      data: {
        account: `${prefix}_${randomUUID()}`,
        password: 'integration-test-only',
        nickname: prefix,
      },
    })
  }

  async function createConversationFixture(
    userId: number,
    messageCount: number,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const conversation = await client.aiConversation.create({
      data: {
        userId,
        title: `memory fixture ${randomUUID()}`,
        clientRequestId: randomUUID(),
      },
    })
    const start = Date.parse('2026-07-21T01:00:00.000Z')
    const messages: AiMessage[] = []
    for (let index = 0; index < messageCount; index += 1) {
      const createdAt = new Date(start + index * 1_000)
      messages.push(
        await client.aiMessage.create({
          data: {
            userId,
            conversationId: conversation.id,
            role: index % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT,
            status: AiMessageStatus.COMPLETED,
            contentText: `message ${index + 1}`,
            contentBlocks: [],
            clientRequestId: randomUUID(),
            createdAt,
            completedAt: createdAt,
          },
        }),
      )
    }
    return { conversation, messages }
  }

  function summaryCommand(messages: AiMessage[], promptVersionId: string) {
    return {
      expectedSummaryVersion: 0,
      fromMessageId: messages[0].id,
      throughMessageId: messages.at(-1)!.id,
      summaryText: '测试摘要',
      facts: [{ claim: '可追溯事实', sourceMessageId: messages[0].id }],
      sourceMessageIds: messages.map((message) => message.id),
      promptVersionId,
      modelName: 'fake-summary-model',
      sourceTokenCount: 50,
      contentHash: HASH_A,
    }
  }

  async function createCandidate(userId: number, category: AiMemoryCategory) {
    return memories.createCandidate(userId, {
      category,
      key: `${category.toLowerCase()}.${randomUUID()}`,
      value: { style: 'concise' },
      sensitivity:
        category === AiMemoryCategory.CONSTRAINT ? AiMemorySensitivity.FINANCIAL : AiMemorySensitivity.NORMAL,
      confidence: 0.8,
      topic: 'GENERAL',
    })
  }
})

jest.setTimeout(300_000)
