import { Injectable } from '@nestjs/common'
import { AiAgentRunStatus, AiAgentStepStatus, AiConversationStatus, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import {
  AgentConversationNotFoundError,
  AgentStoredMessageInvalidError,
} from '../conversation/agent-conversation.errors'
import { decodeStoredMessageBlocks } from '../conversation/agent-conversation.utils'
import { AgentRunNotFoundError } from '../execution/agent-execution.errors'

const ACTIVE_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.QUEUED,
  AiAgentRunStatus.RUNNING,
  AiAgentRunStatus.CANCEL_REQUESTED,
])

@Injectable()
export class AgentRestReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listMessages(userId: number, conversationId: string, beforeMessageId: string | null, limit: number) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId, status: { not: AiConversationStatus.DELETED } },
      select: { id: true },
    })
    if (!conversation) throw new AgentConversationNotFoundError()

    const before = beforeMessageId
      ? await this.prisma.aiMessage.findFirst({
          where: { id: beforeMessageId, userId, conversationId },
          select: { id: true, createdAt: true },
        })
      : null
    if (beforeMessageId && !before) throw new AgentConversationNotFoundError()

    const rows = await this.prisma.aiMessage.findMany({
      where: {
        userId,
        conversationId,
        ...(before
          ? {
              OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        citations: { orderBy: { id: 'asc' } },
        triggeredRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
        responseRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const tail = pageRows.at(-1)
    return {
      items: pageRows.reverse().map((message) => {
        if (message.contentSchemaVersion !== 1) throw new AgentStoredMessageInvalidError(message.id)
        const run = message.responseRuns[0] ?? message.triggeredRuns[0] ?? null
        return {
          messageId: message.id,
          role: message.role,
          status: message.status,
          contentText: message.contentText,
          contentBlocks: decodeStoredMessageBlocks(message.contentBlocks, message.id),
          version: message.version,
          parentMessageId: message.parentMessageId,
          modelName: message.modelName,
          run: run
            ? {
                runId: run.id,
                status: run.status,
                statusVersion: run.statusVersion,
                endedAt: run.endedAt?.toISOString() ?? null,
              }
            : null,
          citations: message.citations.map((citation) => ({
            citationId: citation.publicId,
            blockId: citation.blockId,
            claimKey: citation.claimKey,
            conclusionLevel: citation.conclusionLevel,
            sourceType: citation.sourceType,
            title: citation.sourceTitle,
            canonicalUrl: citation.canonicalUrl,
            publisher: citation.publisher,
            retrievedAt: citation.retrievedAt.toISOString(),
            locator: asRecord(citation.locator),
          })),
          createdAt: message.createdAt.toISOString(),
          completedAt: message.completedAt?.toISOString() ?? null,
        }
      }),
      nextBeforeMessageId: hasMore && tail ? tail.id : null,
    }
  }

  async getRunStatus(userId: number, runId: string) {
    const run = await this.prisma.aiAgentRun.findFirst({
      where: { id: runId, userId },
      include: {
        responseMessage: { select: { id: true, status: true } },
        steps: { orderBy: [{ ordinal: 'desc' }, { id: 'desc' }], take: 1 },
      },
    })
    if (!run) throw new AgentRunNotFoundError()
    const step = run.steps[0] ?? null
    const currentStep =
      step &&
      (step.status === AiAgentStepStatus.PENDING ||
        step.status === AiAgentStepStatus.RUNNING ||
        !isTerminal(run.status))
        ? {
            stepId: step.id,
            stepKey: step.stepKey,
            kind: step.kind,
            status: step.status,
            ordinal: step.ordinal,
          }
        : null
    return {
      runId: run.id,
      conversationId: run.conversationId,
      status: run.status,
      statusVersion: run.statusVersion,
      currentStep,
      finalMessageId: run.responseMessage.status === 'COMPLETED' ? run.responseMessage.id : null,
      latestEventSequence: Number(run.nextEventSequence - 1n),
      canCancel: ACTIVE_RUN_STATUSES.has(run.status),
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      queuedAt: run.queuedAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.endedAt?.toISOString() ?? null,
    }
  }

  async listToolCalls(userId: number, runId: string) {
    const run = await this.prisma.aiAgentRun.findFirst({ where: { id: runId, userId }, select: { id: true } })
    if (!run) throw new AgentRunNotFoundError()
    const calls = await this.prisma.aiToolCall.findMany({
      where: { runId, userId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    })
    return calls.map((call) => ({
      toolCallId: call.id,
      toolName: call.toolName,
      toolVersion: call.toolVersion,
      status: call.status,
      attemptCount: call.attemptCount,
      inputSummary: asRecord(call.inputSummary),
      outputSummary: call.outputSummary == null ? null : asRecord(call.outputSummary),
      errorCode: call.errorCode,
      errorMessage: call.errorMessage,
      durationMs: call.durationMs,
      dataAsOf: call.dataAsOf?.toISOString().slice(0, 10) ?? null,
      dataThrough: call.dataThrough?.toISOString().slice(0, 10) ?? null,
      startedAt: call.startedAt.toISOString(),
      finishedAt: call.finishedAt?.toISOString() ?? null,
    }))
  }
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function isTerminal(status: AiAgentRunStatus): boolean {
  return new Set<AiAgentRunStatus>([
    AiAgentRunStatus.COMPLETED,
    AiAgentRunStatus.FAILED,
    AiAgentRunStatus.CANCELLED,
  ]).has(status)
}
