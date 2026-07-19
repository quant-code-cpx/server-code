import { Injectable } from '@nestjs/common'
import {
  AiAuditPayloadMode,
  AiModelCallStatus,
  AiToolCallStatus,
  AiVersionStatus,
  Prisma,
  type AiModelCall,
  type AiPromptVersion,
  type AiToolCall,
  type AiWorkflowVersion,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  canonicalJson,
  sanitizeAndHashAuditPayload,
  sanitizeAuditErrorMessage,
  sha256,
  type AuditJsonValue,
} from './agent-audit-sanitizer'

export class AgentAuditNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} 不存在或无权访问`)
    this.name = AgentAuditNotFoundError.name
  }
}

export class AgentAuditConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = AgentAuditConflictError.name
  }
}

export class AgentAuditValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = AgentAuditValidationError.name
  }
}

export interface BeginToolCallCommand {
  userId: number
  scopeId: string
  runId: string
  stepId: string
  logicalNodeKey: string
  invocationIndex?: number
  toolName: string
  toolVersion: string
  input: unknown
  payloadMode?: AiAuditPayloadMode
  inputRef?: string | null
  initialStatus?: AiToolCallStatus
}

export interface CompleteToolCallCommand {
  output: unknown
  outputRef?: string | null
  dataAsOf?: Date | null
  dataThrough?: Date | null
  marketTimezone?: string | null
  dataVersion?: string | null
  qualityFlags?: unknown[]
  sourceTasks?: unknown[]
  rowCount?: number | null
  truncated?: boolean
  durationMs?: number | null
}

export interface AuditFailureCommand {
  errorClass: string
  errorCode?: number | null
  errorMessage?: unknown
  durationMs?: number | null
}

export interface RetryToolCallCommand extends AuditFailureCommand {
  expectedAttempt: number
}

export interface BeginModelCallCommand {
  userId: number
  scopeId: string
  runId: string
  stepId?: string | null
  promptVersionId: string
  provider: string
  model: string
  purpose: string
  attemptCount?: number
  providerRequestId?: string | null
  request: unknown
  streaming?: boolean
  payloadMode?: AiAuditPayloadMode
  requestRef?: string | null
}

export interface FinishModelCallCommand {
  output: unknown
  responseRef?: string | null
  providerRequestId?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
  reasoningTokens?: number | null
  cost?: Prisma.Decimal | string | number | null
  costCurrency?: string | null
  costEstimated?: boolean
  latencyMs?: number | null
  finishReason?: string | null
}

export interface CreatePromptDraftCommand {
  promptKey: string
  version: number
  template: string
  inputSchema?: unknown
  outputSchema?: unknown
  createdBy: number
}

export interface CreateWorkflowDraftCommand {
  workflowKey: string
  version: number
  definition: unknown
  toolAllowlist?: string[]
  inputSchema?: unknown
  outputSchema?: unknown
  createdBy: number
}

const TOOL_CALL_INITIAL_STATUSES = new Set<AiToolCallStatus>([
  AiToolCallStatus.PENDING,
  AiToolCallStatus.AUTHORIZING,
  AiToolCallStatus.RUNNING,
])
const TOOL_CALL_CAN_START_STATUSES = new Set<AiToolCallStatus>([
  AiToolCallStatus.AUTHORIZING,
  AiToolCallStatus.RETRY_WAIT,
])

@Injectable()
export class AgentAuditRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async beginToolCall(command: BeginToolCallCommand): Promise<AiToolCall> {
    const startedAt = Date.now()
    const scopeId = requireText(command.scopeId, 'scopeId', 64)
    const runId = requireText(command.runId, 'runId', 32)
    const stepId = requireText(command.stepId, 'stepId', 32)
    const logicalNodeKey = requireText(command.logicalNodeKey, 'logicalNodeKey', 128)
    const toolName = requireText(command.toolName, 'toolName', 96)
    const toolVersion = requireText(command.toolVersion, 'toolVersion', 40)
    const invocationIndex = command.invocationIndex ?? 0
    requireNonNegativeInteger(invocationIndex, 'invocationIndex')
    const payloadMode = command.payloadMode ?? AiAuditPayloadMode.HASH_ONLY
    const initialStatus = command.initialStatus ?? AiToolCallStatus.RUNNING
    if (!TOOL_CALL_INITIAL_STATUSES.has(initialStatus)) {
      throw new AgentAuditValidationError('Tool 调用 initialStatus 非法')
    }
    const inputRef = validatePayloadRef(payloadMode, command.inputRef, 'inputRef')
    const input = sanitizeContainer(command.input, true)

    try {
      const call = await this.prisma.aiToolCall.create({
        data: {
          userId: command.userId,
          scopeId,
          runId,
          stepId,
          logicalNodeKey,
          invocationIndex,
          toolName,
          toolVersion,
          status: initialStatus,
          payloadMode,
          inputSummary: toJsonInput(input.summary),
          inputHash: input.hash,
          inputRef,
        },
      })
      this.logOperation('beginToolCall', startedAt, 1)
      return call
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiToolCall.findFirst({
        where: { userId: command.userId, scopeId, logicalNodeKey, invocationIndex },
      })
      if (
        !existing ||
        existing.toolName !== toolName ||
        existing.toolVersion !== toolVersion ||
        existing.inputHash !== input.hash ||
        existing.runId !== runId ||
        existing.stepId !== stepId ||
        existing.payloadMode !== payloadMode ||
        existing.inputRef !== inputRef
      ) {
        throw new AgentAuditConflictError('Tool 调用幂等键已被不同输入占用')
      }
      this.logOperation('beginToolCall', startedAt, 0)
      return existing
    }
  }

  async markToolCallRunning(userId: number, callId: string, attemptCount: number): Promise<AiToolCall> {
    requirePositiveInteger(attemptCount, 'attemptCount')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tool_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiToolCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('Tool 调用')
      if (call.status === AiToolCallStatus.RUNNING && call.attemptCount === attemptCount) return call
      if (call.status === AiToolCallStatus.AUTHORIZING && attemptCount !== call.attemptCount) {
        throw new AgentAuditConflictError('Tool 首次执行 attemptCount 冲突')
      }
      if (call.status === AiToolCallStatus.RETRY_WAIT && attemptCount !== call.attemptCount + 1) {
        throw new AgentAuditConflictError('Tool 重试 attemptCount 必须递增 1')
      }
      if (!TOOL_CALL_CAN_START_STATUSES.has(call.status)) {
        throw new AgentAuditConflictError(`Tool 调用状态 ${call.status} 不可进入 RUNNING`)
      }
      return tx.aiToolCall.update({
        where: { id: call.id },
        data: {
          status: AiToolCallStatus.RUNNING,
          attemptCount,
          errorCode: null,
          errorClass: null,
          errorMessage: null,
        },
      })
    })
  }

  async markToolCallRetryWait(userId: number, callId: string, command: RetryToolCallCommand): Promise<AiToolCall> {
    requirePositiveInteger(command.expectedAttempt, 'expectedAttempt')
    validateOptionalNonNegativeInteger(command.durationMs, 'durationMs')
    const errorClass = requireText(command.errorClass, 'errorClass', 128)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tool_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiToolCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('Tool 调用')
      if (call.status === AiToolCallStatus.RETRY_WAIT && call.attemptCount === command.expectedAttempt) {
        if (call.errorClass !== errorClass || call.errorCode !== (command.errorCode ?? null)) {
          throw new AgentAuditConflictError('Tool retry attempt 已记录不同错误')
        }
        return call
      }
      if (call.status !== AiToolCallStatus.RUNNING || call.attemptCount !== command.expectedAttempt) {
        throw new AgentAuditConflictError('Tool retry attempt 状态冲突')
      }
      return tx.aiToolCall.update({
        where: { id: call.id },
        data: {
          status: AiToolCallStatus.RETRY_WAIT,
          errorClass,
          errorCode: command.errorCode ?? null,
          errorMessage: command.errorMessage == null ? null : sanitizeAuditErrorMessage(command.errorMessage),
          durationMs: command.durationMs ?? null,
        },
      })
    })
  }

  async rejectToolCall(userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    return this.finishToolCallWithoutOutput(userId, callId, AiToolCallStatus.REJECTED, command)
  }

  async cancelToolCall(userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    return this.finishToolCallWithoutOutput(userId, callId, AiToolCallStatus.CANCELLED, command)
  }

  async completeToolCall(userId: number, callId: string, command: CompleteToolCallCommand): Promise<AiToolCall> {
    const startedAt = Date.now()
    const output = sanitizeContainer(command.output, false)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tool_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiToolCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('Tool 调用')
      if (call.status === AiToolCallStatus.SUCCEEDED) {
        if (call.outputHash !== output.hash) throw new AgentAuditConflictError('Tool 调用已由不同输出完成')
        this.logOperation('completeToolCall', startedAt, 0)
        return call
      }
      assertToolCallCanFinish(call.status)
      const outputRef = validatePayloadRef(call.payloadMode, command.outputRef, 'outputRef')
      validateOptionalNonNegativeInteger(command.rowCount, 'rowCount')
      validateOptionalNonNegativeInteger(command.durationMs, 'durationMs')
      const durationMs = command.durationMs ?? Math.max(0, Date.now() - call.startedAt.getTime())
      const finishedAt = new Date()
      const updated = await tx.aiToolCall.update({
        where: { id: call.id },
        data: {
          status: AiToolCallStatus.SUCCEEDED,
          outputSummary: toJsonInput(output.summary),
          outputHash: output.hash,
          outputRef,
          dataAsOf: command.dataAsOf ?? null,
          dataThrough: command.dataThrough ?? null,
          marketTimezone: optionalText(command.marketTimezone, 64),
          dataVersion: optionalText(command.dataVersion, 160),
          qualityFlags: toJsonInput(sanitizeContainer(command.qualityFlags ?? [], false).summary),
          sourceTasks: toJsonInput(sanitizeContainer(command.sourceTasks ?? [], false).summary),
          rowCount: command.rowCount ?? null,
          truncated: command.truncated ?? false,
          finishedAt,
          durationMs,
          errorCode: null,
          errorClass: null,
          errorMessage: null,
        },
      })
      this.logOperation('completeToolCall', startedAt, 1)
      return updated
    })
  }

  async failToolCall(userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    const startedAt = Date.now()
    const errorClass = requireText(command.errorClass, 'errorClass', 128)
    validateOptionalNonNegativeInteger(command.durationMs, 'durationMs')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tool_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiToolCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('Tool 调用')
      if (call.status === AiToolCallStatus.FAILED) return call
      assertToolCallCanFinish(call.status)
      const updated = await tx.aiToolCall.update({
        where: { id: call.id },
        data: {
          status: AiToolCallStatus.FAILED,
          errorClass,
          errorCode: command.errorCode ?? null,
          errorMessage: command.errorMessage == null ? null : sanitizeAuditErrorMessage(command.errorMessage),
          finishedAt: new Date(),
          durationMs: command.durationMs ?? Math.max(0, Date.now() - call.startedAt.getTime()),
        },
      })
      this.logOperation('failToolCall', startedAt, 1)
      return updated
    })
  }

  private async finishToolCallWithoutOutput(
    userId: number,
    callId: string,
    targetStatus: 'REJECTED' | 'CANCELLED',
    command: AuditFailureCommand,
  ): Promise<AiToolCall> {
    const errorClass = requireText(command.errorClass, 'errorClass', 128)
    validateOptionalNonNegativeInteger(command.durationMs, 'durationMs')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tool_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiToolCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('Tool 调用')
      if (call.status === targetStatus) return call
      assertToolCallCanFinish(call.status)
      return tx.aiToolCall.update({
        where: { id: call.id },
        data: {
          status: targetStatus,
          errorClass,
          errorCode: command.errorCode ?? null,
          errorMessage: command.errorMessage == null ? null : sanitizeAuditErrorMessage(command.errorMessage),
          finishedAt: new Date(),
          durationMs: command.durationMs ?? Math.max(0, Date.now() - call.startedAt.getTime()),
        },
      })
    })
  }

  async beginModelCall(command: BeginModelCallCommand): Promise<AiModelCall> {
    const startedAt = Date.now()
    const scopeId = requireText(command.scopeId, 'scopeId', 64)
    const runId = requireText(command.runId, 'runId', 32)
    const stepId = optionalText(command.stepId, 32)
    const provider = requireText(command.provider, 'provider', 64)
    const model = requireText(command.model, 'model', 128)
    const purpose = requireText(command.purpose, 'purpose', 32)
    const attemptCount = command.attemptCount ?? 1
    requirePositiveInteger(attemptCount, 'attemptCount')
    const payloadMode = command.payloadMode ?? AiAuditPayloadMode.HASH_ONLY
    const requestRef = validatePayloadRef(payloadMode, command.requestRef, 'requestRef')
    const request = sanitizeContainer(command.request, true)

    try {
      const call = await this.prisma.aiModelCall.create({
        data: {
          userId: command.userId,
          scopeId,
          runId,
          stepId,
          promptVersionId: requireText(command.promptVersionId, 'promptVersionId', 32),
          provider,
          model,
          purpose,
          providerRequestId: optionalText(command.providerRequestId, 160),
          status: command.streaming ? AiModelCallStatus.STREAMING : AiModelCallStatus.PENDING,
          attemptCount,
          payloadMode,
          requestSummary: toJsonInput(request.summary),
          requestHash: request.hash,
          requestRef,
        },
      })
      this.logOperation('beginModelCall', startedAt, 1)
      return call
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiModelCall.findFirst({
        where: { userId: command.userId, scopeId, provider, model, purpose, attemptCount },
      })
      if (
        !existing ||
        existing.requestHash !== request.hash ||
        existing.promptVersionId !== command.promptVersionId ||
        existing.runId !== runId ||
        existing.stepId !== stepId ||
        existing.payloadMode !== payloadMode ||
        existing.requestRef !== requestRef
      ) {
        throw new AgentAuditConflictError('模型调用 attempt 幂等键已被不同请求占用')
      }
      this.logOperation('beginModelCall', startedAt, 0)
      return existing
    }
  }

  async finishModelCall(userId: number, callId: string, command: FinishModelCallCommand): Promise<AiModelCall> {
    const startedAt = Date.now()
    const output = sanitizeContainer(command.output, false)
    validateModelUsage(command)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_model_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiModelCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('模型调用')
      if (call.status === AiModelCallStatus.SUCCEEDED) {
        if (call.responseHash !== output.hash) throw new AgentAuditConflictError('模型调用已由不同输出完成')
        this.logOperation('finishModelCall', startedAt, 0)
        return call
      }
      assertModelCallCanFinish(call.status)
      const responseRef = validatePayloadRef(call.payloadMode, command.responseRef, 'responseRef')
      const cost = command.cost == null ? null : new Prisma.Decimal(command.cost)
      if (cost?.isNegative()) throw new AgentAuditValidationError('cost 必须为非负数')
      const costCurrency = optionalText(command.costCurrency, 3)?.toUpperCase() ?? null
      if ((cost === null) !== (costCurrency === null))
        throw new AgentAuditValidationError('cost 与 costCurrency 必须同时提供')
      if (costCurrency && !/^[A-Z]{3}$/.test(costCurrency)) {
        throw new AgentAuditValidationError('costCurrency 必须为 3 位大写货币代码')
      }
      const updated = await tx.aiModelCall.update({
        where: { id: call.id },
        data: {
          status: AiModelCallStatus.SUCCEEDED,
          providerRequestId: optionalText(command.providerRequestId, 160) ?? call.providerRequestId,
          outputSummary: toJsonInput(output.summary),
          responseHash: output.hash,
          responseRef,
          inputTokens: command.inputTokens ?? null,
          outputTokens: command.outputTokens ?? null,
          cachedTokens: command.cachedTokens ?? null,
          reasoningTokens: command.reasoningTokens ?? null,
          cost,
          costCurrency,
          costEstimated: command.costEstimated ?? false,
          latencyMs: command.latencyMs ?? Math.max(0, Date.now() - call.startedAt.getTime()),
          finishReason: optionalText(command.finishReason, 80),
          finishedAt: new Date(),
          errorCode: null,
          errorClass: null,
          errorMessage: null,
        },
      })
      this.logOperation('finishModelCall', startedAt, 1)
      return updated
    })
  }

  async failModelCall(userId: number, callId: string, command: AuditFailureCommand): Promise<AiModelCall> {
    const startedAt = Date.now()
    const errorClass = requireText(command.errorClass, 'errorClass', 128)
    validateOptionalNonNegativeInteger(command.durationMs, 'durationMs')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_model_calls WHERE id = ${callId} FOR UPDATE`)
      const call = await tx.aiModelCall.findFirst({ where: { id: callId, userId } })
      if (!call) throw new AgentAuditNotFoundError('模型调用')
      if (call.status === AiModelCallStatus.FAILED) return call
      assertModelCallCanFinish(call.status)
      const updated = await tx.aiModelCall.update({
        where: { id: call.id },
        data: {
          status: AiModelCallStatus.FAILED,
          errorClass,
          errorCode: command.errorCode ?? null,
          errorMessage: command.errorMessage == null ? null : sanitizeAuditErrorMessage(command.errorMessage),
          finishedAt: new Date(),
          latencyMs: command.durationMs ?? Math.max(0, Date.now() - call.startedAt.getTime()),
        },
      })
      this.logOperation('failModelCall', startedAt, 1)
      return updated
    })
  }

  async createPromptDraft(command: CreatePromptDraftCommand): Promise<AiPromptVersion> {
    const promptKey = requireText(command.promptKey, 'promptKey', 128)
    const template = requireText(command.template, 'template')
    requirePositiveInteger(command.version, 'version')
    const inputSchema = normalizeVersionObject(command.inputSchema, 'inputSchema')
    const outputSchema = normalizeVersionObject(command.outputSchema, 'outputSchema')
    const contentHash = sha256(canonicalJson({ inputSchema, outputSchema, template }))
    try {
      return await this.prisma.aiPromptVersion.create({
        data: {
          promptKey,
          version: command.version,
          template,
          inputSchema: toJsonInput(inputSchema),
          outputSchema: toJsonInput(outputSchema),
          contentHash,
          createdBy: command.createdBy,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiPromptVersion.findFirst({ where: { promptKey, version: command.version } })
      if (!existing || existing.contentHash !== contentHash) {
        throw new AgentAuditConflictError('Prompt 版本号或内容 hash 已存在')
      }
      return existing
    }
  }

  async publishPromptVersion(id: string, publishedBy: number): Promise<AiPromptVersion> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_prompt_versions WHERE id = ${id} FOR UPDATE`)
      const version = await tx.aiPromptVersion.findUnique({ where: { id } })
      if (!version) throw new AgentAuditNotFoundError('Prompt 版本')
      if (version.status === AiVersionStatus.PUBLISHED) return version
      if (version.status !== AiVersionStatus.DRAFT) throw new AgentAuditConflictError('仅 DRAFT Prompt 可发布')
      return tx.aiPromptVersion.update({
        where: { id },
        data: { status: AiVersionStatus.PUBLISHED, publishedBy, publishedAt: new Date() },
      })
    })
  }

  async createWorkflowDraft(command: CreateWorkflowDraftCommand): Promise<AiWorkflowVersion> {
    const workflowKey = requireText(command.workflowKey, 'workflowKey', 128)
    requirePositiveInteger(command.version, 'version')
    const definition = normalizeVersionObject(command.definition, 'definition')
    const toolAllowlist = [
      ...new Set((command.toolAllowlist ?? []).map((key) => requireText(key, 'tool key', 96))),
    ].sort()
    const inputSchema = normalizeVersionObject(command.inputSchema, 'inputSchema')
    const outputSchema = normalizeVersionObject(command.outputSchema, 'outputSchema')
    const contentHash = sha256(canonicalJson({ definition, inputSchema, outputSchema, toolAllowlist }))
    try {
      return await this.prisma.aiWorkflowVersion.create({
        data: {
          workflowKey,
          version: command.version,
          definition: toJsonInput(definition),
          toolAllowlist,
          inputSchema: toJsonInput(inputSchema),
          outputSchema: toJsonInput(outputSchema),
          contentHash,
          createdBy: command.createdBy,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiWorkflowVersion.findFirst({
        where: { workflowKey, version: command.version },
      })
      if (!existing || existing.contentHash !== contentHash) {
        throw new AgentAuditConflictError('Workflow 版本号或内容 hash 已存在')
      }
      return existing
    }
  }

  async publishWorkflowVersion(id: string, publishedBy: number): Promise<AiWorkflowVersion> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_workflow_versions WHERE id = ${id} FOR UPDATE`)
      const version = await tx.aiWorkflowVersion.findUnique({ where: { id } })
      if (!version) throw new AgentAuditNotFoundError('Workflow 版本')
      if (version.status === AiVersionStatus.PUBLISHED) return version
      if (version.status !== AiVersionStatus.DRAFT) throw new AgentAuditConflictError('仅 DRAFT Workflow 可发布')
      return tx.aiWorkflowVersion.update({
        where: { id },
        data: { status: AiVersionStatus.PUBLISHED, publishedBy, publishedAt: new Date() },
      })
    })
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, AgentAuditRepository.name)
  }
}

function sanitizeContainer(value: unknown, requireObject: boolean): { summary: AuditJsonValue; hash: string } {
  const sanitized = sanitizeAndHashAuditPayload(value)
  const validContainer = sanitized.summary !== null && typeof sanitized.summary === 'object'
  const validObject = validContainer && !Array.isArray(sanitized.summary)
  const summary =
    requireObject && !validObject
      ? { value: sanitized.summary }
      : validContainer
        ? sanitized.summary
        : { value: sanitized.summary }
  return { summary, hash: sha256(canonicalJson(summary)) }
}

function normalizeVersionObject(value: unknown, name: string): { [key: string]: AuditJsonValue } {
  const seen = new WeakSet<object>()
  const visit = (input: unknown, depth: number): AuditJsonValue => {
    if (input === null) return null
    if (typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new AgentAuditValidationError(`${name} 包含非有限数值`)
      return input
    }
    if (typeof input !== 'object') throw new AgentAuditValidationError(`${name} 必须可序列化为 JSON`)
    if (depth >= 20) throw new AgentAuditValidationError(`${name} 嵌套过深`)
    if (seen.has(input)) throw new AgentAuditValidationError(`${name} 不能包含循环引用`)
    seen.add(input)
    try {
      if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1))
      const result: Record<string, AuditJsonValue> = {}
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        result[key] = visit((input as Record<string, unknown>)[key], depth + 1)
      }
      return result
    } finally {
      seen.delete(input)
    }
  }

  const normalized = visit(value ?? {}, 0)
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    throw new AgentAuditValidationError(`${name} 必须为 JSON object`)
  }
  return normalized
}

function toJsonInput(value: AuditJsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function requireText(value: string, name: string, maxLength?: number): string {
  const normalized = value.trim()
  if (!normalized) throw new AgentAuditValidationError(`${name} 不能为空`)
  if (maxLength && normalized.length > maxLength) throw new AgentAuditValidationError(`${name} 超过 ${maxLength} 字符`)
  return normalized
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new AgentAuditValidationError(`字段超过 ${maxLength} 字符`)
  return normalized
}

function validatePayloadRef(
  mode: AiAuditPayloadMode,
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const normalized = optionalText(value, 500)
  if (normalized && mode !== AiAuditPayloadMode.ENCRYPTED_REF) {
    throw new AgentAuditValidationError(`${fieldName} 仅允许 ENCRYPTED_REF 模式`)
  }
  return normalized
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new AgentAuditValidationError(`${name} 必须为正整数`)
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new AgentAuditValidationError(`${name} 必须为非负整数`)
}

function validateOptionalNonNegativeInteger(value: number | null | undefined, name: string): void {
  if (value != null) requireNonNegativeInteger(value, name)
}

function validateModelUsage(command: FinishModelCallCommand): void {
  validateOptionalNonNegativeInteger(command.inputTokens, 'inputTokens')
  validateOptionalNonNegativeInteger(command.outputTokens, 'outputTokens')
  validateOptionalNonNegativeInteger(command.cachedTokens, 'cachedTokens')
  validateOptionalNonNegativeInteger(command.reasoningTokens, 'reasoningTokens')
  validateOptionalNonNegativeInteger(command.latencyMs, 'latencyMs')
}

function assertToolCallCanFinish(status: AiToolCallStatus): void {
  if (
    status === AiToolCallStatus.SUCCEEDED ||
    status === AiToolCallStatus.FAILED ||
    status === AiToolCallStatus.CANCELLED ||
    status === AiToolCallStatus.REJECTED
  ) {
    throw new AgentAuditConflictError(`Tool 调用终态 ${status} 不可覆盖`)
  }
}

function assertModelCallCanFinish(status: AiModelCallStatus): void {
  if (
    status === AiModelCallStatus.SUCCEEDED ||
    status === AiModelCallStatus.FAILED ||
    status === AiModelCallStatus.CANCELLED
  ) {
    throw new AgentAuditConflictError(`模型调用终态 ${status} 不可覆盖`)
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
