import { Injectable } from '@nestjs/common'
import {
  AiConversationStatus,
  AiMessageRole,
  AiMessageStatus,
  AiVersionStatus,
  Prisma,
  type AiPromptVersion,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentConversationNotFoundError } from '../conversation/agent-conversation.errors'
import { AgentSummaryValidationError, AgentSummaryVersionConflictError } from './memory-repository.errors'

export interface CreateConversationSummaryCommand {
  expectedSummaryVersion: number
  fromMessageId: string
  throughMessageId: string
  summaryText: string
  facts: Prisma.InputJsonValue[]
  sourceMessageIds: string[]
  promptVersionId: string
  modelName: string
  sourceTokenCount: number
  contentHash: string
}

export type PersistedConversationSummary = Prisma.AiConversationSummaryGetPayload<Record<string, never>>

export interface ConversationSummaryState {
  summaryVersion: number
  currentSummary: PersistedConversationSummary | null
}

interface MessagePosition {
  id: string
  createdAt: Date
  status: AiMessageStatus
  role: AiMessageRole
  version: number
}

@Injectable()
export class ConversationSummaryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async findCurrent(userId: number, conversationId: string): Promise<PersistedConversationSummary | null> {
    return (await this.findCurrentState(userId, conversationId)).currentSummary
  }

  async findCurrentState(userId: number, conversationId: string): Promise<ConversationSummaryState> {
    const startedAt = Date.now()
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
      select: { summaryVersion: true, currentSummary: true },
    })
    if (!conversation) throw new AgentConversationNotFoundError()
    this.logOperation('findCurrentState', startedAt, conversation.currentSummary ? 1 : 0)
    return conversation
  }

  async findPublishedPrompt(promptKey: string, version: number, contentHash: string): Promise<AiPromptVersion | null> {
    return this.prisma.aiPromptVersion.findFirst({
      where: { promptKey, version, contentHash, status: AiVersionStatus.PUBLISHED },
    })
  }

  async listHistory(userId: number, conversationId: string): Promise<PersistedConversationSummary[]> {
    const startedAt = Date.now()
    await this.assertConversationReadable(this.prisma, userId, conversationId)
    const rows = await this.prisma.aiConversationSummary.findMany({
      where: { conversationId },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
    })
    this.logOperation('listHistory', startedAt, rows.length)
    return rows
  }

  async createAndAdvance(
    userId: number,
    conversationId: string,
    command: CreateConversationSummaryCommand,
  ): Promise<PersistedConversationSummary> {
    const startedAt = Date.now()
    const normalized = this.normalizeCommand(command)
    try {
      const summary = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))`)
        const conversation = await this.assertConversationReadable(tx, userId, conversationId)
        if (conversation.summaryVersion !== normalized.expectedSummaryVersion) {
          throw new AgentSummaryVersionConflictError()
        }
        await this.assertMessageRange(tx, userId, conversationId, normalized)
        const prompt = await tx.aiPromptVersion.findFirst({
          where: { id: normalized.promptVersionId, status: AiVersionStatus.PUBLISHED },
          select: { id: true },
        })
        if (!prompt) throw new AgentSummaryValidationError('摘要必须引用已发布 Prompt 版本')

        const created = await tx.aiConversationSummary.create({
          data: {
            conversationId,
            fromMessageId: normalized.fromMessageId,
            throughMessageId: normalized.throughMessageId,
            version: normalized.expectedSummaryVersion + 1,
            summaryText: normalized.summaryText,
            facts: normalized.facts,
            sourceMessageIds: normalized.sourceMessageIds,
            promptVersionId: normalized.promptVersionId,
            modelName: normalized.modelName,
            sourceTokenCount: normalized.sourceTokenCount,
            contentHash: normalized.contentHash,
          },
        })
        const advanced = await tx.aiConversation.updateMany({
          where: {
            id: conversationId,
            userId,
            status: { not: AiConversationStatus.DELETED },
            summaryVersion: normalized.expectedSummaryVersion,
          },
          data: {
            currentSummaryId: created.id,
            summaryVersion: { increment: 1 },
          },
        })
        if (advanced.count !== 1) throw new AgentSummaryVersionConflictError()
        return created
      })
      this.logOperation('createAndAdvance', startedAt, 1)
      return summary
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new AgentSummaryVersionConflictError()
      throw error
    }
  }

  private normalizeCommand(command: CreateConversationSummaryCommand): CreateConversationSummaryCommand {
    const summaryText = command.summaryText?.trim()
    const modelName = command.modelName?.trim()
    const promptVersionId = command.promptVersionId?.trim()
    if (!Number.isInteger(command.expectedSummaryVersion) || command.expectedSummaryVersion < 0) {
      throw new AgentSummaryValidationError('expectedSummaryVersion 必须为非负整数')
    }
    if (!command.fromMessageId || !command.throughMessageId) {
      throw new AgentSummaryValidationError('摘要消息区间不能为空')
    }
    if (!summaryText) throw new AgentSummaryValidationError('摘要正文不能为空')
    if (!Array.isArray(command.facts)) throw new AgentSummaryValidationError('facts 必须为数组')
    if (!Array.isArray(command.sourceMessageIds) || command.sourceMessageIds.length === 0) {
      throw new AgentSummaryValidationError('sourceMessageIds 必须为非空数组')
    }
    if (new Set(command.sourceMessageIds).size !== command.sourceMessageIds.length) {
      throw new AgentSummaryValidationError('sourceMessageIds 不能重复')
    }
    if (!promptVersionId) throw new AgentSummaryValidationError('promptVersionId 不能为空')
    if (!modelName) throw new AgentSummaryValidationError('modelName 不能为空')
    if (!Number.isInteger(command.sourceTokenCount) || command.sourceTokenCount < 0) {
      throw new AgentSummaryValidationError('sourceTokenCount 必须为非负整数')
    }
    if (!/^[0-9a-f]{64}$/.test(command.contentHash)) {
      throw new AgentSummaryValidationError('contentHash 必须为 64 位小写十六进制')
    }
    return { ...command, summaryText, modelName, promptVersionId }
  }

  private async assertConversationReadable(
    client: Prisma.TransactionClient | PrismaService,
    userId: number,
    conversationId: string,
  ): Promise<{ summaryVersion: number }> {
    const conversation = await client.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
      select: { summaryVersion: true },
    })
    if (!conversation) throw new AgentConversationNotFoundError()
    return conversation
  }

  private async assertMessageRange(
    tx: Prisma.TransactionClient,
    userId: number,
    conversationId: string,
    command: CreateConversationSummaryCommand,
  ): Promise<void> {
    const requiredIds = [...new Set([command.fromMessageId, command.throughMessageId, ...command.sourceMessageIds])]
    const rows = await tx.aiMessage.findMany({
      where: { id: { in: requiredIds }, userId, conversationId },
      select: { id: true, createdAt: true, status: true, role: true, version: true },
    })
    if (rows.length !== requiredIds.length) {
      throw new AgentSummaryValidationError('摘要消息范围或来源不属于当前用户会话')
    }
    if (rows.some((row) => row.status !== AiMessageStatus.COMPLETED)) {
      throw new AgentSummaryValidationError('摘要只能引用已完成消息')
    }
    if (
      rows.some(
        (row) => row.role !== AiMessageRole.USER && !(row.role === AiMessageRole.ASSISTANT && row.version === 1),
      )
    ) {
      throw new AgentSummaryValidationError('摘要只能引用 canonical USER/ASSISTANT 消息')
    }
    const positions = new Map(rows.map((row) => [row.id, row] as const))
    const from = positions.get(command.fromMessageId)!
    const through = positions.get(command.throughMessageId)!
    if (comparePosition(from, through) > 0) {
      throw new AgentSummaryValidationError('摘要消息区间顺序无效')
    }
    for (const sourceId of command.sourceMessageIds) {
      const source = positions.get(sourceId)!
      if (comparePosition(source, from) < 0 || comparePosition(source, through) > 0) {
        throw new AgentSummaryValidationError('摘要来源消息必须位于指定区间内')
      }
    }
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, ConversationSummaryRepository.name)
  }
}

function comparePosition(left: MessagePosition, right: MessagePosition): number {
  const timestampOrder = left.createdAt.getTime() - right.createdAt.getTime()
  return timestampOrder === 0 ? left.id.localeCompare(right.id) : timestampOrder
}
