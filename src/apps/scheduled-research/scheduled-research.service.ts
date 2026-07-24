import { Inject, Injectable } from '@nestjs/common'
import {
  AiModelPolicy,
  AiScheduledTaskStatus,
  AiScheduledTaskTrigger,
  Prisma,
  type AiScheduledTask,
  type AiTaskExecution,
} from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { AgentRunService } from 'src/apps/agent/application/agent-run.service'
import { canonicalJson } from 'src/apps/agent/audit/agent-audit-sanitizer'
import type { AgentCapability } from 'src/apps/agent/contracts'
import { WorkflowRegistryService } from 'src/apps/agent/workflow/workflow-registry.service'
import { AgentSchedulerConfig, type IAgentSchedulerConfig } from 'src/config/agent-scheduler.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import {
  CreateScheduledResearchDto,
  ListScheduledResearchDto,
  ListScheduledResearchExecutionsDto,
  RunScheduledResearchDto,
  ScheduledResearchVersionDto,
  UpdateScheduledResearchDto,
} from './dto/scheduled-research-request.dto'
import {
  assertCronExpression,
  assertTimeZone,
  normalizeCapabilities,
  normalizeJsonObject,
  parseRequiredWatermarks,
  parseStructuredCondition,
  resolveNextRunAt,
  type RequiredWatermark,
  type StructuredCondition,
} from './scheduled-research.policy'
import {
  ScheduledResearchConflictError,
  ScheduledResearchNotFoundError,
  ScheduledResearchValidationError,
} from './scheduled-research.errors'
import { ScheduledResearchRepository, type CreateScheduledTaskRecord } from './scheduled-research.repository'

dayjs.extend(utc)
dayjs.extend(timezone)

type GateOutcome = 'READY' | 'DEFERRED' | 'SKIPPED' | 'CONDITION_NOT_MET'

interface GateResult {
  outcome: GateOutcome
  evidence: Record<string, unknown>
}

interface FrozenTask {
  taskId: string
  userId: number
  name: string
  version: number
  trigger: AiScheduledTaskTrigger
  condition: StructuredCondition | null
  timeZone: string
  tradingDayOnly: boolean
  prompt: string
  input: Record<string, unknown>
  allowedCapabilities: AgentCapability[]
  requiredWatermarks: RequiredWatermark[]
  workflowKey: string
  workflowVersion: number
  workflowContentHash: string
  promptKey: string
  promptVersion: number
  promptContentHash: string
  modelPolicy: AiModelPolicy
  preferredModel: string | null
  maxCostCny: number
}

@Injectable()
export class ScheduledResearchService {
  constructor(
    private readonly repository: ScheduledResearchRepository,
    private readonly workflowRegistry: WorkflowRegistryService,
    private readonly runs: AgentRunService,
    @Inject(AgentSchedulerConfig.KEY) private readonly config: IAgentSchedulerConfig,
    private readonly logger: LoggerService,
  ) {}

  async create(userId: number, dto: CreateScheduledResearchDto) {
    const record = this.buildCreateRecord(userId, dto, new Date())
    const existing = await this.repository.findTaskByClientRequest(userId, dto.clientRequestId)
    if (existing) {
      if (!sameCreateRequest(existing, record))
        throw new ScheduledResearchConflictError('相同 clientRequestId 已用于不同任务配置')
      return toTaskResponse(existing)
    }
    const currentCount = await this.repository.countLiveTasks(userId)
    if (currentCount >= this.config.maxTasksPerUser) {
      throw new ScheduledResearchValidationError(`每位用户最多保存 ${this.config.maxTasksPerUser} 个定时研究任务`)
    }
    const result = await this.repository.createTask(record)
    if (!result.created && !sameCreateRequest(result.task, record)) {
      throw new ScheduledResearchConflictError('相同 clientRequestId 已用于不同任务配置')
    }
    return toTaskResponse(result.task)
  }

  async list(userId: number, dto: ListScheduledResearchDto) {
    const page = await this.repository.listTasks({ userId, ...dto })
    return { items: page.items.map(toTaskResponse), nextCursor: page.nextCursor }
  }

  async detail(userId: number, taskId: string) {
    return toTaskResponse(await this.requireTask(userId, taskId))
  }

  async update(userId: number, dto: UpdateScheduledResearchDto) {
    const current = await this.requireTask(userId, dto.taskId)
    if (current.version !== dto.expectedVersion) throw new ScheduledResearchConflictError()
    const normalized = this.normalizeUpdate(current, dto, new Date())
    const task = await this.repository.updateTask({
      userId,
      taskId: current.id,
      expectedVersion: dto.expectedVersion,
      data: normalized as Prisma.AiScheduledTaskUpdateManyMutationInput,
    })
    if (!task) throw new ScheduledResearchConflictError()
    return toTaskResponse(task)
  }

  async pause(userId: number, dto: ScheduledResearchVersionDto) {
    const current = await this.requireTask(userId, dto.taskId)
    if (current.version !== dto.expectedVersion || current.status !== AiScheduledTaskStatus.ACTIVE) {
      throw new ScheduledResearchConflictError('任务不是可暂停的 ACTIVE 状态，或版本已变化')
    }
    const task = await this.repository.changeStatus({
      userId,
      taskId: current.id,
      expectedVersion: dto.expectedVersion,
      status: AiScheduledTaskStatus.PAUSED,
      nextRunAt: null,
    })
    if (!task) throw new ScheduledResearchConflictError()
    return toTaskResponse(task)
  }

  async resume(userId: number, dto: ScheduledResearchVersionDto) {
    const current = await this.requireTask(userId, dto.taskId)
    if (current.version !== dto.expectedVersion || current.status !== AiScheduledTaskStatus.PAUSED) {
      throw new ScheduledResearchConflictError('任务不是可恢复的 PAUSED 状态，或版本已变化')
    }
    const nextRunAt = this.nextRun(current, new Date())
    const task = await this.repository.changeStatus({
      userId,
      taskId: current.id,
      expectedVersion: dto.expectedVersion,
      status: AiScheduledTaskStatus.ACTIVE,
      nextRunAt,
    })
    if (!task) throw new ScheduledResearchConflictError()
    return toTaskResponse(task)
  }

  async delete(userId: number, dto: ScheduledResearchVersionDto) {
    const current = await this.requireTask(userId, dto.taskId)
    if (current.version !== dto.expectedVersion) throw new ScheduledResearchConflictError()
    const task = await this.repository.changeStatus({
      userId,
      taskId: current.id,
      expectedVersion: dto.expectedVersion,
      status: AiScheduledTaskStatus.DELETED,
      nextRunAt: null,
    })
    if (!task) throw new ScheduledResearchConflictError()
    return toTaskResponse(task)
  }

  async runNow(userId: number, dto: RunScheduledResearchDto) {
    const task = await this.requireTask(userId, dto.taskId)
    if (task.status !== AiScheduledTaskStatus.ACTIVE) {
      throw new ScheduledResearchConflictError('仅 ACTIVE 任务可手动运行')
    }
    const scheduledFor = new Date()
    const gate = await this.evaluateGate(toFrozenTask(task), scheduledFor, { ignoreCondition: true })
    const created = await this.repository.createExecutionOnce({
      task,
      scheduledFor,
      requestKey: `manual:${dto.clientRequestId}`,
      taskSnapshot: frozenTaskSnapshot(toFrozenTask(task)),
      gateEvidence: gate.evidence,
    })
    if (gate.outcome === 'DEFERRED') await this.repository.deferExecution(created.execution.id, gate.evidence)
    if (gate.outcome === 'SKIPPED') await this.repository.skipExecution(created.execution.id, gate.evidence)
    if (gate.outcome === 'READY') await this.dispatchExecution(toFrozenTask(task), created.execution, gate.evidence)
    const execution = await this.executionById(userId, created.execution.id)
    return { executionId: execution.id, status: execution.status, runId: execution.runId }
  }

  async listExecutions(userId: number, dto: ListScheduledResearchExecutionsDto) {
    await this.requireTask(userId, dto.taskId)
    const page = await this.repository.listExecutions({
      userId,
      taskId: dto.taskId,
      cursor: dto.cursor,
      limit: dto.limit,
    })
    return { items: page.items.map(toExecutionResponse), nextCursor: page.nextCursor }
  }

  /** Scanner entry. DB CAS lease is final scanner ownership boundary. */
  async scanDue(now: Date, owner: string): Promise<number> {
    const due = await this.repository.findDue(now, this.config.batchSize)
    let claimed = 0
    for (const candidate of due) {
      const leaseExpiresAt = new Date(now.getTime() + this.config.leaseMs)
      if (!(await this.repository.claimDue(candidate.id, now, owner, leaseExpiresAt))) continue
      claimed += 1
      const task = await this.repository.findTaskById(candidate.id)
      if (!task || task.leaseOwner !== owner || task.status !== AiScheduledTaskStatus.ACTIVE || !task.nextRunAt)
        continue
      try {
        await this.processClaimedTask(task, now)
      } catch (error) {
        this.logger.error(
          { operation: 'scheduledResearch.processDue', taskId: task.id, error: safeErrorMessage(error) },
          ScheduledResearchService.name,
        )
      } finally {
        await this.repository.finishClaim({
          taskId: task.id,
          owner,
          expectedVersion: task.version,
          nextRunAt: this.nextRun(task, now),
        })
      }
    }
    await this.reconcileDeferred(now)
    await this.repository.refreshExecutionStatuses(this.config.batchSize)
    return claimed
  }

  private async processClaimedTask(task: AiScheduledTask, now: Date): Promise<void> {
    const frozen = toFrozenTask(task)
    const scheduledFor = task.nextRunAt ?? now
    const gate = await this.evaluateGate(frozen, now)
    if (gate.outcome === 'CONDITION_NOT_MET') return
    const created = await this.repository.createExecutionOnce({
      task,
      scheduledFor,
      requestKey: `schedule:${scheduledFor.toISOString()}`,
      taskSnapshot: frozenTaskSnapshot(frozen),
      gateEvidence: gate.evidence,
    })
    if (gate.outcome === 'DEFERRED') {
      await this.repository.deferExecution(created.execution.id, gate.evidence)
      return
    }
    if (gate.outcome === 'SKIPPED') {
      await this.repository.skipExecution(created.execution.id, gate.evidence)
      return
    }
    await this.dispatchExecution(frozen, created.execution, gate.evidence)
  }

  private async reconcileDeferred(now: Date): Promise<void> {
    const deferred = await this.repository.findDeferred(this.config.batchSize)
    for (const execution of deferred) {
      if (execution.task.status === AiScheduledTaskStatus.DELETED) {
        await this.repository.skipExecution(execution.id, {
          reason: 'SCHEDULE_DELETED',
          evaluatedAt: now.toISOString(),
        })
        continue
      }
      let frozen: FrozenTask
      try {
        frozen = frozenTaskFromSnapshot(execution.taskSnapshot)
      } catch (error) {
        await this.repository.failExecution(execution.id, 6021, safeErrorMessage(error))
        continue
      }
      try {
        const previousReason =
          typeof asRecord(execution.gateEvidence).reason === 'string' ? asRecord(execution.gateEvidence).reason : null
        const gate = await this.evaluateGate(frozen, now, {
          ignoreCondition: previousReason !== 'CONDITION_DATA_MISSING',
        })
        if (gate.outcome === 'DEFERRED') {
          await this.repository.deferExecution(execution.id, gate.evidence)
          continue
        }
        if (gate.outcome === 'SKIPPED') {
          await this.repository.skipExecution(execution.id, gate.evidence)
          continue
        }
        if (gate.outcome === 'CONDITION_NOT_MET') {
          await this.repository.skipExecution(execution.id, gate.evidence)
          continue
        }
        await this.dispatchExecution(frozen, execution, gate.evidence)
      } catch (error) {
        await this.repository.failExecution(execution.id, numericAgentErrorCode(error), safeErrorMessage(error))
      }
    }
  }

  private async dispatchExecution(
    task: FrozenTask,
    execution: AiTaskExecution,
    gateEvidence: Record<string, unknown>,
  ): Promise<void> {
    if (execution.runId) return
    try {
      const result = await this.runs.sendScheduled({
        userId: task.userId,
        taskId: task.taskId,
        executionId: execution.id,
        taskName: task.name,
        scheduledFor: execution.scheduledFor,
        prompt: task.prompt,
        input: task.input,
        gateEvidence,
        modelPolicy: task.modelPolicy,
        preferredModel: task.preferredModel,
        allowedCapabilities: task.allowedCapabilities,
        maxCostCny: task.maxCostCny,
        workflow: {
          workflowKey: task.workflowKey,
          workflowVersion: task.workflowVersion,
          workflowContentHash: task.workflowContentHash,
          promptKey: task.promptKey,
          promptVersion: task.promptVersion,
          promptContentHash: task.promptContentHash,
        },
      })
      await this.repository.queueExecution(execution.id, result.runId, gateEvidence)
    } catch (error) {
      await this.repository.failExecution(execution.id, numericAgentErrorCode(error), safeErrorMessage(error))
    }
  }

  private async evaluateGate(
    task: FrozenTask,
    now: Date,
    options: { ignoreCondition?: boolean } = {},
  ): Promise<GateResult> {
    const evidence: Record<string, unknown> = {
      schemaVersion: 1,
      evaluatedAt: now.toISOString(),
      taskVersion: task.version,
      checks: [],
    }
    const checks = evidence.checks as Record<string, unknown>[]
    if (task.tradingDayOnly) {
      const tradeDate = dayjs(now).tz(task.timeZone).format('YYYYMMDD')
      const isOpen = await this.repository.isTradingDay(tradeDate)
      checks.push({ kind: 'TRADING_DAY', tradeDate, isOpen })
      if (isOpen == null) return { outcome: 'DEFERRED', evidence: { ...evidence, reason: 'TRADE_CAL_NOT_READY' } }
      if (!isOpen) return { outcome: 'SKIPPED', evidence: { ...evidence, reason: 'NON_TRADING_DAY' } }
    }
    for (const watermark of task.requiredWatermarks) {
      const row = await this.repository.findDailyWatermark(watermark.minTradeDate)
      const entry: Record<string, unknown> = {
        kind: 'WATERMARK',
        dataset: watermark.dataset,
        requiredTradeDate: watermark.minTradeDate ?? null,
        maxAgeMinutes: watermark.maxAgeMinutes ?? null,
        actualTradeDate: row ? formatDate(row.tradeDate) : null,
        syncedAt: row?.syncedAt.toISOString() ?? null,
      }
      checks.push(entry)
      if (!row) return { outcome: 'DEFERRED', evidence: { ...evidence, reason: 'WATERMARK_MISSING' } }
      if (
        watermark.maxAgeMinutes != null &&
        now.getTime() - row.syncedAt.getTime() > watermark.maxAgeMinutes * 60_000
      ) {
        return { outcome: 'DEFERRED', evidence: { ...evidence, reason: 'WATERMARK_STALE' } }
      }
    }
    if (!options.ignoreCondition && task.trigger === AiScheduledTaskTrigger.STRUCTURED_CONDITION) {
      const condition = taskCondition(task)
      const row = await this.repository.findDailyConditionValue(condition.resourceId)
      const conditionEvidence: Record<string, unknown> = {
        kind: 'CONDITION',
        metricKey: condition.metricKey,
        resourceId: condition.resourceId,
        operator: condition.operator,
        threshold: condition.threshold,
        actualTradeDate: row ? formatDate(row.tradeDate) : null,
        syncedAt: row?.syncedAt.toISOString() ?? null,
        actualValue: row?.close ?? null,
      }
      checks.push(conditionEvidence)
      if (!row || row.close == null)
        return { outcome: 'DEFERRED', evidence: { ...evidence, reason: 'CONDITION_DATA_MISSING' } }
      if (!compareCondition(row.close, condition.operator, condition.threshold)) {
        return { outcome: 'CONDITION_NOT_MET', evidence: { ...evidence, reason: 'CONDITION_NOT_MET' } }
      }
      if (condition.cooldownMinutes > 0) {
        const previous = await this.repository.findLatestTriggeredExecution(task.taskId)
        if (previous?.queuedAt && now.getTime() - previous.queuedAt.getTime() < condition.cooldownMinutes * 60_000) {
          return {
            outcome: 'CONDITION_NOT_MET',
            evidence: {
              ...evidence,
              reason: 'CONDITION_COOLDOWN',
              cooldownUntil: new Date(previous.queuedAt.getTime() + condition.cooldownMinutes * 60_000).toISOString(),
            },
          }
        }
      }
    }
    return { outcome: 'READY', evidence }
  }

  private buildCreateRecord(userId: number, dto: CreateScheduledResearchDto, now: Date): CreateScheduledTaskRecord {
    const common = normalizeScheduleShape({
      trigger: dto.trigger,
      cronExpression: dto.cronExpression,
      timeZone: dto.timeZone,
      oneTimeAt: dto.oneTimeAt,
      condition: dto.condition,
      now,
      conditionPollMs: this.config.pollMs,
    })
    const capabilities = normalizeCapabilities(dto.allowedCapabilities)
    const input = normalizeJsonObject(dto.input ?? {}, 'input')
    const watermarks = parseRequiredWatermarks(dto.requiredWatermarks ?? [])
    const model = normalizeModelPolicy(dto.modelPolicy, dto.preferredModel)
    const snapshot = this.workflowRegistry.snapshot(dto.workflowKey, dto.workflowVersion)
    return {
      userId,
      clientRequestId: dto.clientRequestId,
      name: dto.name.trim(),
      ...common,
      tradingDayOnly: dto.tradingDayOnly,
      prompt: dto.prompt.trim(),
      input,
      allowedCapabilities: capabilities,
      requiredWatermarks: watermarks,
      workflowKey: snapshot.workflowKey,
      workflowVersion: snapshot.version,
      workflowContentHash: snapshot.contentHash,
      promptKey: snapshot.prompt.promptKey,
      promptVersion: snapshot.prompt.version,
      promptContentHash: snapshot.prompt.contentHash,
      modelPolicy: model.modelPolicy,
      preferredModel: model.preferredModel,
      maxCostCny: dto.maxCostCny,
      nextRunAt: common.nextRunAt,
    }
  }

  private normalizeUpdate(current: AiScheduledTask, dto: UpdateScheduledResearchDto, now: Date) {
    const trigger = dto.trigger ?? current.trigger
    const common = normalizeScheduleShape({
      trigger,
      cronExpression: dto.cronExpression === undefined ? current.cronExpression : dto.cronExpression,
      timeZone: dto.timeZone ?? current.timeZone,
      oneTimeAt: dto.oneTimeAt === undefined ? current.oneTimeAt : dto.oneTimeAt,
      condition: dto.condition === undefined ? asRecordOrNull(current.condition) : dto.condition,
      now,
      conditionPollMs: this.config.pollMs,
    })
    const capabilities = normalizeCapabilities(dto.allowedCapabilities ?? asStringArray(current.allowedCapabilities))
    const input = normalizeJsonObject(dto.input ?? asRecord(current.input), 'input')
    const watermarks = parseRequiredWatermarks(dto.requiredWatermarks ?? asRecordArray(current.requiredWatermarks))
    const model = normalizeModelPolicy(
      dto.modelPolicy ?? current.modelPolicy,
      dto.preferredModel === undefined ? current.preferredModel : dto.preferredModel,
    )
    return {
      name: dto.name?.trim() ?? current.name,
      ...common,
      tradingDayOnly: dto.tradingDayOnly ?? current.tradingDayOnly,
      prompt: dto.prompt?.trim() ?? current.prompt,
      input,
      allowedCapabilities: capabilities,
      requiredWatermarks: watermarks,
      modelPolicy: model.modelPolicy,
      preferredModel: model.preferredModel,
      maxCostCny: dto.maxCostCny ?? Number(current.maxCostCny),
      nextRunAt: common.nextRunAt,
    }
  }

  private nextRun(task: AiScheduledTask, now: Date): Date | null {
    if (task.trigger === AiScheduledTaskTrigger.ONE_TIME) return null
    const base = task.nextRunAt && task.nextRunAt > now ? task.nextRunAt : now
    return resolveNextRunAt({
      trigger: task.trigger,
      cronExpression: task.cronExpression,
      oneTimeAt: task.oneTimeAt,
      timeZone: task.timeZone,
      now: base,
      conditionPollMs: this.config.pollMs,
    })
  }

  private async requireTask(userId: number, taskId: string): Promise<AiScheduledTask> {
    const task = await this.repository.findTaskForUser(userId, taskId)
    if (!task) throw new ScheduledResearchNotFoundError()
    return task
  }

  private async executionById(userId: number, executionId: string): Promise<AiTaskExecution> {
    const execution = await this.repository.findExecutionForUser(userId, executionId)
    if (!execution) throw new ScheduledResearchNotFoundError('定时研究执行不存在或无权访问')
    return execution
  }
}

function normalizeScheduleShape(input: {
  trigger: AiScheduledTaskTrigger
  cronExpression?: string | null
  timeZone: string
  oneTimeAt?: Date | null
  condition?: unknown
  now: Date
  conditionPollMs: number
}) {
  const timeZone = assertTimeZone(input.timeZone)
  if (input.trigger === AiScheduledTaskTrigger.CRON) {
    if (input.oneTimeAt != null || input.condition != null) {
      throw new ScheduledResearchValidationError('CRON 任务不能同时指定 oneTimeAt 或 condition')
    }
    const cronExpression = assertCronExpression(input.cronExpression ?? '', timeZone)
    return {
      trigger: input.trigger,
      cronExpression,
      timeZone,
      oneTimeAt: null,
      condition: null,
      nextRunAt: resolveNextRunAt({ ...input, cronExpression, timeZone, oneTimeAt: null }),
    }
  }
  if (input.trigger === AiScheduledTaskTrigger.ONE_TIME) {
    if (input.cronExpression != null || input.condition != null) {
      throw new ScheduledResearchValidationError('ONE_TIME 任务不能同时指定 cronExpression 或 condition')
    }
    if (!(input.oneTimeAt instanceof Date) || Number.isNaN(input.oneTimeAt.getTime())) {
      throw new ScheduledResearchValidationError('ONE_TIME 任务必须指定合法 oneTimeAt')
    }
    return {
      trigger: input.trigger,
      cronExpression: null,
      timeZone,
      oneTimeAt: input.oneTimeAt,
      condition: null,
      nextRunAt: resolveNextRunAt({ ...input, timeZone, cronExpression: null, conditionPollMs: input.conditionPollMs }),
    }
  }
  if (input.cronExpression != null || input.oneTimeAt != null) {
    throw new ScheduledResearchValidationError('STRUCTURED_CONDITION 任务不能同时指定 cronExpression 或 oneTimeAt')
  }
  const condition = parseStructuredCondition(input.condition)
  return {
    trigger: input.trigger,
    cronExpression: null,
    timeZone,
    oneTimeAt: null,
    condition,
    nextRunAt: resolveNextRunAt({ ...input, timeZone, cronExpression: null, oneTimeAt: null }),
  }
}

function normalizeModelPolicy(modelPolicy: AiModelPolicy, preferredModel: string | null | undefined) {
  if (modelPolicy === AiModelPolicy.AUTO) {
    if (preferredModel != null) throw new ScheduledResearchValidationError('AUTO modelPolicy 不允许 preferredModel')
    return { modelPolicy, preferredModel: null }
  }
  if (!preferredModel?.trim()) throw new ScheduledResearchValidationError('MANUAL modelPolicy 必须指定 preferredModel')
  return { modelPolicy, preferredModel: preferredModel.trim() }
}

function toFrozenTask(task: AiScheduledTask): FrozenTask {
  return {
    taskId: task.id,
    userId: task.userId,
    name: task.name,
    version: task.version,
    trigger: task.trigger,
    condition: task.condition == null ? null : parseStructuredCondition(task.condition),
    timeZone: task.timeZone,
    tradingDayOnly: task.tradingDayOnly,
    prompt: task.prompt,
    input: asRecord(task.input),
    allowedCapabilities: normalizeCapabilities(asStringArray(task.allowedCapabilities)),
    requiredWatermarks: parseRequiredWatermarks(asRecordArray(task.requiredWatermarks)),
    workflowKey: task.workflowKey,
    workflowVersion: task.workflowVersion,
    workflowContentHash: task.workflowContentHash,
    promptKey: task.promptKey,
    promptVersion: task.promptVersion,
    promptContentHash: task.promptContentHash,
    modelPolicy: task.modelPolicy,
    preferredModel: task.preferredModel,
    maxCostCny: Number(task.maxCostCny),
  }
}

function frozenTaskSnapshot(task: FrozenTask): Record<string, unknown> {
  return { schemaVersion: 1, ...task }
}

function frozenTaskFromSnapshot(value: unknown): FrozenTask {
  const record = asRecord(value)
  if (record.schemaVersion !== 1 || typeof record.taskId !== 'string' || typeof record.userId !== 'number') {
    throw new ScheduledResearchValidationError('execution taskSnapshot 无法恢复')
  }
  const trigger = record.trigger
  if (!Object.values(AiScheduledTaskTrigger).includes(trigger as AiScheduledTaskTrigger)) {
    throw new ScheduledResearchValidationError('execution taskSnapshot trigger 无效')
  }
  return {
    taskId: record.taskId,
    userId: record.userId,
    name: requiredString(record, 'name'),
    version: requiredInteger(record, 'version'),
    trigger: trigger as AiScheduledTaskTrigger,
    condition: record.condition == null ? null : parseStructuredCondition(record.condition),
    timeZone: assertTimeZone(requiredString(record, 'timeZone')),
    tradingDayOnly: record.tradingDayOnly === true,
    prompt: requiredString(record, 'prompt'),
    input: normalizeJsonObject(record.input, 'taskSnapshot.input'),
    allowedCapabilities: normalizeCapabilities(asStringArray(record.allowedCapabilities)),
    requiredWatermarks: parseRequiredWatermarks(asRecordArray(record.requiredWatermarks)),
    workflowKey: requiredString(record, 'workflowKey'),
    workflowVersion: requiredInteger(record, 'workflowVersion'),
    workflowContentHash: requiredHash(record, 'workflowContentHash'),
    promptKey: requiredString(record, 'promptKey'),
    promptVersion: requiredInteger(record, 'promptVersion'),
    promptContentHash: requiredHash(record, 'promptContentHash'),
    modelPolicy: record.modelPolicy === AiModelPolicy.MANUAL ? AiModelPolicy.MANUAL : AiModelPolicy.AUTO,
    preferredModel: typeof record.preferredModel === 'string' ? record.preferredModel : null,
    maxCostCny: requiredPositiveNumber(record, 'maxCostCny'),
  }
}

function taskCondition(task: FrozenTask): StructuredCondition {
  if (task.condition) return task.condition
  throw new ScheduledResearchValidationError('条件任务缺少冻结 condition')
}

function compareCondition(value: number, operator: StructuredCondition['operator'], threshold: number): boolean {
  if (operator === 'GT') return value > threshold
  if (operator === 'GTE') return value >= threshold
  if (operator === 'LT') return value < threshold
  return value <= threshold
}

function toTaskResponse(task: AiScheduledTask) {
  return {
    taskId: task.id,
    name: task.name,
    status: task.status,
    version: task.version,
    trigger: task.trigger,
    cronExpression: task.cronExpression,
    timeZone: task.timeZone,
    oneTimeAt: toIso(task.oneTimeAt),
    condition: asRecordOrNull(task.condition),
    tradingDayOnly: task.tradingDayOnly,
    input: asRecord(task.input),
    allowedCapabilities: asStringArray(task.allowedCapabilities),
    requiredWatermarks: asRecordArray(task.requiredWatermarks),
    workflowKey: task.workflowKey,
    workflowVersion: task.workflowVersion,
    modelPolicy: task.modelPolicy,
    preferredModel: task.preferredModel,
    maxCostCny: Number(task.maxCostCny),
    nextRunAt: toIso(task.nextRunAt),
    pausedAt: toIso(task.pausedAt),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function toExecutionResponse(execution: AiTaskExecution) {
  return {
    executionId: execution.id,
    taskId: execution.taskId,
    status: execution.status,
    requestKey: execution.requestKey,
    scheduledFor: execution.scheduledFor.toISOString(),
    gateEvidence: asRecord(execution.gateEvidence),
    runId: execution.runId,
    errorCode: execution.errorCode,
    errorMessage: execution.errorMessage,
    costCny: execution.costCny == null ? null : Number(execution.costCny),
    queuedAt: toIso(execution.queuedAt),
    startedAt: toIso(execution.startedAt),
    endedAt: toIso(execution.endedAt),
    createdAt: execution.createdAt.toISOString(),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Object(entry) === entry && !Array.isArray(entry))
    : []
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim())
    throw new ScheduledResearchValidationError(`execution taskSnapshot.${key} 无效`)
  return value
}

function requiredHash(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key)
  if (!/^[0-9a-f]{64}$/.test(value)) throw new ScheduledResearchValidationError(`execution taskSnapshot.${key} 无效`)
  return value
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ScheduledResearchValidationError(`execution taskSnapshot.${key} 无效`)
  }
  return value
}

function requiredPositiveNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ScheduledResearchValidationError(`execution taskSnapshot.${key} 无效`)
  }
  return value
}

function formatDate(value: Date): string {
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function numericAgentErrorCode(error: unknown): number | null {
  const code = error && typeof error === 'object' ? (error as Record<string, unknown>).agentCode : null
  if (typeof code === 'number') return code
  const key = error && typeof error === 'object' ? (error as Record<string, unknown>).code : null
  return key === 'AI_COST_QUOTA_EXCEEDED' ? 6019 : null
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 1_000)
}

function sameCreateRequest(task: AiScheduledTask, record: CreateScheduledTaskRecord): boolean {
  return (
    canonicalJson({
      name: task.name,
      trigger: task.trigger,
      cronExpression: task.cronExpression,
      timeZone: task.timeZone,
      oneTimeAt: toIso(task.oneTimeAt),
      condition: task.condition,
      tradingDayOnly: task.tradingDayOnly,
      prompt: task.prompt,
      input: task.input,
      allowedCapabilities: task.allowedCapabilities,
      requiredWatermarks: task.requiredWatermarks,
      workflowKey: task.workflowKey,
      workflowVersion: task.workflowVersion,
      workflowContentHash: task.workflowContentHash,
      promptKey: task.promptKey,
      promptVersion: task.promptVersion,
      promptContentHash: task.promptContentHash,
      modelPolicy: task.modelPolicy,
      preferredModel: task.preferredModel,
      maxCostCny: Number(task.maxCostCny),
    } as never) ===
    canonicalJson({
      name: record.name,
      trigger: record.trigger,
      cronExpression: record.cronExpression,
      timeZone: record.timeZone,
      oneTimeAt: toIso(record.oneTimeAt),
      condition: record.condition,
      tradingDayOnly: record.tradingDayOnly,
      prompt: record.prompt,
      input: record.input,
      allowedCapabilities: record.allowedCapabilities,
      requiredWatermarks: record.requiredWatermarks,
      workflowKey: record.workflowKey,
      workflowVersion: record.workflowVersion,
      workflowContentHash: record.workflowContentHash,
      promptKey: record.promptKey,
      promptVersion: record.promptVersion,
      promptContentHash: record.promptContentHash,
      modelPolicy: record.modelPolicy,
      preferredModel: record.preferredModel,
      maxCostCny: record.maxCostCny,
    } as never)
  )
}
