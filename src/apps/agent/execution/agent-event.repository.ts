import { Inject, Injectable } from '@nestjs/common'
import { AiAgentRunStatus, AiRunEventVisibility, Prisma, type AiAgentRun, type AiRunEvent } from '@prisma/client'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentRunConflictError, AgentRunNotFoundError } from './agent-execution.errors'
import {
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireText,
  sanitizeEventPayload,
  toJsonInput,
} from './agent-execution.payload'
import type { AgentEventInput, AppendAgentEventCommand } from './agent-execution.types'

export interface LockedAgentRun {
  run: AiAgentRun
  leaseValid: boolean
  deadlineExpired: boolean
}

export interface AgentStreamRunSnapshot {
  id: string
  conversationId: string
  responseMessageId: string | null
  status: AiAgentRunStatus
  latestEventSequence: bigint
}

export interface AgentStreamBatch {
  run: AgentStreamRunSnapshot
  events: AiRunEvent[]
}

type EventRunCounter = Pick<AiAgentRun, 'id' | 'nextEventSequence' | 'status'>

const TERMINAL_RUN_STATUSES = [AiAgentRunStatus.COMPLETED, AiAgentRunStatus.FAILED, AiAgentRunStatus.CANCELLED] as const
const ACTIVE_LEASE_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.RUNNING,
  AiAgentRunStatus.CANCEL_REQUESTED,
])

@Injectable()
export class AgentEventRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AgentExecutionConfig.KEY) private readonly config: IAgentExecutionConfig,
    private readonly logger: LoggerService,
  ) {}

  async appendEvent(runId: string, command: AppendAgentEventCommand): Promise<AiRunEvent> {
    const startedAt = Date.now()
    const workerId = requireText(command.workerId, 'workerId', 128)
    const event = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockRun(tx, runId)
      this.assertActiveWorkerLease(locked, workerId)
      return this.appendInTransaction(tx, locked.run, command)
    })
    this.logOperation('appendEvent', startedAt, 1)
    return event
  }

  async replay(
    userId: number,
    runId: string,
    afterSequence: number | bigint = 0,
    limit = this.config.replayLimit,
    throughSequence?: number | bigint,
  ): Promise<AiRunEvent[]> {
    const startedAt = Date.now()
    const batch = await this.readStreamBatch(userId, runId, afterSequence, limit, throughSequence)
    this.logOperation('replay', startedAt, batch.events.length)
    return batch.events
  }

  async getStreamRun(userId: number, runId: string): Promise<AgentStreamRunSnapshot> {
    requirePositiveInteger(userId, 'userId')
    const normalizedRunId = requireText(runId, 'runId', 32)
    const run = await this.prisma.aiAgentRun.findFirst({
      where: { id: normalizedRunId, userId },
      select: {
        id: true,
        conversationId: true,
        responseMessageId: true,
        status: true,
        nextEventSequence: true,
      },
    })
    if (!run) throw new AgentRunNotFoundError()
    return toStreamRunSnapshot(run)
  }

  async resolveStreamCursor(userId: number, runId: string, eventId: string): Promise<bigint | null> {
    const run = await this.getStreamRun(userId, runId)
    const normalizedEventId = requireText(eventId, 'Last-Event-ID', 32)
    const event = await this.prisma.aiRunEvent.findFirst({
      where: {
        runId: run.id,
        publicId: normalizedEventId,
        visibility: AiRunEventVisibility.USER,
      },
      select: { sequence: true },
    })
    return event?.sequence ?? null
  }

  async readStreamBatch(
    userId: number,
    runId: string,
    afterSequence: number | bigint,
    limit = this.config.replayLimit,
    throughSequence?: number | bigint,
  ): Promise<AgentStreamBatch> {
    requirePositiveInteger(userId, 'userId')
    const normalizedRunId = requireText(runId, 'runId', 32)
    const cursor = normalizeSequence(afterSequence)
    const through = throughSequence == null ? null : normalizeSequence(throughSequence)
    requirePositiveInteger(limit, 'limit', this.config.replayLimit)

    const run = await this.getStreamRun(userId, normalizedRunId)
    const events = await this.prisma.aiRunEvent.findMany({
      where: {
        runId: normalizedRunId,
        sequence: { gt: cursor, ...(through == null ? {} : { lte: through }) },
        visibility: AiRunEventVisibility.USER,
      },
      orderBy: { sequence: 'asc' },
      take: limit,
    })
    return { run, events }
  }

  async lockRun(tx: Prisma.TransactionClient, runId: string): Promise<LockedAgentRun> {
    const normalizedRunId = requireText(runId, 'runId', 32)
    const leaseRows = await tx.$queryRaw<Array<{ leaseValid: boolean; deadlineExpired: boolean }>>(Prisma.sql`
      SELECT
        ("lease_expires_at" IS NOT NULL AND "lease_expires_at" > clock_timestamp()) AS "leaseValid",
        ("deadline_at" <= clock_timestamp()) AS "deadlineExpired"
      FROM "ai_agent_runs"
      WHERE "id" = ${normalizedRunId}
      FOR UPDATE
    `)
    if (leaseRows.length === 0) throw new AgentRunNotFoundError()
    const run = await tx.aiAgentRun.findUnique({ where: { id: normalizedRunId } })
    if (!run) throw new AgentRunNotFoundError()
    return { run, leaseValid: leaseRows[0].leaseValid, deadlineExpired: leaseRows[0].deadlineExpired }
  }

  assertActiveWorkerLease(locked: LockedAgentRun, workerId: string): void {
    if (locked.run.leaseOwner !== workerId || !locked.leaseValid || !ACTIVE_LEASE_RUN_STATUSES.has(locked.run.status)) {
      throw new AgentRunConflictError('Worker 未持有有效 Agent Run lease')
    }
  }

  async appendInTransaction(
    tx: Prisma.TransactionClient,
    run: EventRunCounter,
    input: AgentEventInput,
  ): Promise<AiRunEvent> {
    if (TERMINAL_RUN_STATUSES.includes(run.status as (typeof TERMINAL_RUN_STATUSES)[number])) {
      throw new AgentRunConflictError('Agent Run 终态后禁止追加业务事件')
    }
    const eventType = requireText(input.eventType, 'eventType', 64)
    const traceId = requireText(input.traceId, 'traceId', 128)
    const stepId = input.stepId == null ? null : requireText(input.stepId, 'stepId', 32)
    const payload = sanitizeEventPayload(input.payload)
    const sequence = run.nextEventSequence
    const allocation = await tx.aiAgentRun.updateMany({
      where: {
        id: run.id,
        nextEventSequence: sequence,
        status: { notIn: [...TERMINAL_RUN_STATUSES] },
      },
      data: { nextEventSequence: { increment: 1n } },
    })
    if (allocation.count !== 1) throw new AgentRunConflictError('Agent Run event sequence 分配冲突')

    return tx.aiRunEvent.create({
      data: {
        runId: run.id,
        stepId,
        sequence,
        eventType,
        visibility: input.visibility ?? AiRunEventVisibility.USER,
        traceId,
        payload: toJsonInput(payload),
      },
    })
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, AgentEventRepository.name)
  }
}

function toStreamRunSnapshot(run: {
  id: string
  conversationId: string
  responseMessageId: string | null
  status: AiAgentRunStatus
  nextEventSequence: bigint
}): AgentStreamRunSnapshot {
  return {
    id: run.id,
    conversationId: run.conversationId,
    responseMessageId: run.responseMessageId,
    status: run.status,
    latestEventSequence: run.nextEventSequence - 1n,
  }
}

function normalizeSequence(value: number | bigint): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new AgentRunConflictError('afterSequence 必须为非负整数')
    return value
  }
  requireNonNegativeInteger(value, 'afterSequence')
  return BigInt(value)
}
