import { Injectable } from '@nestjs/common'
import { AiConversationStatus, AiMemoryCategory, AiMemorySensitivity, AiMemoryStatus, Prisma } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  assertMemoryCandidateAllowed,
  assertMemoryWriteAllowed,
  resolveMemoryExpiry,
  type MemoryPolicySource,
  type MemoryPolicyTopic,
} from './memory-policy'
import {
  AgentMemoryConflictError,
  AgentMemoryNotFoundError,
  AgentMemoryValidationError,
} from './memory-repository.errors'

export interface CreateMemoryCandidateCommand {
  category: AiMemoryCategory
  key: string
  value: Prisma.InputJsonValue
  sensitivity: AiMemorySensitivity
  sourceConversationId?: string | null
  sourceMessageId?: string | null
  confidence?: number
  topic: MemoryPolicyTopic
}

export interface ConfirmMemoryCommand {
  now: Date
  expiresAt?: Date
  sensitivity?: AiMemorySensitivity
  source: MemoryPolicySource
  topic: MemoryPolicyTopic
}

export interface CorrectMemoryCommand extends ConfirmMemoryCommand {
  value: Prisma.InputJsonValue
  sourceConversationId?: string | null
  sourceMessageId?: string | null
  confidence?: number
}

export type CreateConfirmedMemoryCommand = CreateMemoryCandidateCommand &
  Omit<ConfirmMemoryCommand, 'sensitivity'> & { confirmedByUser: true }

export interface ListManagedMemoriesQuery {
  cursor: string | null
  limit: number
  includeInactive: boolean
  now: Date
}

export interface ManagedMemoryPage {
  items: PersistedUserMemory[]
  nextCursor: string | null
}

export type PersistedUserMemory = Prisma.AiUserMemoryGetPayload<Record<string, never>>

@Injectable()
export class UserMemoryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async createCandidate(userId: number, command: CreateMemoryCandidateCommand): Promise<PersistedUserMemory> {
    const startedAt = Date.now()
    const normalized = this.normalizeCandidate(command)
    assertMemoryCandidateAllowed({
      category: normalized.category,
      sensitivity: normalized.sensitivity,
      topic: normalized.topic,
    })
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertSourceOwnership(tx, userId, normalized.sourceConversationId, normalized.sourceMessageId)
      return tx.aiUserMemory.create({
        data: {
          userId,
          category: normalized.category,
          key: normalized.key,
          value: normalized.value,
          sensitivity: normalized.sensitivity,
          status: AiMemoryStatus.CANDIDATE,
          sourceConversationId: normalized.sourceConversationId,
          sourceMessageId: normalized.sourceMessageId,
          confidence: normalized.confidence,
          version: 1,
        },
      })
    })
    this.logOperation('createCandidate', startedAt, 1)
    return created
  }

  async createConfirmed(userId: number, command: CreateConfirmedMemoryCommand): Promise<PersistedUserMemory> {
    const startedAt = Date.now()
    const normalized = this.normalizeCandidate(command)
    assertMemoryWriteAllowed({
      category: normalized.category,
      sensitivity: normalized.sensitivity,
      source: command.source,
      topic: normalized.topic,
      confirmedByUser: command.confirmedByUser,
    })
    const expiresAt = resolveMemoryExpiry(normalized.category, command.now, command.expiresAt)
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.lockMemoryKey(tx, userId, normalized.category, normalized.key)
        await this.assertSourceOwnership(tx, userId, normalized.sourceConversationId, normalized.sourceMessageId)
        await tx.aiUserMemory.updateMany({
          where: {
            userId,
            category: normalized.category,
            key: normalized.key,
            status: AiMemoryStatus.CONFIRMED,
            deletedAt: null,
            expiresAt: { lte: command.now },
          },
          data: { status: AiMemoryStatus.EXPIRED },
        })
        const versions = await tx.aiUserMemory.aggregate({
          where: {
            userId,
            category: normalized.category,
            key: normalized.key,
            status: { not: AiMemoryStatus.CANDIDATE },
          },
          _max: { version: true },
        })
        return tx.aiUserMemory.create({
          data: {
            userId,
            category: normalized.category,
            key: normalized.key,
            value: normalized.value,
            sensitivity: normalized.sensitivity,
            status: AiMemoryStatus.CONFIRMED,
            sourceConversationId: normalized.sourceConversationId,
            sourceMessageId: normalized.sourceMessageId,
            confidence: normalized.confidence,
            version: (versions._max.version ?? 0) + 1,
            validFrom: command.now,
            confirmedAt: command.now,
            expiresAt,
          },
        })
      })
      this.logOperation('createConfirmed', startedAt, 1)
      return created
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new AgentMemoryConflictError('同类别和 key 已存在 active 记忆')
      throw error
    }
  }

  async confirm(userId: number, memoryId: string, command: ConfirmMemoryCommand): Promise<PersistedUserMemory> {
    const startedAt = Date.now()
    try {
      const confirmed = await this.prisma.$transaction(async (tx) => {
        await this.lockMemory(tx, memoryId)
        const memory = await tx.aiUserMemory.findFirst({ where: { id: memoryId, userId } })
        if (!memory) throw new AgentMemoryNotFoundError()
        if (memory.status !== AiMemoryStatus.CANDIDATE || memory.deletedAt) throw new AgentMemoryConflictError()
        await this.lockMemoryKey(tx, userId, memory.category, memory.key)
        const sensitivity = command.sensitivity ?? memory.sensitivity
        assertMemoryWriteAllowed({
          category: memory.category,
          sensitivity,
          source: command.source,
          topic: command.topic,
          confirmedByUser: true,
        })
        const expiresAt = resolveMemoryExpiry(memory.category, command.now, command.expiresAt)
        await tx.aiUserMemory.updateMany({
          where: {
            userId,
            category: memory.category,
            key: memory.key,
            status: AiMemoryStatus.CONFIRMED,
            deletedAt: null,
            expiresAt: { lte: command.now },
          },
          data: { status: AiMemoryStatus.EXPIRED },
        })
        const priorVersions = await tx.aiUserMemory.aggregate({
          where: {
            userId,
            category: memory.category,
            key: memory.key,
            id: { not: memory.id },
            status: { not: AiMemoryStatus.CANDIDATE },
          },
          _max: { version: true },
        })
        const updated = await tx.aiUserMemory.updateMany({
          where: { id: memoryId, userId, status: AiMemoryStatus.CANDIDATE, deletedAt: null },
          data: {
            sensitivity,
            status: AiMemoryStatus.CONFIRMED,
            version: (priorVersions._max.version ?? 0) + 1,
            validFrom: command.now,
            confirmedAt: command.now,
            expiresAt,
          },
        })
        if (updated.count !== 1) throw new AgentMemoryConflictError()
        return tx.aiUserMemory.findUniqueOrThrow({ where: { id: memoryId } })
      })
      this.logOperation('confirm', startedAt, 1)
      return confirmed
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new AgentMemoryConflictError('同类别和 key 已存在 active 记忆')
      throw error
    }
  }

  async listActive(userId: number, now: Date): Promise<PersistedUserMemory[]> {
    requireValidDate(now, '当前时间')
    const startedAt = Date.now()
    const rows = await this.prisma.aiUserMemory.findMany({
      where: {
        userId,
        status: AiMemoryStatus.CONFIRMED,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    })
    this.logOperation('listActive', startedAt, rows.length)
    return rows
  }

  async listManaged(userId: number, query: ListManagedMemoriesQuery): Promise<ManagedMemoryPage> {
    requireValidDate(query.now, '当前时间')
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new AgentMemoryValidationError('分页 limit 必须为 1–100 的整数')
    }
    const cursor = query.cursor ? decodeMemoryCursor(query.cursor) : null
    const startedAt = Date.now()
    const rows = await this.prisma.aiUserMemory.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(query.includeInactive
          ? {}
          : {
              status: AiMemoryStatus.CONFIRMED,
              expiresAt: { gt: query.now },
            }),
        ...(cursor
          ? {
              OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const tail = items.at(-1)
    this.logOperation('listManaged', startedAt, items.length)
    return {
      items,
      nextCursor: hasMore && tail ? encodeMemoryCursor(tail.updatedAt, tail.id) : null,
    }
  }

  async listHistory(userId: number, category: AiMemoryCategory, key: string): Promise<PersistedUserMemory[]> {
    const normalizedKey = normalizeKey(key)
    const startedAt = Date.now()
    const rows = await this.prisma.aiUserMemory.findMany({
      where: { userId, category, key: normalizedKey },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    })
    this.logOperation('listHistory', startedAt, rows.length)
    return rows
  }

  async correct(userId: number, memoryId: string, command: CorrectMemoryCommand): Promise<PersistedUserMemory> {
    const startedAt = Date.now()
    validateJsonValue(command.value)
    const confidence = command.confidence == null ? undefined : normalizeConfidence(command.confidence)
    try {
      const corrected = await this.prisma.$transaction(async (tx) => {
        await this.lockMemory(tx, memoryId)
        const memory = await tx.aiUserMemory.findFirst({ where: { id: memoryId, userId } })
        if (!memory) throw new AgentMemoryNotFoundError()
        if (
          memory.status !== AiMemoryStatus.CONFIRMED ||
          memory.deletedAt ||
          !memory.expiresAt ||
          memory.expiresAt.getTime() <= command.now.getTime()
        ) {
          throw new AgentMemoryConflictError('只有 active 确认记忆可以纠错')
        }
        await this.lockMemoryKey(tx, userId, memory.category, memory.key)

        const sensitivity = command.sensitivity ?? memory.sensitivity
        assertMemoryWriteAllowed({
          category: memory.category,
          sensitivity,
          source: command.source,
          topic: command.topic,
          confirmedByUser: true,
        })
        const expiresAt = resolveMemoryExpiry(memory.category, command.now, command.expiresAt)
        const sourceConversationId =
          command.sourceConversationId === undefined ? memory.sourceConversationId : command.sourceConversationId
        const sourceMessageId = command.sourceMessageId === undefined ? memory.sourceMessageId : command.sourceMessageId
        await this.assertSourceOwnership(tx, userId, sourceConversationId, sourceMessageId)

        const revoked = await tx.aiUserMemory.updateMany({
          where: {
            id: memoryId,
            userId,
            status: AiMemoryStatus.CONFIRMED,
            version: memory.version,
            deletedAt: null,
          },
          data: { status: AiMemoryStatus.REVOKED, revokedAt: command.now },
        })
        if (revoked.count !== 1) throw new AgentMemoryConflictError()

        return tx.aiUserMemory.create({
          data: {
            userId,
            category: memory.category,
            key: memory.key,
            value: command.value,
            sensitivity,
            status: AiMemoryStatus.CONFIRMED,
            sourceConversationId,
            sourceMessageId,
            confidence: confidence ?? memory.confidence,
            version: memory.version + 1,
            validFrom: command.now,
            confirmedAt: command.now,
            expiresAt,
          },
        })
      })
      this.logOperation('correct', startedAt, 1)
      return corrected
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new AgentMemoryConflictError('记忆版本或 active key 冲突')
      throw error
    }
  }

  async revoke(userId: number, memoryId: string, now: Date): Promise<PersistedUserMemory> {
    requireValidDate(now, '撤销时间')
    const startedAt = Date.now()
    const revoked = await this.prisma.$transaction(async (tx) => {
      await this.lockMemory(tx, memoryId)
      const memory = await tx.aiUserMemory.findFirst({ where: { id: memoryId, userId } })
      if (!memory) throw new AgentMemoryNotFoundError()
      if (memory.status === AiMemoryStatus.REVOKED) return memory
      return tx.aiUserMemory.update({
        where: { id: memoryId },
        data: { status: AiMemoryStatus.REVOKED, revokedAt: now },
      })
    })
    this.logOperation('revoke', startedAt, 1)
    return revoked
  }

  async softDelete(userId: number, memoryId: string, now: Date): Promise<PersistedUserMemory> {
    requireValidDate(now, '删除时间')
    const startedAt = Date.now()
    const deleted = await this.prisma.$transaction(async (tx) => {
      await this.lockMemory(tx, memoryId)
      const memory = await tx.aiUserMemory.findFirst({ where: { id: memoryId, userId } })
      if (!memory) throw new AgentMemoryNotFoundError()
      if (memory.deletedAt) return memory
      return tx.aiUserMemory.update({
        where: { id: memoryId },
        data: {
          status: AiMemoryStatus.REVOKED,
          revokedAt: memory.revokedAt ?? now,
          deletedAt: now,
        },
      })
    })
    this.logOperation('softDelete', startedAt, 1)
    return deleted
  }

  private normalizeCandidate(command: CreateMemoryCandidateCommand): Required<
    Omit<CreateMemoryCandidateCommand, 'sourceConversationId' | 'sourceMessageId' | 'confidence'>
  > & {
    sourceConversationId: string | null
    sourceMessageId: string | null
    confidence: number
  } {
    validateJsonValue(command.value)
    return {
      ...command,
      key: normalizeKey(command.key),
      sourceConversationId: normalizeOptionalId(command.sourceConversationId),
      sourceMessageId: normalizeOptionalId(command.sourceMessageId),
      confidence: normalizeConfidence(command.confidence ?? 1),
    }
  }

  private async assertSourceOwnership(
    tx: Prisma.TransactionClient,
    userId: number,
    sourceConversationId: string | null,
    sourceMessageId: string | null,
  ): Promise<void> {
    if (sourceMessageId && !sourceConversationId) {
      throw new AgentMemoryValidationError('sourceMessageId 必须同时提供 sourceConversationId')
    }
    if (!sourceConversationId) return
    const conversation = await tx.aiConversation.findFirst({
      where: { id: sourceConversationId, userId, status: { not: AiConversationStatus.DELETED } },
      select: { id: true },
    })
    if (!conversation) throw new AgentMemoryValidationError('记忆来源不属于当前用户')
    if (!sourceMessageId) return
    const message = await tx.aiMessage.findFirst({
      where: { id: sourceMessageId, userId, conversationId: sourceConversationId },
      select: { id: true },
    })
    if (!message) throw new AgentMemoryValidationError('记忆来源消息不属于指定用户会话')
  }

  private lockMemory(tx: Prisma.TransactionClient, memoryId: string): Promise<number> {
    return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${memoryId}, 0))`)
  }

  private lockMemoryKey(
    tx: Prisma.TransactionClient,
    userId: number,
    category: AiMemoryCategory,
    key: string,
  ): Promise<number> {
    const lockKey = `memory:${userId}:${category}:${key}`
    return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, UserMemoryRepository.name)
  }
}

function normalizeKey(value: string): string {
  const key = value?.trim()
  if (!key || !/^[a-z][a-z0-9_.-]{1,127}$/.test(key)) {
    throw new AgentMemoryValidationError('记忆 key 格式无效')
  }
  return key
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (value == null) return null
  const normalized = value.trim()
  return normalized || null
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new AgentMemoryValidationError('confidence 必须位于 0 到 1')
  }
  return value
}

function validateJsonValue(value: Prisma.InputJsonValue): void {
  if (value == null) throw new AgentMemoryValidationError('记忆 value 不能为空')
}

function requireValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AgentMemoryValidationError(`${field}无效`)
  }
}

function encodeMemoryCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url')
}

function decodeMemoryCursor(cursor: string): { at: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<{
      at: string
      id: string
    }>
    const at = new Date(decoded.at ?? '')
    if (!decoded.id || !Number.isFinite(at.getTime())) throw new AgentMemoryValidationError('记忆分页游标无效')
    return { at, id: decoded.id }
  } catch (error) {
    if (error instanceof AgentMemoryValidationError) throw error
    throw new AgentMemoryValidationError('记忆分页游标无效')
  }
}
