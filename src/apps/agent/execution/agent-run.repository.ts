import { Inject, Injectable } from '@nestjs/common'
import {
  AiAgentRunStatus,
  AiAgentStepStatus,
  AiMessageRole,
  AiMessageStatus,
  AiModelPolicy,
  AiRunEventVisibility,
  Prisma,
  type AiAgentRun,
  type AiAgentStep,
} from '@prisma/client'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { canonicalJson, sha256 } from '../audit/agent-audit-sanitizer'
import { AgentEventRepository } from './agent-event.repository'
import {
  AgentExecutionValidationError,
  AgentRunConflictError,
  AgentRunIdempotencyConflictError,
  AgentRunNotFoundError,
} from './agent-execution.errors'
import {
  optionalText,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireText,
  sanitizeExecutionError,
  sanitizeExecutionObject,
  toJsonInput,
} from './agent-execution.payload'
import type {
  CreateAgentRunCommand,
  CreateAgentStepCommand,
  RequestAgentRunCancelCommand,
  SaveAgentCheckpointCommand,
  TransitionAgentRunCommand,
  TransitionAgentStepCommand,
} from './agent-execution.types'
import { AgentStateMachineService } from './agent-state-machine.service'

const TERMINAL_EVENT_BY_STATUS: Partial<Record<AiAgentRunStatus, string>> = {
  [AiAgentRunStatus.COMPLETED]: 'agent.completed',
  [AiAgentRunStatus.FAILED]: 'agent.failed',
  [AiAgentRunStatus.CANCELLED]: 'agent.cancelled',
}
const CLAIMABLE_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.QUEUED,
  AiAgentRunStatus.RUNNING,
  AiAgentRunStatus.CANCEL_REQUESTED,
])
const TERMINAL_STEP_STATUSES = new Set<AiAgentStepStatus>([
  AiAgentStepStatus.COMPLETED,
  AiAgentStepStatus.FAILED,
  AiAgentStepStatus.CANCELLED,
  AiAgentStepStatus.SKIPPED,
])

@Injectable()
export class AgentRunRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AgentEventRepository,
    private readonly stateMachine: AgentStateMachineService,
    @Inject(AgentExecutionConfig.KEY) private readonly config: IAgentExecutionConfig,
    private readonly logger: LoggerService,
  ) {}

  async createRun(command: CreateAgentRunCommand): Promise<AiAgentRun> {
    const startedAt = Date.now()
    const normalized = this.normalizeCreateCommand(command)
    const existing = await this.prisma.aiAgentRun.findFirst({
      where: { userId: normalized.userId, clientRequestId: normalized.clientRequestId },
    })
    if (existing) return this.resolveIdempotentRun(existing, normalized.requestHash, startedAt)

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.aiAgentRun.create({
          data: {
            userId: normalized.userId,
            conversationId: normalized.conversationId,
            triggerMessageId: normalized.triggerMessageId,
            responseMessageId: normalized.responseMessageId,
            clientRequestId: normalized.clientRequestId,
            requestHash: normalized.requestHash,
            traceId: normalized.traceId,
            workflowVersionId: normalized.workflowVersionId,
            promptVersionId: normalized.promptVersionId,
            toolPolicyVersion: normalized.toolPolicyVersion,
            modelPolicy: normalized.modelPolicy,
            preferredModel: normalized.preferredModel,
            inputSnapshot: toJsonInput(normalized.inputSnapshot),
            budget: toJsonInput(normalized.budget),
            maxAttempts: normalized.maxAttempts,
            deadlineAt: normalized.deadlineAt,
          },
        })
        await this.events.appendInTransaction(tx, created, {
          eventType: 'message.created',
          traceId: created.traceId,
          payload: {
            messageId: created.responseMessageId,
            role: AiMessageRole.ASSISTANT,
            status: AiMessageStatus.PENDING,
          },
        })
        return tx.aiAgentRun.findUniqueOrThrow({ where: { id: created.id } })
      })
      this.logOperation('createRun', startedAt, 1, run.id)
      return run
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const raced = await this.prisma.aiAgentRun.findFirst({
        where: { userId: normalized.userId, clientRequestId: normalized.clientRequestId },
      })
      if (!raced) throw error
      return this.resolveIdempotentRun(raced, normalized.requestHash, startedAt)
    }
  }

  async findById(userId: number, runId: string): Promise<AiAgentRun> {
    requirePositiveInteger(userId, 'userId')
    const id = requireText(runId, 'runId', 32)
    const run = await this.prisma.aiAgentRun.findFirst({ where: { id, userId } })
    if (!run) throw new AgentRunNotFoundError()
    return run
  }

  async claimRun(runId: string, workerId: string, leaseMs = this.config.leaseMs): Promise<AiAgentRun> {
    const startedAt = Date.now()
    const id = requireText(runId, 'runId', 32)
    const owner = requireText(workerId, 'workerId', 128)
    requirePositiveInteger(leaseMs, 'leaseMs', 300_000)
    if (leaseMs < 1_000) throw new AgentExecutionValidationError('leaseMs 不能小于 1000')

    const run = await this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      if (this.stateMachine.isTerminalRunStatus(locked.run.status)) {
        throw new AgentRunConflictError('终态 Agent Run 不可领取')
      }
      if (locked.deadlineExpired) throw new AgentRunConflictError('Agent Run deadline 已到期')
      if (locked.leaseValid) {
        if (locked.run.leaseOwner === owner) return locked.run
        throw new AgentRunConflictError('Agent Run 已由其他 Worker 持有')
      }
      if (locked.run.leaseOwner === owner && locked.run.leaseExpiresAt) {
        throw new AgentRunConflictError('过期 lease 必须由新 Worker identity 接管')
      }
      if (locked.run.attempt >= locked.run.maxAttempts) {
        throw new AgentRunConflictError('Agent Run 已达到最大领取次数')
      }
      if (!CLAIMABLE_RUN_STATUSES.has(locked.run.status)) {
        throw new AgentRunConflictError(`Agent Run 状态 ${locked.run.status} 不可领取`)
      }

      if (locked.run.status === AiAgentRunStatus.QUEUED) {
        await this.events.appendInTransaction(tx, locked.run, {
          eventType: 'agent.started',
          traceId: locked.run.traceId,
          payload: {
            workflowVersionId: locked.run.workflowVersionId,
            modelPolicy: locked.run.modelPolicy,
          },
        })
      }

      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE "ai_agent_runs"
        SET
          "status" = CASE
            WHEN "status" = 'QUEUED' THEN 'RUNNING'::"ai_agent_run_status"
            ELSE "status"
          END,
          "status_version" = "status_version" + 1,
          "attempt" = "attempt" + 1,
          "lease_owner" = ${owner},
          "lease_expires_at" = clock_timestamp() + (${leaseMs} * INTERVAL '1 millisecond'),
          "heartbeat_at" = clock_timestamp(),
          "started_at" = COALESCE("started_at", clock_timestamp()),
          "updated_at" = clock_timestamp()
        WHERE "id" = ${id}
      `)
      if (updated !== 1) throw new AgentRunConflictError('Agent Run 领取冲突')
      return tx.aiAgentRun.findUniqueOrThrow({ where: { id } })
    })
    this.logOperation('claimRun', startedAt, 1, run.id)
    return run
  }

  async heartbeat(runId: string, workerId: string, leaseMs = this.config.leaseMs): Promise<AiAgentRun> {
    const id = requireText(runId, 'runId', 32)
    const owner = requireText(workerId, 'workerId', 128)
    requirePositiveInteger(leaseMs, 'leaseMs', 300_000)
    if (leaseMs < 1_000) throw new AgentExecutionValidationError('leaseMs 不能小于 1000')
    const updated = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "ai_agent_runs"
      SET
        "lease_expires_at" = clock_timestamp() + (${leaseMs} * INTERVAL '1 millisecond'),
        "heartbeat_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
      WHERE "id" = ${id}
        AND "lease_owner" = ${owner}
        AND "status" IN ('RUNNING', 'CANCEL_REQUESTED')
        AND "lease_expires_at" > clock_timestamp()
    `)
    if (updated !== 1) throw new AgentRunConflictError('Worker 未持有可续租的 Agent Run lease')
    return this.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } })
  }

  async transition(runId: string, command: TransitionAgentRunCommand): Promise<AiAgentRun> {
    const startedAt = Date.now()
    const id = requireText(runId, 'runId', 32)
    const workerId = requireText(command.workerId, 'workerId', 128)
    requirePositiveInteger(command.expectedVersion, 'expectedVersion')
    const requiredEvent = TERMINAL_EVENT_BY_STATUS[command.targetStatus]
    if (!requiredEvent || command.event.eventType !== requiredEvent) {
      throw new AgentExecutionValidationError(`状态 ${command.targetStatus} 必须使用对应终态事件`)
    }

    const resultSummary =
      command.targetStatus === AiAgentRunStatus.COMPLETED
        ? sanitizeExecutionObject(command.resultSummary, 'resultSummary')
        : null
    const errorClass = optionalText(command.errorClass, 'errorClass', 128)
    if (command.targetStatus === AiAgentRunStatus.FAILED && !errorClass) {
      throw new AgentExecutionValidationError('FAILED Run 必须提供 errorClass')
    }

    const run = await this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      this.events.assertActiveWorkerLease(locked, workerId)
      if (locked.run.statusVersion !== command.expectedVersion) {
        throw new AgentRunConflictError('Agent Run statusVersion 冲突')
      }
      if (locked.deadlineExpired && command.targetStatus === AiAgentRunStatus.COMPLETED) {
        throw new AgentRunConflictError('Agent Run deadline 后不可完成')
      }
      this.stateMachine.assertRunTransition(locked.run.status, command.targetStatus)
      await this.events.appendInTransaction(tx, locked.run, command.event)
      return tx.aiAgentRun.update({
        where: { id },
        data: {
          status: command.targetStatus,
          statusVersion: { increment: 1 },
          resultSummary: resultSummary ? toJsonInput(resultSummary) : Prisma.DbNull,
          errorCode: command.targetStatus === AiAgentRunStatus.FAILED ? (command.errorCode ?? null) : null,
          errorClass: command.targetStatus === AiAgentRunStatus.FAILED ? errorClass : null,
          errorMessage:
            command.targetStatus === AiAgentRunStatus.FAILED && command.errorMessage != null
              ? sanitizeExecutionError(command.errorMessage)
              : null,
          endedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      })
    })
    this.logOperation('transitionRun', startedAt, 1, run.id)
    return run
  }

  async requestCancel(command: RequestAgentRunCancelCommand): Promise<AiAgentRun> {
    const startedAt = Date.now()
    requirePositiveInteger(command.userId, 'userId')
    requirePositiveInteger(command.expectedVersion, 'expectedVersion')
    const id = requireText(command.runId, 'runId', 32)
    const reason = optionalText(command.reason, 'reason', 500)

    const run = await this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      if (locked.run.userId !== command.userId) throw new AgentRunNotFoundError()
      if (this.stateMachine.isTerminalRunStatus(locked.run.status)) return locked.run
      if (locked.run.status === AiAgentRunStatus.CANCEL_REQUESTED) return locked.run
      if (locked.run.statusVersion !== command.expectedVersion) {
        throw new AgentRunConflictError('Agent Run statusVersion 冲突')
      }

      if (locked.run.status === AiAgentRunStatus.QUEUED) {
        this.stateMachine.assertRunTransition(locked.run.status, AiAgentRunStatus.CANCELLED)
        await this.events.appendInTransaction(tx, locked.run, {
          eventType: 'agent.cancelled',
          traceId: locked.run.traceId,
          payload: { cancelledBy: command.userId, reason },
        })
        return tx.aiAgentRun.update({
          where: { id },
          data: {
            status: AiAgentRunStatus.CANCELLED,
            statusVersion: { increment: 1 },
            cancelRequestedAt: new Date(),
            cancelRequestedBy: command.userId,
            cancelReason: reason,
            endedAt: new Date(),
          },
        })
      }

      this.stateMachine.assertRunTransition(locked.run.status, AiAgentRunStatus.CANCEL_REQUESTED)
      await this.events.appendInTransaction(tx, locked.run, {
        eventType: 'run.cancel_requested',
        traceId: locked.run.traceId,
        visibility: AiRunEventVisibility.INTERNAL,
        payload: { requestedBy: command.userId, reason },
      })
      return tx.aiAgentRun.update({
        where: { id },
        data: {
          status: AiAgentRunStatus.CANCEL_REQUESTED,
          statusVersion: { increment: 1 },
          cancelRequestedAt: new Date(),
          cancelRequestedBy: command.userId,
          cancelReason: reason,
        },
      })
    })
    this.logOperation('requestCancel', startedAt, 1, run.id)
    return run
  }

  async saveCheckpoint(runId: string, command: SaveAgentCheckpointCommand): Promise<AiAgentRun> {
    const id = requireText(runId, 'runId', 32)
    const workerId = requireText(command.workerId, 'workerId', 128)
    requireNonNegativeInteger(command.expectedCheckpointVersion, 'expectedCheckpointVersion')
    const checkpoint = sanitizeExecutionObject(command.checkpoint, 'checkpoint')

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      this.events.assertActiveWorkerLease(locked, workerId)
      if (locked.run.status !== AiAgentRunStatus.RUNNING) {
        throw new AgentRunConflictError('仅 RUNNING Agent Run 可保存 checkpoint')
      }
      if (locked.run.checkpointVersion !== command.expectedCheckpointVersion) {
        throw new AgentRunConflictError('Agent Run checkpointVersion 冲突')
      }
      return tx.aiAgentRun.update({
        where: { id },
        data: { checkpoint: toJsonInput(checkpoint), checkpointVersion: { increment: 1 } },
      })
    })
  }

  async createStep(runId: string, workerId: string, command: CreateAgentStepCommand): Promise<AiAgentStep> {
    const id = requireText(runId, 'runId', 32)
    const owner = requireText(workerId, 'workerId', 128)
    const stepKey = requireText(command.stepKey, 'stepKey', 128)
    const ordinal = requireNonNegativeInteger(command.ordinal, 'ordinal')
    const attempt = requirePositiveInteger(command.attempt ?? 1, 'attempt')
    const parentStepId = optionalText(command.parentStepId, 'parentStepId', 32)
    const input = sanitizeExecutionObject(command.input, 'step input')
    const inputHash = sha256(canonicalJson(input as never))

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.events.lockRun(tx, id)
        this.events.assertActiveWorkerLease(locked, owner)
        if (locked.run.status !== AiAgentRunStatus.RUNNING) {
          throw new AgentRunConflictError('仅 RUNNING Agent Run 可创建 Step')
        }
        return tx.aiAgentStep.create({
          data: {
            runId: id,
            parentStepId,
            stepKey,
            kind: command.kind,
            ordinal,
            attempt,
            inputSummary: toJsonInput(input),
            inputHash,
          },
        })
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiAgentStep.findFirst({ where: { runId: id, stepKey, attempt } })
      if (
        !existing ||
        existing.kind !== command.kind ||
        existing.ordinal !== ordinal ||
        existing.parentStepId !== parentStepId ||
        existing.inputHash !== inputHash
      ) {
        throw new AgentRunConflictError('Agent Step attempt 幂等键已被不同输入占用')
      }
      return existing
    }
  }

  async transitionStep(runId: string, stepId: string, command: TransitionAgentStepCommand): Promise<AiAgentStep> {
    const id = requireText(runId, 'runId', 32)
    const normalizedStepId = requireText(stepId, 'stepId', 32)
    const workerId = requireText(command.workerId, 'workerId', 128)
    if (command.event.stepId && command.event.stepId !== normalizedStepId) {
      throw new AgentExecutionValidationError('event.stepId 与目标 Step 不一致')
    }
    const output =
      command.targetStatus === AiAgentStepStatus.COMPLETED
        ? sanitizeExecutionObject(command.output, 'step output')
        : null
    const outputHash = output ? sha256(canonicalJson(output as never)) : null
    const errorClass = optionalText(command.errorClass, 'errorClass', 128)
    if (command.targetStatus === AiAgentStepStatus.FAILED && !errorClass) {
      throw new AgentExecutionValidationError('FAILED Step 必须提供 errorClass')
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.events.lockRun(tx, id)
      this.events.assertActiveWorkerLease(locked, workerId)
      if (
        locked.run.status === AiAgentRunStatus.CANCEL_REQUESTED &&
        command.targetStatus !== AiAgentStepStatus.CANCELLED
      ) {
        throw new AgentRunConflictError('取消请求后 Step 只能进入 CANCELLED')
      }
      const step = await tx.aiAgentStep.findFirst({ where: { id: normalizedStepId, runId: id } })
      if (!step) throw new AgentRunConflictError('Agent Step 不存在或不属于当前 Run')
      this.stateMachine.assertStepTransition(step.status, command.targetStatus)
      await this.events.appendInTransaction(tx, locked.run, { ...command.event, stepId: normalizedStepId })

      const terminal = TERMINAL_STEP_STATUSES.has(command.targetStatus)
      return tx.aiAgentStep.update({
        where: { id: normalizedStepId },
        data: {
          status: command.targetStatus,
          startedAt: command.targetStatus === AiAgentStepStatus.RUNNING ? new Date() : step.startedAt,
          endedAt: terminal ? new Date() : null,
          outputSummary: output ? toJsonInput(output) : Prisma.DbNull,
          outputHash,
          errorCode: command.targetStatus === AiAgentStepStatus.FAILED ? (command.errorCode ?? null) : null,
          errorClass: command.targetStatus === AiAgentStepStatus.FAILED ? errorClass : null,
          errorMessage:
            command.targetStatus === AiAgentStepStatus.FAILED && command.errorMessage != null
              ? sanitizeExecutionError(command.errorMessage)
              : null,
        },
      })
    })
  }

  private normalizeCreateCommand(command: CreateAgentRunCommand) {
    requirePositiveInteger(command.userId, 'userId')
    const conversationId = requireText(command.conversationId, 'conversationId', 32)
    const triggerMessageId = requireText(command.triggerMessageId, 'triggerMessageId', 32)
    const responseMessageId = requireText(command.responseMessageId, 'responseMessageId', 32)
    const clientRequestId = requireText(command.clientRequestId, 'clientRequestId', 128)
    const traceId = requireText(command.traceId, 'traceId', 128)
    const workflowVersionId = requireText(command.workflowVersionId, 'workflowVersionId', 32)
    const promptVersionId = requireText(command.promptVersionId, 'promptVersionId', 32)
    const toolPolicyVersion = requireText(command.toolPolicyVersion, 'toolPolicyVersion', 40)
    const preferredModel = optionalText(command.preferredModel, 'preferredModel', 128)
    if (!Object.values(AiModelPolicy).includes(command.modelPolicy)) {
      throw new AgentExecutionValidationError('modelPolicy 非法')
    }
    if (command.modelPolicy === AiModelPolicy.MANUAL && !preferredModel) {
      throw new AgentExecutionValidationError('MANUAL modelPolicy 必须指定 preferredModel')
    }
    if (!(command.deadlineAt instanceof Date) || Number.isNaN(command.deadlineAt.getTime())) {
      throw new AgentExecutionValidationError('deadlineAt 非法')
    }
    const remainingMs = command.deadlineAt.getTime() - Date.now()
    if (remainingMs <= 0 || remainingMs > this.config.maxDurationMs) {
      throw new AgentExecutionValidationError(`deadlineAt 必须在未来 ${this.config.maxDurationMs}ms 内`)
    }
    const inputSnapshot = sanitizeExecutionObject(command.inputSnapshot, 'inputSnapshot')
    const budget = sanitizeExecutionObject(command.budget ?? {}, 'budget')
    const maxAttempts = requirePositiveInteger(command.maxAttempts ?? 3, 'maxAttempts', 20)
    const requestHash = sha256(
      canonicalJson({
        budget,
        conversationId,
        inputSnapshot,
        maxAttempts,
        modelPolicy: command.modelPolicy,
        preferredModel,
        promptVersionId,
        responseMessageId,
        toolPolicyVersion,
        triggerMessageId,
        workflowVersionId,
      } as never),
    )
    return {
      userId: command.userId,
      conversationId,
      triggerMessageId,
      responseMessageId,
      clientRequestId,
      traceId,
      workflowVersionId,
      promptVersionId,
      toolPolicyVersion,
      modelPolicy: command.modelPolicy,
      preferredModel,
      inputSnapshot,
      budget,
      maxAttempts,
      deadlineAt: command.deadlineAt,
      requestHash,
    }
  }

  private resolveIdempotentRun(run: AiAgentRun, requestHash: string, startedAt: number): AiAgentRun {
    if (run.requestHash !== requestHash) throw new AgentRunIdempotencyConflictError()
    this.logOperation('createRun', startedAt, 0, run.id)
    return run
  }

  private logOperation(operation: string, startedAt: number, rowCount: number, runId: string): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount, runId }, AgentRunRepository.name)
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
