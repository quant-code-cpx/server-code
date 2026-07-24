import { createHash } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { AiMemoryCategory, AiMemorySensitivity, AiMemoryStatus, Prisma } from '@prisma/client'
import { ConversationSummaryRepository } from '../conversation-summary.repository'
import { ConversationSummaryService } from '../conversation-summary.service'
import { AgentConfirmationRequiredError, AgentMemoryValidationError } from '../memory-repository.errors'
import { UserMemoryRepository } from '../user-memory.repository'
import { UserMemoryService } from '../user-memory.service'

const now = new Date('2026-07-21T08:00:00.000Z')

describe('ConversationSummaryService', () => {
  let service: ConversationSummaryService
  let repository: { createAndAdvance: jest.Mock; findCurrent: jest.Mock }

  beforeEach(async () => {
    repository = { createAndAdvance: jest.fn(), findCurrent: jest.fn() }
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationSummaryService, { provide: ConversationSummaryRepository, useValue: repository }],
    }).compile()
    service = moduleRef.get(ConversationSummaryService)
  })

  it('规范化摘要并由服务端计算稳定 SHA-256', async () => {
    repository.createAndAdvance.mockImplementation(async (_userId, _conversationId, command) => ({
      id: 'summary_1',
      conversationId: 'conversation_1',
      version: 1,
      createdAt: now,
      ...command,
    }))
    const input = {
      expectedSummaryVersion: 0,
      fromMessageId: 'message_1',
      throughMessageId: 'message_2',
      summaryText: '  用户关注红利策略  ',
      facts: [{ sourceMessageId: 'message_1', claim: '风险偏好稳健' }],
      sourceMessageIds: ['message_1', 'message_2'],
      promptVersionId: 'prompt_1',
      modelName: 'summary-model',
      sourceTokenCount: 100,
    }

    await service.commit(7, 'conversation_1', input)

    const expectedCanonical = JSON.stringify({
      facts: [{ claim: '风险偏好稳健', sourceMessageId: 'message_1' }],
      sourceMessageIds: ['message_1', 'message_2'],
      summaryText: '用户关注红利策略',
    })
    expect(repository.createAndAdvance).toHaveBeenCalledWith(
      7,
      'conversation_1',
      expect.objectContaining({
        summaryText: '用户关注红利策略',
        contentHash: createHash('sha256').update(expectedCanonical).digest('hex'),
      }),
    )
  })

  it('facts 对象字段顺序不改变摘要 hash', async () => {
    repository.createAndAdvance.mockImplementation(async (_userId, _conversationId, command) => command)
    const base = {
      expectedSummaryVersion: 0,
      fromMessageId: 'message_1',
      throughMessageId: 'message_1',
      summaryText: '摘要',
      sourceMessageIds: ['message_1'],
      promptVersionId: 'prompt_1',
      modelName: 'summary-model',
      sourceTokenCount: 10,
    }
    const first = await service.commit(7, 'conversation_1', {
      ...base,
      facts: [{ claim: '事实', sourceMessageId: 'message_1' }],
    })
    const second = await service.commit(7, 'conversation_1', {
      ...base,
      facts: [{ sourceMessageId: 'message_1', claim: '事实' }],
    })

    expect(first.contentHash).toBe(second.contentHash)
  })

  it('currentMetadata 只返回公开 metadata，不返回摘要正文、facts 或 sourceMessageIds', async () => {
    repository.findCurrent.mockResolvedValue({
      id: 'summary_1',
      conversationId: 'conversation_1',
      fromMessageId: 'message_1',
      throughMessageId: 'message_2',
      version: 3,
      summaryText: '不可公开正文',
      facts: [{ secret: true }],
      sourceMessageIds: ['message_1', 'message_2'],
      promptVersionId: 'prompt_1',
      modelName: 'summary-model',
      sourceTokenCount: 100,
      contentHash: 'a'.repeat(64),
      createdAt: now,
    })

    const metadata = await service.currentMetadata(7, 'conversation_1')

    expect(metadata).toEqual({
      summaryId: 'summary_1',
      version: 3,
      fromMessageId: 'message_1',
      throughMessageId: 'message_2',
      promptVersionId: 'prompt_1',
      modelName: 'summary-model',
      sourceTokenCount: 100,
      contentHash: 'a'.repeat(64),
      createdAt: now.toISOString(),
    })
    expect(metadata).not.toHaveProperty('summaryText')
    expect(metadata).not.toHaveProperty('facts')
    expect(metadata).not.toHaveProperty('sourceMessageIds')
  })

  it('currentMetadata 无摘要时返回 null', async () => {
    repository.findCurrent.mockResolvedValue(null)
    await expect(service.currentMetadata(7, 'conversation_1')).resolves.toBeNull()
  })

  it('不可序列化 facts 映射摘要校验错误，不调用 Repository', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(
      service.commit(7, 'conversation_1', {
        expectedSummaryVersion: 0,
        fromMessageId: 'message_1',
        throughMessageId: 'message_1',
        summaryText: '摘要',
        facts: [cyclic] as never,
        sourceMessageIds: ['message_1'],
        promptVersionId: 'prompt_1',
        modelName: 'summary-model',
        sourceTokenCount: 10,
      }),
    ).rejects.toMatchObject({ code: 'AI_SUMMARY_VALIDATION_FAILED' })
    expect(repository.createAndAdvance).not.toHaveBeenCalled()
  })
})

describe('UserMemoryService', () => {
  let service: UserMemoryService
  let repository: {
    createConfirmed: jest.Mock
    listManaged: jest.Mock
    correct: jest.Mock
    softDelete: jest.Mock
  }

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now)
    repository = {
      createConfirmed: jest.fn(),
      listManaged: jest.fn(),
      correct: jest.fn(),
      softDelete: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [UserMemoryService, { provide: UserMemoryRepository, useValue: repository }],
    }).compile()
    service = moduleRef.get(UserMemoryService)
  })

  afterEach(() => jest.useRealTimers())

  it('显式创建使用原子 createConfirmed，来源固定 USER_COMMAND，响应不含 userId', async () => {
    repository.createConfirmed.mockResolvedValue(memoryRow())

    const result = await service.create(7, createInput())

    expect(repository.createConfirmed).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        source: 'USER_COMMAND',
        confirmedByUser: true,
        now,
      }),
    )
    expect(result).toMatchObject({ memoryId: 'memory_1', confidence: 0.9, version: 1 })
    expect(result).not.toHaveProperty('userId')
  })

  it('Service 防御性拒绝未确认 create/update，不调用 Repository', async () => {
    await expect(service.create(7, { ...createInput(), confirmation: false } as never)).rejects.toBeInstanceOf(
      AgentConfirmationRequiredError,
    )
    await expect(
      service.update(7, {
        memoryId: 'memory_1',
        value: { style: 'detailed' },
        topic: 'GENERAL',
        confirmation: false,
      } as never),
    ).rejects.toBeInstanceOf(AgentConfirmationRequiredError)
    expect(repository.createConfirmed).not.toHaveBeenCalled()
    expect(repository.correct).not.toHaveBeenCalled()
  })

  it('value 严格限制为 8192 bytes 和深度 8', async () => {
    repository.createConfirmed.mockResolvedValue(memoryRow())
    const exactValue = 'a'.repeat(8_190)
    await expect(service.create(7, createInput({ value: exactValue }))).resolves.toBeDefined()
    await expect(service.create(7, createInput({ value: `${exactValue}a` }))).rejects.toBeInstanceOf(
      AgentMemoryValidationError,
    )

    const depth8 = nestedValue(8)
    await expect(service.create(7, createInput({ value: depth8 }))).resolves.toBeDefined()
    await expect(service.create(7, createInput({ value: nestedValue(9) }))).rejects.toBeInstanceOf(
      AgentMemoryValidationError,
    )
  })

  it('声明 GENERAL 仍拒绝明显持仓、凭据、健康和政治内容', async () => {
    for (const [key, value] of [
      ['portfolio.position', { tsCode: '600519.SH', cost: 1_500 }],
      ['profile.notes', { password: 'secret-value' }],
      ['profile.health', { diagnosis: 'x' }],
      ['profile.notes', { text: '政治倾向推断' }],
    ] as const) {
      await expect(service.create(7, createInput({ key, value, topic: 'GENERAL' }))).rejects.toBeInstanceOf(
        AgentMemoryValidationError,
      )
    }
    expect(repository.createConfirmed).not.toHaveBeenCalled()
  })

  it('list/update/delete 映射稳定 DTO，并把当前时间传给 Repository', async () => {
    repository.listManaged.mockResolvedValue({ items: [memoryRow()], nextCursor: 'cursor_2' })
    repository.correct.mockResolvedValue(memoryRow({ id: 'memory_2', version: 2, value: { style: 'detailed' } }))
    repository.softDelete.mockResolvedValue(
      memoryRow({ status: AiMemoryStatus.REVOKED, deletedAt: now, revokedAt: now }),
    )

    await expect(service.list(7, { cursor: null, limit: 30, includeInactive: false })).resolves.toMatchObject({
      items: [expect.objectContaining({ memoryId: 'memory_1' })],
      nextCursor: 'cursor_2',
    })
    await expect(
      service.update(7, {
        memoryId: 'memory_1',
        value: { style: 'detailed' },
        topic: 'GENERAL',
        confirmation: true,
      }),
    ).resolves.toMatchObject({ memoryId: 'memory_2', version: 2 })
    await expect(service.delete(7, { memoryId: 'memory_1' })).resolves.toEqual({
      memoryId: 'memory_1',
      status: AiMemoryStatus.REVOKED,
      deletedAt: now.toISOString(),
    })
    expect(repository.listManaged).toHaveBeenCalledWith(7, expect.objectContaining({ now }))
    expect(repository.correct).toHaveBeenCalledWith(7, 'memory_1', expect.objectContaining({ now }))
    expect(repository.softDelete).toHaveBeenCalledWith(7, 'memory_1', now)
  })

  it('includeInactive 把到期但未清理的 CONFIRMED 行映射为 EXPIRED', async () => {
    repository.listManaged.mockResolvedValue({ items: [memoryRow({ expiresAt: now })], nextCursor: null })
    const result = await service.list(7, { cursor: null, limit: 30, includeInactive: true })
    expect(result.items[0].status).toBe(AiMemoryStatus.EXPIRED)
  })
})

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    category: AiMemoryCategory.PREFERENCE,
    key: 'response.style',
    value: { style: 'concise' },
    sensitivity: AiMemorySensitivity.NORMAL,
    sourceConversationId: null,
    sourceMessageId: null,
    confidence: 0.9,
    expiresAt: null,
    topic: 'GENERAL' as const,
    confirmation: true,
    ...overrides,
  }
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'memory_1',
    userId: 7,
    category: AiMemoryCategory.PREFERENCE,
    key: 'response.style',
    value: { style: 'concise' } as Prisma.JsonValue,
    sensitivity: AiMemorySensitivity.NORMAL,
    status: AiMemoryStatus.CONFIRMED,
    sourceConversationId: null,
    sourceMessageId: null,
    confidence: new Prisma.Decimal(0.9),
    version: 1,
    validFrom: now,
    confirmedAt: now,
    expiresAt: new Date('2027-07-21T08:00:00.000Z'),
    revokedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function nestedValue(depth: number): unknown {
  let value: unknown = 'leaf'
  for (let index = 0; index < depth; index += 1) value = { child: value }
  return value
}
