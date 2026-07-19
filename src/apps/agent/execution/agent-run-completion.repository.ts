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
    private readonly logger: LoggerService,
  ) {}

  async complete(runId: string, command: CompleteAgentRunCommand): Promise<AiAgentRun> {
    const startedAt = Date.now()
    const id = requireText(runId, 'runId', 32)
    const workerId = requireText(command.workerId, 'workerId', 128)
    const stepId = requireText(command.stepId, 'stepId', 32)
    const responseMessageId = requireText(command.responseMessageId, 'responseMessageId', 32)
    const traceId = requireText(command.traceId, 'traceId', 128)
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
      return tx.aiAgentRun.update({
        where: { id },
        data: {
          status: AiAgentRunStatus.COMPLETED,
          statusVersion: { increment: 1 },
          resultSummary: toJsonInput(resultSummary),
          errorCode: null,
          errorClass: null,
          errorMessage: null,
          endedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      })
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}
