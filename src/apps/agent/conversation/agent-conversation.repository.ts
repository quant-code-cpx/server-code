import { Injectable } from '@nestjs/common'
import { AiConversationStatus, AiModelPolicy, Prisma } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  AgentConversationNotFoundError,
  AgentConversationValidationError,
  AgentIdempotencyConflictError,
} from './agent-conversation.errors'
import type {
  CreateConversationCommand,
  CursorPage,
  ListConversationsQuery,
  PersistedAiConversation,
} from './agent-conversation.types'
import { decodeDateIdCursor, encodeDateIdCursor, validatePageLimit } from './agent-conversation.utils'

@Injectable()
export class AgentConversationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async createConversation(userId: number, command: CreateConversationCommand): Promise<PersistedAiConversation> {
    const startedAt = Date.now()
    const normalized = this.normalizeCreateCommand(command)
    const existing = await this.findByClientRequestId(userId, normalized.clientRequestId)
    if (existing) return this.resolveIdempotentCreate(existing, normalized, startedAt)

    try {
      const conversation = await this.prisma.aiConversation.create({
        data: {
          userId,
          clientRequestId: normalized.clientRequestId,
          title: normalized.title,
          modelPolicy: normalized.modelPolicy,
          preferredModel: normalized.preferredModel,
        },
      })
      this.logOperation('createConversation', startedAt, 1)
      return conversation
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error
      const raced = await this.findByClientRequestId(userId, normalized.clientRequestId)
      if (!raced) throw error
      return this.resolveIdempotentCreate(raced, normalized, startedAt)
    }
  }

  async findById(userId: number, conversationId: string): Promise<PersistedAiConversation> {
    const startedAt = Date.now()
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
    })
    this.logOperation('findById', startedAt, conversation ? 1 : 0)
    if (!conversation) throw new AgentConversationNotFoundError()
    return conversation
  }

  async listByCursor(userId: number, query: ListConversationsQuery): Promise<CursorPage<PersistedAiConversation>> {
    validatePageLimit(query.limit, 100)
    const startedAt = Date.now()
    const cursor = query.cursor ? decodeDateIdCursor(query.cursor) : null
    const status = query.includeArchived
      ? { in: [AiConversationStatus.ACTIVE, AiConversationStatus.ARCHIVED] }
      : AiConversationStatus.ACTIVE
    const rows = await this.prisma.aiConversation.findMany({
      where: {
        userId,
        status,
        ...(cursor
          ? {
              OR: [{ lastMessageAt: { lt: cursor.at } }, { lastMessageAt: cursor.at, id: { lt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit)
    const tail = items.at(-1)
    this.logOperation('listByCursor', startedAt, items.length)
    return {
      items,
      nextCursor: hasMore && tail ? encodeDateIdCursor(tail.lastMessageAt, tail.id) : null,
    }
  }

  async archiveConversation(userId: number, conversationId: string): Promise<PersistedAiConversation> {
    const startedAt = Date.now()
    const archivedAt = new Date()
    const result = await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId, status: AiConversationStatus.ACTIVE },
      data: {
        status: AiConversationStatus.ARCHIVED,
        archivedAt,
        statusVersion: { increment: 1 },
      },
    })
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
    })
    this.logOperation('archiveConversation', startedAt, result.count)
    if (!conversation) throw new AgentConversationNotFoundError()
    return conversation
  }

  async updateModelPolicy(
    userId: number,
    conversationId: string,
    modelPolicy: AiModelPolicy,
    preferredModel: string | null,
  ): Promise<PersistedAiConversation> {
    const startedAt = Date.now()
    const result = await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
      data: { modelPolicy, preferredModel },
    })
    if (result.count !== 1) throw new AgentConversationNotFoundError()
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
    })
    if (!conversation) throw new AgentConversationNotFoundError()
    this.logOperation('updateModelPolicy', startedAt, 1)
    return conversation
  }

  private normalizeCreateCommand(command: CreateConversationCommand): CreateConversationCommand {
    const clientRequestId = command.clientRequestId.trim()
    const title = command.title.trim()
    const preferredModel = command.preferredModel?.trim() || null
    if (!clientRequestId) throw new AgentConversationValidationError('clientRequestId 不能为空')
    if (!title) throw new AgentConversationValidationError('会话标题不能为空')
    if (command.modelPolicy === 'MANUAL' && !preferredModel) {
      throw new AgentConversationValidationError('MANUAL modelPolicy 必须指定 preferredModel')
    }
    return {
      clientRequestId,
      title,
      modelPolicy: command.modelPolicy,
      preferredModel,
    }
  }

  private findByClientRequestId(userId: number, clientRequestId: string) {
    return this.prisma.aiConversation.findFirst({ where: { userId, clientRequestId } })
  }

  private resolveIdempotentCreate(
    existing: PersistedAiConversation,
    command: CreateConversationCommand,
    startedAt: number,
  ): PersistedAiConversation {
    if (
      existing.title !== command.title ||
      existing.modelPolicy !== command.modelPolicy ||
      existing.preferredModel !== command.preferredModel
    ) {
      this.logger.warn(
        { operation: 'createConversation', durationMs: Date.now() - startedAt, conflict: true, rowCount: 0 },
        AgentConversationRepository.name,
      )
      throw new AgentIdempotencyConflictError()
    }
    this.logOperation('createConversation', startedAt, 0)
    return existing
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, AgentConversationRepository.name)
  }
}
