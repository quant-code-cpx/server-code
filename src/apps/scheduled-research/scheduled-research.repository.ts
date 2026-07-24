import {
  AiAgentRunStatus,
  AiScheduledTaskStatus,
  AiTaskExecutionStatus,
  Prisma,
  StockExchange,
  type AiScheduledTask,
  type AiTaskExecution,
} from '@prisma/client'
import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

export interface CreateScheduledTaskRecord {
  userId: number
  clientRequestId: string
  name: string
  trigger: AiScheduledTask['trigger']
  cronExpression: string | null
  timeZone: string
  oneTimeAt: Date | null
  condition: Record<string, unknown> | null
  tradingDayOnly: boolean
  prompt: string
  input: Record<string, unknown>
  allowedCapabilities: string[]
  requiredWatermarks: Record<string, unknown>[]
  workflowKey: string
  workflowVersion: number
  workflowContentHash: string
  promptKey: string
  promptVersion: number
  promptContentHash: string
  modelPolicy: AiScheduledTask['modelPolicy']
  preferredModel: string | null
  maxCostCny: number
  nextRunAt: Date | null
}

export interface CreateExecutionRecord {
  task: AiScheduledTask
  scheduledFor: Date
  requestKey: string
  taskSnapshot: Record<string, unknown>
  gateEvidence: Record<string, unknown>
}

@Injectable()
export class ScheduledResearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTask(data: CreateScheduledTaskRecord): Promise<{ task: AiScheduledTask; created: boolean }> {
    const existing = await this.prisma.aiScheduledTask.findFirst({
      where: { userId: data.userId, clientRequestId: data.clientRequestId },
    })
    if (existing) return { task: existing, created: false }
    try {
      const task = await this.prisma.aiScheduledTask.create({
        data: {
          ...data,
          condition: asJsonOrNull(data.condition),
          input: data.input as Prisma.InputJsonValue,
          allowedCapabilities: data.allowedCapabilities as Prisma.InputJsonValue,
          requiredWatermarks: data.requiredWatermarks as Prisma.InputJsonValue,
        },
      })
      return { task, created: true }
    } catch (error) {
      if (!isUniqueError(error)) throw error
      const task = await this.prisma.aiScheduledTask.findFirstOrThrow({
        where: { userId: data.userId, clientRequestId: data.clientRequestId },
      })
      return { task, created: false }
    }
  }

  findTaskForUser(userId: number, taskId: string, includeDeleted = false): Promise<AiScheduledTask | null> {
    return this.prisma.aiScheduledTask.findFirst({
      where: { id: taskId, userId, ...(includeDeleted ? {} : { status: { not: AiScheduledTaskStatus.DELETED } }) },
    })
  }

  findTaskById(taskId: string): Promise<AiScheduledTask | null> {
    return this.prisma.aiScheduledTask.findUnique({ where: { id: taskId } })
  }

  findTaskByClientRequest(userId: number, clientRequestId: string): Promise<AiScheduledTask | null> {
    return this.prisma.aiScheduledTask.findFirst({ where: { userId, clientRequestId } })
  }

  countLiveTasks(userId: number): Promise<number> {
    return this.prisma.aiScheduledTask.count({
      where: { userId, status: { in: [AiScheduledTaskStatus.ACTIVE, AiScheduledTaskStatus.PAUSED] } },
    })
  }

  findExecutionForUser(userId: number, executionId: string): Promise<AiTaskExecution | null> {
    return this.prisma.aiTaskExecution.findFirst({ where: { id: executionId, userId } })
  }

  async listTasks(input: {
    userId: number
    cursor: string | null
    limit: number
    status?: AiScheduledTaskStatus
    includeDeleted: boolean
  }) {
    const rows = await this.prisma.aiScheduledTask.findMany({
      where: {
        userId: input.userId,
        ...(input.status
          ? { status: input.status }
          : input.includeDeleted
            ? {}
            : { status: { not: AiScheduledTaskStatus.DELETED } }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    })
    return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows[input.limit].id : null }
  }

  async updateTask(input: {
    userId: number
    taskId: string
    expectedVersion: number
    data: Prisma.AiScheduledTaskUpdateManyMutationInput
  }): Promise<AiScheduledTask | null> {
    const result = await this.prisma.aiScheduledTask.updateMany({
      where: {
        id: input.taskId,
        userId: input.userId,
        version: input.expectedVersion,
        status: { not: AiScheduledTaskStatus.DELETED },
      },
      data: { ...input.data, version: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null },
    })
    if (result.count !== 1) return null
    return this.findTaskForUser(input.userId, input.taskId, true)
  }

  async changeStatus(input: {
    userId: number
    taskId: string
    expectedVersion: number
    status: AiScheduledTaskStatus
    nextRunAt: Date | null
  }): Promise<AiScheduledTask | null> {
    const result = await this.prisma.aiScheduledTask.updateMany({
      where: {
        id: input.taskId,
        userId: input.userId,
        version: input.expectedVersion,
        status: { not: AiScheduledTaskStatus.DELETED },
      },
      data: {
        status: input.status,
        nextRunAt: input.nextRunAt,
        pausedAt: input.status === AiScheduledTaskStatus.PAUSED ? new Date() : null,
        deletedAt: input.status === AiScheduledTaskStatus.DELETED ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    })
    if (result.count !== 1) return null
    return this.findTaskForUser(input.userId, input.taskId, true)
  }

  findDue(now: Date, limit: number): Promise<AiScheduledTask[]> {
    return this.prisma.aiScheduledTask.findMany({
      where: {
        status: AiScheduledTaskStatus.ACTIVE,
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      take: limit,
    })
  }

  async claimDue(taskId: string, now: Date, owner: string, leaseExpiresAt: Date): Promise<boolean> {
    const result = await this.prisma.aiScheduledTask.updateMany({
      where: {
        id: taskId,
        status: AiScheduledTaskStatus.ACTIVE,
        nextRunAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: { leaseOwner: owner, leaseExpiresAt },
    })
    return result.count === 1
  }

  async finishClaim(input: {
    taskId: string
    owner: string
    expectedVersion: number
    nextRunAt: Date | null
  }): Promise<boolean> {
    const result = await this.prisma.aiScheduledTask.updateMany({
      where: {
        id: input.taskId,
        status: AiScheduledTaskStatus.ACTIVE,
        version: input.expectedVersion,
        leaseOwner: input.owner,
      },
      data: { nextRunAt: input.nextRunAt, leaseOwner: null, leaseExpiresAt: null },
    })
    return result.count === 1
  }

  async createExecutionOnce(data: CreateExecutionRecord): Promise<{ execution: AiTaskExecution; created: boolean }> {
    const existing = await this.prisma.aiTaskExecution.findFirst({
      where: { taskId: data.task.id, OR: [{ scheduledFor: data.scheduledFor }, { requestKey: data.requestKey }] },
    })
    if (existing) return { execution: existing, created: false }
    try {
      const execution = await this.prisma.aiTaskExecution.create({
        data: {
          taskId: data.task.id,
          userId: data.task.userId,
          requestKey: data.requestKey,
          scheduledFor: data.scheduledFor,
          taskSnapshot: data.taskSnapshot as Prisma.InputJsonValue,
          gateEvidence: data.gateEvidence as Prisma.InputJsonValue,
        },
      })
      return { execution, created: true }
    } catch (error) {
      if (!isUniqueError(error)) throw error
      const execution = await this.prisma.aiTaskExecution.findFirstOrThrow({
        where: { taskId: data.task.id, OR: [{ scheduledFor: data.scheduledFor }, { requestKey: data.requestKey }] },
      })
      return { execution, created: false }
    }
  }

  async deferExecution(executionId: string, gateEvidence: Record<string, unknown>): Promise<void> {
    await this.prisma.aiTaskExecution.updateMany({
      where: { id: executionId, status: { in: [AiTaskExecutionStatus.PENDING, AiTaskExecutionStatus.DEFERRED] } },
      data: { status: AiTaskExecutionStatus.DEFERRED, gateEvidence: gateEvidence as Prisma.InputJsonValue },
    })
  }

  async skipExecution(executionId: string, gateEvidence: Record<string, unknown>): Promise<void> {
    await this.prisma.aiTaskExecution.updateMany({
      where: { id: executionId, status: { in: [AiTaskExecutionStatus.PENDING, AiTaskExecutionStatus.DEFERRED] } },
      data: {
        status: AiTaskExecutionStatus.SKIPPED,
        gateEvidence: gateEvidence as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    })
  }

  async queueExecution(executionId: string, runId: string, gateEvidence: Record<string, unknown>): Promise<void> {
    await this.prisma.aiTaskExecution.updateMany({
      where: { id: executionId, status: { in: [AiTaskExecutionStatus.PENDING, AiTaskExecutionStatus.DEFERRED] } },
      data: {
        status: AiTaskExecutionStatus.QUEUED,
        runId,
        gateEvidence: gateEvidence as Prisma.InputJsonValue,
        queuedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    })
  }

  async failExecution(executionId: string, errorCode: number | null, errorMessage: string): Promise<void> {
    await this.prisma.aiTaskExecution.updateMany({
      where: { id: executionId, status: { in: [AiTaskExecutionStatus.PENDING, AiTaskExecutionStatus.DEFERRED] } },
      data: {
        status: AiTaskExecutionStatus.FAILED,
        errorCode,
        errorMessage: errorMessage.slice(0, 1_000),
        endedAt: new Date(),
      },
    })
  }

  findDeferred(limit: number) {
    return this.prisma.aiTaskExecution.findMany({
      where: { status: AiTaskExecutionStatus.DEFERRED },
      include: { task: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    })
  }

  findLatestTriggeredExecution(taskId: string): Promise<AiTaskExecution | null> {
    return this.prisma.aiTaskExecution.findFirst({
      where: {
        taskId,
        status: {
          in: [AiTaskExecutionStatus.QUEUED, AiTaskExecutionStatus.RUNNING, AiTaskExecutionStatus.SUCCEEDED],
        },
      },
      orderBy: [{ queuedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }

  findDailyWatermark(minTradeDate?: string) {
    return this.prisma.daily.findFirst({
      where: minTradeDate ? { tradeDate: { gte: toUtcDate(minTradeDate) } } : {},
      orderBy: [{ tradeDate: 'desc' }, { syncedAt: 'desc' }],
      select: { tradeDate: true, syncedAt: true },
    })
  }

  findDailyConditionValue(resourceId: string) {
    return this.prisma.daily.findFirst({
      where: { tsCode: resourceId },
      orderBy: [{ tradeDate: 'desc' }, { syncedAt: 'desc' }],
      select: { tsCode: true, tradeDate: true, close: true, syncedAt: true },
    })
  }

  async isTradingDay(tradeDate: string): Promise<boolean | null> {
    const row = await this.prisma.tradeCal.findUnique({
      where: { exchange_calDate: { exchange: StockExchange.SSE, calDate: toUtcDate(tradeDate) } },
      select: { isOpen: true },
    })
    return row ? row.isOpen === '1' : null
  }

  async listExecutions(input: { userId: number; taskId: string; cursor: string | null; limit: number }) {
    const rows = await this.prisma.aiTaskExecution.findMany({
      where: { taskId: input.taskId, userId: input.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    })
    return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows[input.limit].id : null }
  }

  async refreshExecutionStatuses(limit: number): Promise<number> {
    const executions = await this.prisma.aiTaskExecution.findMany({
      where: {
        runId: { not: null },
        status: { in: [AiTaskExecutionStatus.QUEUED, AiTaskExecutionStatus.RUNNING] },
      },
      include: { run: { select: { status: true, startedAt: true, endedAt: true } } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    })
    let updated = 0
    for (const execution of executions) {
      if (!execution.runId || !execution.run) continue
      const status = executionStatusFromRun(execution.run.status)
      if (status === execution.status) continue
      const cost = await this.prisma.aiModelCall.aggregate({ where: { runId: execution.runId }, _sum: { cost: true } })
      await this.prisma.aiTaskExecution.update({
        where: { id: execution.id },
        data: {
          status,
          startedAt: execution.run.startedAt,
          endedAt: execution.run.endedAt,
          costCny: cost._sum.cost ?? null,
        },
      })
      updated += 1
    }
    return updated
  }
}

function asJsonOrNull(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue)
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function toUtcDate(value: string): Date {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
}

function executionStatusFromRun(status: AiAgentRunStatus): AiTaskExecutionStatus {
  if (status === AiAgentRunStatus.QUEUED) return AiTaskExecutionStatus.QUEUED
  if (status === AiAgentRunStatus.RUNNING || status === AiAgentRunStatus.CANCEL_REQUESTED)
    return AiTaskExecutionStatus.RUNNING
  if (status === AiAgentRunStatus.COMPLETED) return AiTaskExecutionStatus.SUCCEEDED
  if (status === AiAgentRunStatus.CANCELLED) return AiTaskExecutionStatus.CANCELLED
  return AiTaskExecutionStatus.FAILED
}
