import { Injectable } from '@nestjs/common'
import { AiConversationStatus, AiMessageRole, AiMessageStatus, Prisma } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  AgentConversationArchivedError,
  AgentConversationNotFoundError,
  AgentIdempotencyConflictError,
  AgentMessageValidationError,
  AgentStoredMessageInvalidError,
} from './agent-conversation.errors'
import type {
  AppendMessageCommand,
  CreateAssistantVersionCommand,
  CursorPage,
  ListMessagesQuery,
  PersistedAiMessage,
} from './agent-conversation.types'
import {
  canonicalJson,
  decodeDateIdCursor,
  decodeStoredMessageBlocks,
  encodeDateIdCursor,
  toJsonInput,
  validateMessageBlocks,
  validatePageLimit,
} from './agent-conversation.utils'

@Injectable()
export class AgentMessageRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async appendMessage(
    userId: number,
    conversationId: string,
    command: AppendMessageCommand,
  ): Promise<PersistedAiMessage> {
    const startedAt = Date.now()
    const normalized = this.normalizeAppendCommand(command)
    const existing = normalized.clientRequestId
      ? await this.findByClientRequestId(userId, conversationId, normalized.clientRequestId)
      : null
    if (existing) return this.resolveIdempotentMessage(existing, normalized, startedAt)

    try {
      const message = await this.prisma.$transaction(async (tx) => {
        await this.assertWritableConversation(tx, userId, conversationId)
        await this.assertParentBelongsToConversation(tx, userId, conversationId, normalized.parentMessageId)
        const createdAt = new Date()
        const created = await tx.aiMessage.create({
          data: {
            userId,
            conversationId,
            role: normalized.role,
            status: normalized.status,
            contentText: normalized.contentText,
            contentBlocks: toJsonInput(normalized.contentBlocks),
            parentMessageId: normalized.parentMessageId,
            version: normalized.version,
            clientRequestId: normalized.clientRequestId,
            modelName: normalized.modelName,
            tokenCount: normalized.tokenCount,
            completedAt: normalized.completedAt,
            createdAt,
          },
        })
        const updated = await tx.aiConversation.updateMany({
          where: { id: conversationId, userId, status: AiConversationStatus.ACTIVE },
          data: { lastMessageAt: createdAt, messageCount: { increment: 1 } },
        })
        if (updated.count !== 1) throw new AgentConversationArchivedError()
        return created
      })
      this.logOperation('appendMessage', startedAt, 1)
      return this.decodeMessage(message)
    } catch (error) {
      if (!this.isUniqueConstraintError(error) || !normalized.clientRequestId) throw error
      const raced = await this.findByClientRequestId(userId, conversationId, normalized.clientRequestId)
      if (!raced) throw error
      return this.resolveIdempotentMessage(raced, normalized, startedAt)
    }
  }

  async listMessages(
    userId: number,
    conversationId: string,
    query: ListMessagesQuery,
  ): Promise<CursorPage<PersistedAiMessage>> {
    validatePageLimit(query.limit, 100)
    const startedAt = Date.now()
    await this.assertConversationReadable(userId, conversationId)
    const cursor = query.cursor ? decodeDateIdCursor(query.cursor) : null
    const rows = await this.prisma.aiMessage.findMany({
      where: {
        userId,
        conversationId,
        ...(cursor
          ? {
              OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const hasMore = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const tail = pageRows.at(-1)
    const items = pageRows.reverse().map((row) => this.decodeMessage(row))
    this.logOperation('listMessages', startedAt, items.length)
    return {
      items,
      nextCursor: hasMore && tail ? encodeDateIdCursor(tail.createdAt, tail.id) : null,
    }
  }

  async createAssistantVersion(
    userId: number,
    sourceMessageId: string,
    command: CreateAssistantVersionCommand,
  ): Promise<PersistedAiMessage> {
    const startedAt = Date.now()
    const clientRequestId = command.clientRequestId.trim()
    if (!clientRequestId) throw new AgentMessageValidationError('clientRequestId 不能为空')
    const message = await this.prisma.$transaction(async (tx) => {
      const source = await tx.aiMessage.findFirst({ where: { id: sourceMessageId, userId } })
      if (!source) throw new AgentConversationNotFoundError()
      if (source.role !== AiMessageRole.ASSISTANT || !source.parentMessageId) {
        throw new AgentMessageValidationError('只能为已有 assistant message 创建新版本')
      }
      await this.assertWritableConversation(tx, userId, source.conversationId)
      await this.assertParentBelongsToConversation(tx, userId, source.conversationId, source.parentMessageId)
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${source.parentMessageId}, 0))`)

      const existing = await tx.aiMessage.findFirst({
        where: { conversationId: source.conversationId, userId, clientRequestId },
      })
      if (existing) {
        if (
          existing.role !== AiMessageRole.ASSISTANT ||
          existing.parentMessageId !== source.parentMessageId ||
          existing.modelName !== (command.modelName?.trim() || null)
        ) {
          throw new AgentIdempotencyConflictError()
        }
        return existing
      }

      const aggregate = await tx.aiMessage.aggregate({
        where: { parentMessageId: source.parentMessageId },
        _max: { version: true },
      })
      const createdAt = new Date()
      const created = await tx.aiMessage.create({
        data: {
          userId,
          conversationId: source.conversationId,
          role: AiMessageRole.ASSISTANT,
          status: AiMessageStatus.PENDING,
          contentBlocks: [],
          parentMessageId: source.parentMessageId,
          version: (aggregate._max.version ?? 0) + 1,
          clientRequestId,
          modelName: command.modelName?.trim() || null,
          createdAt,
        },
      })
      await tx.aiConversation.update({
        where: { id: source.conversationId },
        data: { lastMessageAt: createdAt, messageCount: { increment: 1 } },
      })
      return created
    })
    this.logOperation('createAssistantVersion', startedAt, 1)
    return this.decodeMessage(message)
  }

  private normalizeAppendCommand(command: AppendMessageCommand): AppendMessageCommand & { contentBlocks: unknown[] } {
    const contentBlocks = validateMessageBlocks(command.contentBlocks)
    const contentText = command.contentText?.trim() || null
    const version = command.version ?? 1
    if (!Number.isInteger(version) || version < 1) throw new AgentMessageValidationError('消息 version 必须为正整数')
    if (command.tokenCount != null && (!Number.isInteger(command.tokenCount) || command.tokenCount < 0)) {
      throw new AgentMessageValidationError('tokenCount 必须为非负整数')
    }
    if (command.status === AiMessageStatus.COMPLETED && !contentText && contentBlocks.length === 0) {
      throw new AgentMessageValidationError('完成消息必须包含文本或内容块')
    }
    return {
      ...command,
      clientRequestId: command.clientRequestId?.trim() || null,
      contentText,
      contentBlocks,
      parentMessageId: command.parentMessageId ?? null,
      version,
      modelName: command.modelName?.trim() || null,
      tokenCount: command.tokenCount ?? null,
      completedAt: command.status === AiMessageStatus.COMPLETED ? (command.completedAt ?? new Date()) : null,
    }
  }

  private async assertWritableConversation(
    tx: Prisma.TransactionClient,
    userId: number,
    conversationId: string,
  ): Promise<void> {
    const conversation = await tx.aiConversation.findFirst({ where: { id: conversationId, userId } })
    if (!conversation || conversation.status === AiConversationStatus.DELETED) {
      throw new AgentConversationNotFoundError()
    }
    if (conversation.status !== AiConversationStatus.ACTIVE) throw new AgentConversationArchivedError()
  }

  private async assertConversationReadable(userId: number, conversationId: string): Promise<void> {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
      select: { id: true },
    })
    if (!conversation) throw new AgentConversationNotFoundError()
  }

  private async assertParentBelongsToConversation(
    tx: Prisma.TransactionClient,
    userId: number,
    conversationId: string,
    parentMessageId: string | null | undefined,
  ): Promise<void> {
    if (!parentMessageId) return
    const parent = await tx.aiMessage.findFirst({
      where: { id: parentMessageId, userId, conversationId },
      select: { id: true },
    })
    if (!parent) throw new AgentMessageValidationError('parentMessageId 不属于当前用户会话')
  }

  private findByClientRequestId(userId: number, conversationId: string, clientRequestId: string) {
    return this.prisma.aiMessage.findFirst({ where: { userId, conversationId, clientRequestId } })
  }

  private resolveIdempotentMessage(
    existing: Prisma.AiMessageGetPayload<Record<string, never>>,
    command: AppendMessageCommand & { contentBlocks: unknown[] },
    startedAt: number,
  ): PersistedAiMessage {
    const storedBlocks = decodeStoredMessageBlocks(existing.contentBlocks, existing.id)
    if (
      existing.role !== command.role ||
      existing.status !== command.status ||
      existing.contentText !== command.contentText ||
      existing.parentMessageId !== command.parentMessageId ||
      existing.version !== command.version ||
      existing.modelName !== command.modelName ||
      existing.tokenCount !== command.tokenCount ||
      canonicalJson(storedBlocks) !== canonicalJson(command.contentBlocks)
    ) {
      this.logger.warn(
        { operation: 'appendMessage', durationMs: Date.now() - startedAt, conflict: true, rowCount: 0 },
        AgentMessageRepository.name,
      )
      throw new AgentIdempotencyConflictError()
    }
    this.logOperation('appendMessage', startedAt, 0)
    return { ...existing, contentBlocks: storedBlocks }
  }

  private decodeMessage(message: Prisma.AiMessageGetPayload<Record<string, never>>): PersistedAiMessage {
    if (message.contentSchemaVersion !== 1) {
      throw new AgentStoredMessageInvalidError(message.id)
    }
    return { ...message, contentBlocks: decodeStoredMessageBlocks(message.contentBlocks, message.id) }
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, AgentMessageRepository.name)
  }
}
