import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  AiAgentRunStatus,
  AiAgentStepStatus,
  AiMessageRole,
  AiMessageStatus,
  Prisma,
  type AiAgentRun,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { NotificationDeliveryService } from 'src/apps/notification/notification-delivery.service'
import { prepareCitationInTransaction, type AttachCitationInput } from '../audit/citation.repository'
import type { MessageBlock } from '../contracts'
import { toJsonInput as messageJson, validateMessageBlocks } from '../conversation/agent-conversation.utils'
import { AgentEventRepository } from './agent-event.repository'
import { AgentRunConflictError } from './agent-execution.errors'
import {
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireText,
  sanitizeExecutionObject,
  toJsonInput,
} from './agent-execution.payload'
import { AgentStateMachineService } from './agent-state-machine.service'

export interface CompleteAgentRunCommand {
  userId: number
  workerId: string
  stepId: string
  expectedRunStatusVersion: number
  traceId: string
  responseMessageId: string
  contentText: string
  contentBlocks: MessageBlock[]
  citations: AttachCitationInput[]
  modelCallId: string
  modelName: string | null
  tokenCount: number
  resultSummary: unknown
  completedEventPayload: unknown
  stepOutput: unknown
}

@Injectable()
export class AgentRunCompletionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AgentEventRepository,
    private readonly stateMachine: AgentStateMachineService,
    private readonly deliveries: NotificationDeliveryService,
    private readonly logger: LoggerService,
  ) {}

  async complete(runId: string, command: CompleteAgentRunCommand): Promise<AiAgentRun> {
    const startedAt = Date.now()
    const id = requireText(runId, 'runId', 32)
    const workerId = requireText(command.workerId, 'workerId', 128)
    const stepId = requireText(command.stepId, 'stepId', 32)
    const responseMessageId = requireText(command.responseMessageId, 'responseMessageId', 32)
    const traceId = requireText(command.traceId, 'traceId', 128)
    const modelCallId = requireText(command.modelCallId, 'modelCallId', 32)
    requirePositiveInteger(command.userId, 'userId')
    requirePositiveInteger(command.expectedRunStatusVersion, 'expectedRunStatusVersion')
    requireNonNegativeInteger(command.tokenCount, 'tokenCount')
    const contentText = requireText(command.contentText, 'contentText', 100_000)
    const blocks = validateMessageBlocks(command.contentBlocks)
    const resultSummary = sanitizeExecutionObject(command.resultSummary, 'resultSummary')
    const stepOutput = sanitizeExecutionObject(command.stepOutput, 'stepOutput')
    if (command.citations.length > 100) throw new AgentRunConflictError('单次最终消息最多写入 100 条引用')

    const run = await this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      this.events.assertActiveWorkerLease(locked, workerId)
      if (locked.run.status !== AiAgentRunStatus.RUNNING) {
        throw new AgentRunConflictError('仅 RUNNING Agent Run 可完成')
      }
      if (locked.run.statusVersion !== command.expectedRunStatusVersion) {
        throw new AgentRunConflictError('Agent Run statusVersion 冲突')
      }
      this.stateMachine.assertRunTransition(locked.run.status, AiAgentRunStatus.COMPLETED)

      const step = await tx.aiAgentStep.findFirst({ where: { id: stepId, runId: id } })
      if (!step) throw new AgentRunConflictError('Agent complete Step 不存在')
      this.stateMachine.assertStepTransition(step.status, AiAgentStepStatus.COMPLETED)

      const message = await tx.aiMessage.findFirst({
        where: { id: responseMessageId, userId: command.userId, conversationId: locked.run.conversationId },
      })
      if (!message || message.role !== AiMessageRole.ASSISTANT) {
        throw new AgentRunConflictError('Agent response message 不存在')
      }
      if (message.status !== AiMessageStatus.PENDING && message.status !== AiMessageStatus.STREAMING) {
        throw new AgentRunConflictError('Agent response message 状态不可完成')
      }

      const preparedCitations: Prisma.AiCitationCreateManyInput[] = []
      for (const citation of command.citations) {
        preparedCitations.push(await prepareCitationInTransaction(tx, command.userId, responseMessageId, citation))
      }

      await tx.aiMessage.update({
        where: { id: responseMessageId },
        data: {
          status: AiMessageStatus.COMPLETED,
          contentText,
          contentBlocks: messageJson(blocks),
          modelName: command.modelName?.trim() || null,
          tokenCount: command.tokenCount,
          completedAt: new Date(),
        },
      })
      if (preparedCitations.length > 0) {
        await tx.aiCitation.createMany({ data: preparedCitations })
        for (const citation of preparedCitations) {
          await this.events.appendInTransaction(tx, locked.run, {
            eventType: 'citation.created',
            traceId,
            stepId,
            payload: { citation: citationEvent(citation) },
          })
        }
      }
      for (const delta of splitUtf8Text(contentText, 1_024)) {
        await this.events.appendInTransaction(tx, locked.run, {
          eventType: 'model.delta',
          traceId,
          stepId,
          payload: { modelCallId, blockIndex: 0, delta },
        })
      }
      await tx.aiAgentStep.update({
        where: { id: stepId },
        data: {
          status: AiAgentStepStatus.COMPLETED,
          outputSummary: toJsonInput(stepOutput),
          outputHash: sha256Json(stepOutput),
          endedAt: new Date(),
        },
      })
      await this.events.appendInTransaction(tx, locked.run, {
        eventType: 'agent.completed',
        traceId,
        stepId,
        payload: command.completedEventPayload,
      })
      const completedAt = new Date()
      const completedRun = await tx.aiAgentRun.update({
        where: { id },
        data: {
          status: AiAgentRunStatus.COMPLETED,
          statusVersion: { increment: 1 },
          resultSummary: toJsonInput(resultSummary),
          errorCode: null,
          errorClass: null,
          errorMessage: null,
          endedAt: completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      })
      await this.deliveries.enqueueForCompletedRun(tx, { run: completedRun, completedAt })
      return completedRun
    })
    this.logger.log(
      { operation: 'completeAgentRun', runId: id, durationMs: Date.now() - startedAt, rowCount: 1 },
      AgentRunCompletionRepository.name,
    )
    return run
  }
}

function sha256Json(value: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(value)), 'utf8')
    .digest('hex')
}

function citationEvent(citation: Prisma.AiCitationCreateManyInput) {
  return {
    citationId: requireText(citation.publicId as string, 'citation.publicId', 32),
    sourceId: requireText((citation.searchSourceId ?? citation.toolCallId) as string, 'citation.sourceId', 32),
    sourceType: citation.sourceType,
    title: citation.sourceTitle,
    ...(citation.canonicalUrl ? { canonicalUrl: citation.canonicalUrl } : {}),
    ...(citation.publisher ? { publisher: citation.publisher } : {}),
    ...(citation.sourcePublishedAt
      ? { publishedAt: new Date(citation.sourcePublishedAt as string | Date).toISOString() }
      : {}),
    retrievedAt: new Date(citation.retrievedAt as string | Date).toISOString(),
    locator: citation.locator,
    contentHash: citation.contentHash,
  }
}

function splitUtf8Text(value: string, maxBytes: number): string[] {
  const chunks: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (chunk && chunkBytes + characterBytes > maxBytes) {
      chunks.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += character
    chunkBytes += characterBytes
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}
