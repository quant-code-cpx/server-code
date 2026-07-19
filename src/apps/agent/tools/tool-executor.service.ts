import { Inject, Injectable, Optional } from '@nestjs/common'
import { AiToolCallStatus, type AiToolCall } from '@prisma/client'
import { AgentAuditRepository } from '../audit/agent-audit.repository'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { ToolDefinition } from './contracts/tool-definition'
import {
  TOOL_ERROR_AGENT_CODE,
  ToolAdapterError,
  ToolExecutionError,
  type ToolError,
  type ToolErrorCode,
} from './contracts/tool-error'
import { TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver } from './contracts/tool-observer'
import type { ToolResult } from './contracts/tool-result'
import { cloneAndFreezeJson, hashStableJson, stableJson } from './tool-json'
import { ToolPolicyDeniedError, ToolPolicyService } from './tool-policy.service'
import { ToolRegistryError, ToolRegistryService } from './tool-registry.service'
import { ToolRunLimiterService, ToolRunLimitError, type ToolRunReservation } from './tool-run-limiter.service'
import { isIsoDate, isIsoDateTime, ToolSchemaValidator } from './tool-schema-validator'
import type { ToolAccessContext, ToolExecutionContext } from './tool-access-context'

export interface ExecuteToolCommand {
  toolKey: string
  toolVersion: number
  logicalNodeKey: string
  invocationIndex?: number
  input: unknown
}

interface InFlightToolExecution {
  fingerprint: string
  parentSignal?: AbortSignal
  promise: Promise<ToolResult>
}

const SAFE_MESSAGE: Readonly<Record<ToolErrorCode, string>> = {
  TOOL_NOT_REGISTERED: 'Tool 未注册或未启用',
  INVALID_ARGUMENT: 'Tool 参数校验失败',
  PERMISSION_DENIED: '无权使用该 Tool',
  DATA_NOT_FOUND: '指定条件下没有可用数据',
  CONFIRMATION_REQUIRED: 'Tool 需要用户明确确认',
  QUOTA_EXCEEDED: 'Tool 调用额度已用尽',
  RATE_LIMITED: 'Tool 调用频率受限',
  TIMEOUT: 'Tool 执行超时',
  CANCELLED: 'Tool 调用已取消',
  UPSTREAM_FAILED: 'Tool 上游服务失败',
  DATA_NOT_READY: 'Tool 数据尚未就绪',
  DATA_STALE: 'Tool 数据时效不满足要求',
  DATA_QUALITY_FAILED: 'Tool 数据质量门禁失败',
  OUTPUT_SCHEMA_INVALID: 'Tool 输出协议无效',
  RESULT_TOO_LARGE: 'Tool 结果超过限制',
  INTERNAL_ERROR: 'Tool 内部错误',
}
const STORED_ERROR_STATUSES = new Set<AiToolCallStatus>([
  AiToolCallStatus.FAILED,
  AiToolCallStatus.REJECTED,
  AiToolCallStatus.CANCELLED,
])
const TOOL_CALL_TERMINAL_STATUSES = new Set<AiToolCallStatus>([
  AiToolCallStatus.SUCCEEDED,
  AiToolCallStatus.FAILED,
  AiToolCallStatus.REJECTED,
  AiToolCallStatus.CANCELLED,
])
const TOOL_CALL_PRE_EXECUTION_STATUSES = new Set<AiToolCallStatus>([
  AiToolCallStatus.PENDING,
  AiToolCallStatus.AUTHORIZING,
])
const RETRYABLE_TOOL_ERRORS = new Set<ToolErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM_FAILED',
  'DATA_NOT_READY',
  'INTERNAL_ERROR',
])
const TOOL_RESULT_KEYS = new Set([
  'ok',
  'toolCallId',
  'toolKey',
  'toolVersion',
  'data',
  'provenance',
  'citationSourceIds',
  'warnings',
  'truncated',
  'nextCursor',
])
const TOOL_PROVENANCE_KEYS = new Set([
  'sourceType',
  'sourceServices',
  'sourceModels',
  'asOf',
  'timezone',
  'unit',
  'currency',
  'adjustment',
  'dataVersion',
  'algorithmVersion',
  'inputHash',
  'outputHash',
])
const TOOL_PROVENANCE_AS_OF_KEYS = new Set([
  'tradeDate',
  'reportPeriod',
  'announcementDate',
  'availableAt',
  'retrievedAt',
])
const TOOL_WARNING_KEYS = new Set(['code', 'message', 'affectedFields'])

@Injectable()
export class ToolExecutorService {
  private readonly inFlight = new Map<string, InFlightToolExecution>()

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly validator: ToolSchemaValidator,
    private readonly policy: ToolPolicyService,
    private readonly limiter: ToolRunLimiterService,
    private readonly audit: AgentAuditRepository,
    @Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig,
    private readonly logger: LoggerService,
    @Optional() @Inject(TOOL_EXECUTION_OBSERVER) private readonly observer?: ToolExecutionObserver,
  ) {}

  execute(command: ExecuteToolCommand, context: ToolExecutionContext): Promise<ToolResult> {
    const normalized = normalizeCommand(command)
    const normalizedContext = normalizeExecutionContext(context)
    const executionKey = `${normalizedContext.runId}\u0000${normalized.logicalNodeKey}\u0000${normalized.invocationIndex}`
    const fingerprint = invocationFingerprint(normalized, normalizedContext)
    if (!fingerprint) return this.executeInternal(normalized, normalizedContext)
    const existing = this.inFlight.get(executionKey)
    if (existing) {
      if (existing.fingerprint === fingerprint && existing.parentSignal === normalizedContext.parentSignal) {
        return existing.promise
      }
      return Promise.reject(new Error('Tool 逻辑调用幂等键已被不同的并发请求占用'))
    }

    const promise = this.executeInternal(normalized, normalizedContext).finally(() => {
      if (this.inFlight.get(executionKey)?.promise === promise) this.inFlight.delete(executionKey)
    })
    this.inFlight.set(executionKey, { fingerprint, parentSignal: normalizedContext.parentSignal, promise })
    return promise
  }

  private async executeInternal(command: NormalizedToolCommand, context: ToolExecutionContext): Promise<ToolResult> {
    const startedAt = Date.now()
    let call: AiToolCall
    try {
      call = await this.audit.beginToolCall({
        userId: context.userId,
        scopeId: requireText(context.scopeId, 'scopeId', 64),
        runId: requireText(context.runId, 'runId', 32),
        stepId: requireText(context.stepId, 'stepId', 32),
        logicalNodeKey: command.logicalNodeKey,
        invocationIndex: command.invocationIndex,
        toolName: command.toolKey,
        toolVersion: String(command.toolVersion),
        input: command.input,
        initialStatus: AiToolCallStatus.AUTHORIZING,
      })
    } catch (error) {
      this.logger.error(
        { operation: 'tool.audit.begin', toolKey: command.toolKey, runId: context.runId },
        undefined,
        ToolExecutorService.name,
      )
      throw new Error(`Tool audit start failed: ${error instanceof Error ? error.name : 'unknown'}`)
    }

    let definition: ToolDefinition
    let input: unknown
    try {
      definition = this.registry.get(command.toolKey, command.toolVersion)
      const inputValidation = this.validator.validateInput(definition, command.input)
      if (!inputValidation.valid) {
        throw new ToolAdapterError('INVALID_ARGUMENT', SAFE_MESSAGE.INVALID_ARGUMENT, false, undefined, {
          issue: inputValidation.issues[0] ?? 'schema',
        })
      }
      input = cloneAndFreezeJson(command.input)
      this.policy.authorize(definition, context)
    } catch (error) {
      const normalized = normalizePreExecutionError(error, call.id, command)
      await this.finishRejectedCall(call, context.userId, normalized, startedAt)
      throw new ToolExecutionError(normalized)
    }

    if (call.status === AiToolCallStatus.SUCCEEDED) {
      return this.restoreCompletedResult(call, definition, input)
    }
    if (STORED_ERROR_STATUSES.has(call.status)) {
      throw new ToolExecutionError(errorFromStoredCall(call, command))
    }

    let reservation: ToolRunReservation | undefined
    try {
      reservation = this.limiter.reserve(context.runId, context.callsUsed, context.maxConcurrentCalls)
    } catch (error) {
      const normalized = normalizePreExecutionError(error, call.id, command)
      await this.finishRejectedCall(call, context.userId, normalized, startedAt)
      throw new ToolExecutionError(normalized)
    }

    try {
      const attempt = call.status === AiToolCallStatus.RETRY_WAIT ? call.attemptCount + 1 : call.attemptCount
      if (call.status !== AiToolCallStatus.RUNNING) {
        call = await this.audit.markToolCallRunning(context.userId, call.id, attempt)
      }
      return await this.executeAttempts(definition, input, context, call.id, attempt, startedAt)
    } finally {
      reservation.release()
    }
  }

  private async executeAttempts(
    definition: ToolDefinition,
    input: unknown,
    context: ToolExecutionContext,
    toolCallId: string,
    initialAttempt: number,
    startedAt: number,
  ): Promise<ToolResult> {
    let attempt = initialAttempt
    while (attempt <= definition.policy.maxAttempts) {
      const attemptStartedAt = Date.now()
      const timeoutMs = resolveAttemptTimeout(definition, context, this.config.defaultTimeoutMs)
      if (timeoutMs <= 0) {
        return this.finishFailure(context, toolCallId, attempt, toolError(toolCallId, definition, 'TIMEOUT'), startedAt)
      }

      this.observe('onStarted', {
        runId: context.runId,
        toolCallId,
        toolKey: definition.key,
        version: definition.version,
        attempt,
      })

      try {
        const result = await runWithAbort(
          definition,
          input,
          { ...context, toolCallId, attempt } as ToolExecutionContext & { toolCallId: string; attempt: number },
          timeoutMs,
        )
        const checked = this.validateResult(definition, result, input, toolCallId)
        const durationMs = Date.now() - attemptStartedAt
        await this.audit.completeToolCall(context.userId, toolCallId, {
          output: checked.result,
          dataAsOf: toAuditDate(checked.result),
          dataThrough: toAuditDate(checked.result),
          marketTimezone: checked.result.provenance.timezone,
          dataVersion: checked.result.provenance.dataVersion ?? checked.result.provenance.algorithmVersion ?? null,
          qualityFlags: checked.result.warnings.map((warning) => warning.code),
          sourceTasks: checked.result.provenance.sourceServices,
          rowCount: checked.rowCount,
          truncated: checked.result.truncated,
          durationMs: Date.now() - startedAt,
        })
        this.observe('onCompleted', {
          runId: context.runId,
          toolCallId,
          attempt,
          durationMs,
          rowCount: checked.rowCount,
          resultBytes: checked.bytes,
          truncated: checked.result.truncated,
          dataAsOf: displayAsOf(checked.result),
        })
        this.logOutcome(
          'success',
          definition,
          context,
          toolCallId,
          attempt,
          durationMs,
          checked.rowCount,
          checked.bytes,
        )
        return checked.result
      } catch (error) {
        const normalized = normalizeExecutionError(error, toolCallId, definition)
        const durationMs = Date.now() - attemptStartedAt
        if (normalized.code === 'CANCELLED') {
          await this.persistCancellation(context.userId, toolCallId, normalized, Date.now() - startedAt)
          this.observe('onFailed', { runId: context.runId, toolCallId, attempt, durationMs, error: normalized })
          this.logOutcome('cancelled', definition, context, toolCallId, attempt, durationMs)
          throw new ToolExecutionError(normalized)
        }

        const willRetry = canRetry(definition, normalized, attempt, context.deadlineAt)
        if (willRetry) {
          await this.audit.markToolCallRetryWait(context.userId, toolCallId, {
            expectedAttempt: attempt,
            errorClass: normalized.code,
            errorCode: TOOL_ERROR_AGENT_CODE[normalized.code],
            errorMessage: normalized.message,
            durationMs: Date.now() - startedAt,
          })
          this.observe('onRetry', { runId: context.runId, toolCallId, attempt, error: normalized })
          try {
            await waitForRetry(
              normalized.retryAfterMs ?? retryDelayMs(attempt),
              context.parentSignal,
              context.deadlineAt,
            )
          } catch (waitError) {
            const interrupted = normalizeExecutionError(waitError, toolCallId, definition)
            if (interrupted.code === 'CANCELLED') {
              await this.persistCancellation(context.userId, toolCallId, interrupted, Date.now() - startedAt)
              this.observe('onFailed', {
                runId: context.runId,
                toolCallId,
                attempt,
                durationMs: Date.now() - attemptStartedAt,
                error: interrupted,
              })
              throw new ToolExecutionError(interrupted)
            }
            return this.finishFailure(context, toolCallId, attempt, interrupted, startedAt)
          }
          attempt += 1
          await this.audit.markToolCallRunning(context.userId, toolCallId, attempt)
          continue
        }
        return this.finishFailure(context, toolCallId, attempt, normalized, startedAt)
      }
    }
    return this.finishFailure(
      context,
      toolCallId,
      initialAttempt,
      toolError(toolCallId, definition, 'INTERNAL_ERROR'),
      startedAt,
    )
  }

  private validateResult(
    definition: ToolDefinition,
    result: ToolResult,
    input: unknown,
    toolCallId: string,
  ): { result: ToolResult; rowCount: number; bytes: number } {
    let normalizedResult: ToolResult
    try {
      normalizedResult = cloneAndFreezeJson(result)
    } catch {
      throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
    }
    assertToolResultEnvelope(normalizedResult, definition, toolCallId)
    const outputValidation = this.validator.validateOutput(definition, normalizedResult.data)
    if (!outputValidation.valid) {
      throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
    }
    if (normalizedResult.provenance.inputHash && normalizedResult.provenance.inputHash !== hashStableJson(input)) {
      throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
    }
    const rowCount = countRows(definition, normalizedResult.data)
    if (rowCount > definition.policy.maxRows) {
      throw new ToolAdapterError('RESULT_TOO_LARGE', SAFE_MESSAGE.RESULT_TOO_LARGE)
    }
    let serialized: string
    try {
      serialized = stableJson(normalizedResult)
    } catch {
      throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
    }
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes > this.config.maxResultBytes) {
      throw new ToolAdapterError('RESULT_TOO_LARGE', SAFE_MESSAGE.RESULT_TOO_LARGE)
    }
    return { result: normalizedResult, rowCount, bytes }
  }

  private restoreCompletedResult(call: AiToolCall, definition: ToolDefinition, input: unknown): ToolResult {
    try {
      const result = call.outputSummary as unknown as ToolResult
      return this.validateResult(definition, result, input, call.id).result
    } catch {
      throw new ToolExecutionError(toolError(call.id, definition, 'DATA_NOT_READY'))
    }
  }

  private async finishRejectedCall(
    call: AiToolCall,
    userId: number,
    error: ToolError,
    startedAt: number,
  ): Promise<void> {
    if (TOOL_CALL_TERMINAL_STATUSES.has(call.status)) {
      return
    }
    const command = auditFailure(error, Date.now() - startedAt)
    if (TOOL_CALL_PRE_EXECUTION_STATUSES.has(call.status)) {
      await this.audit.rejectToolCall(userId, call.id, command)
    } else {
      await this.audit.failToolCall(userId, call.id, command)
    }
  }

  private async persistCancellation(
    userId: number,
    callId: string,
    error: ToolError,
    durationMs: number,
  ): Promise<void> {
    await this.audit.cancelToolCall(userId, callId, auditFailure(error, durationMs))
  }

  private async finishFailure(
    context: ToolExecutionContext,
    toolCallId: string,
    attempt: number,
    error: ToolError,
    startedAt: number,
  ): Promise<never> {
    const durationMs = Date.now() - startedAt
    await this.audit.failToolCall(context.userId, toolCallId, auditFailure(error, durationMs))
    this.observe('onFailed', { runId: context.runId, toolCallId, attempt, durationMs, error })
    this.logger.warn(
      {
        operation: 'tool.execute',
        status: 'failed',
        runId: context.runId,
        toolCallId,
        attempt,
        errorClass: error.code,
        durationMs,
      },
      ToolExecutorService.name,
    )
    throw new ToolExecutionError(error)
  }

  private observe<K extends keyof ToolExecutionObserver>(
    method: K,
    event: Parameters<NonNullable<ToolExecutionObserver[K]>>[0],
  ): void {
    try {
      const observerMethod = this.observer?.[method] as ((value: typeof event) => void) | undefined
      observerMethod?.(event)
    } catch (error) {
      this.logger.warn(
        { operation: 'tool.observer', method, errorClass: error instanceof Error ? error.name : 'unknown' },
        ToolExecutorService.name,
      )
    }
  }

  private logOutcome(
    status: string,
    definition: ToolDefinition,
    context: ToolExecutionContext,
    toolCallId: string,
    attempt: number,
    durationMs: number,
    rowCount?: number,
    resultBytes?: number,
  ): void {
    this.logger.log(
      {
        operation: 'tool.execute',
        status,
        traceId: context.traceId,
        runId: context.runId,
        toolCallId,
        toolKey: definition.key,
        toolVersion: definition.version,
        attempt,
        durationMs,
        rowCount,
        resultBytes,
      },
      ToolExecutorService.name,
    )
  }
}

interface NormalizedToolCommand extends ExecuteToolCommand {
  invocationIndex: number
}

function normalizeCommand(command: ExecuteToolCommand): NormalizedToolCommand {
  const toolKey = requireText(command.toolKey, 'toolKey', 96)
  if (!Number.isInteger(command.toolVersion) || command.toolVersion < 1) throw new Error('toolVersion 必须为正整数')
  const logicalNodeKey = requireText(command.logicalNodeKey, 'logicalNodeKey', 128)
  const invocationIndex = command.invocationIndex ?? 0
  if (!Number.isSafeInteger(invocationIndex) || invocationIndex < 0) throw new Error('invocationIndex 必须为非负整数')
  return { ...command, toolKey, logicalNodeKey, invocationIndex }
}

function normalizeExecutionContext(context: ToolExecutionContext): ToolExecutionContext {
  return {
    ...context,
    scopeId: requireText(context.scopeId, 'scopeId', 64),
    conversationId: requireText(context.conversationId, 'conversationId', 32),
    runId: requireText(context.runId, 'runId', 32),
    stepId: requireText(context.stepId, 'stepId', 32),
    traceId: requireText(context.traceId, 'traceId', 64),
  }
}

function invocationFingerprint(command: NormalizedToolCommand, context: ToolExecutionContext): string | null {
  try {
    return hashStableJson({
      toolKey: command.toolKey,
      toolVersion: command.toolVersion,
      input: command.input,
      userId: context.userId,
      role: context.role,
      userStatus: context.userStatus,
      scopeId: context.scopeId,
      conversationId: context.conversationId,
      runId: context.runId,
      stepId: context.stepId,
      traceId: context.traceId,
      workflowAllowedTools: [...context.workflowAllowedTools].sort(),
      allowedScopes: [...context.allowedScopes].sort(),
      callsUsed: context.callsUsed,
      deadlineAt: context.deadlineAt.toISOString(),
      maxConcurrentCalls: context.maxConcurrentCalls ?? null,
    })
  } catch {
    return null
  }
}

async function runWithAbort(
  definition: ToolDefinition,
  input: unknown,
  context: ToolExecutionContext & { toolCallId: string; attempt: number },
  timeoutMs: number,
): Promise<ToolResult> {
  const parentSignal = context.parentSignal
  if (parentSignal?.aborted) throw new ToolAdapterError('CANCELLED', SAFE_MESSAGE.CANCELLED)
  const controller = new AbortController()
  const abortFromParent = () => controller.abort('parent-cancelled')
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const accessContext: ToolAccessContext = { ...context, abortSignal: controller.signal }

  try {
    return await Promise.race([
      definition.execute(input as never, accessContext),
      new Promise<never>((_, reject) => {
        const rejectAborted = () => {
          const code = controller.signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED'
          reject(new ToolAdapterError(code, SAFE_MESSAGE[code], code === 'TIMEOUT'))
        }
        if (controller.signal.aborted) rejectAborted()
        else controller.signal.addEventListener('abort', rejectAborted, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function resolveAttemptTimeout(
  definition: ToolDefinition,
  context: ToolExecutionContext,
  defaultTimeoutMs: number,
): number {
  return Math.floor(Math.min(definition.policy.timeoutMs, defaultTimeoutMs, context.deadlineAt.getTime() - Date.now()))
}

function canRetry(definition: ToolDefinition, error: ToolError, attempt: number, deadlineAt: Date): boolean {
  return (
    definition.policy.sideEffect === 'READ' &&
    definition.policy.idempotent &&
    error.retryable &&
    RETRYABLE_TOOL_ERRORS.has(error.code) &&
    attempt < definition.policy.maxAttempts &&
    deadlineAt.getTime() > Date.now()
  )
}

async function waitForRetry(delayMs: number, signal: AbortSignal | undefined, deadlineAt: Date): Promise<void> {
  const boundedDelay = Math.max(0, Math.min(delayMs, 30_000))
  if (Date.now() + boundedDelay >= deadlineAt.getTime()) {
    throw new ToolAdapterError('TIMEOUT', SAFE_MESSAGE.TIMEOUT, true)
  }
  if (signal?.aborted) throw new ToolAdapterError('CANCELLED', SAFE_MESSAGE.CANCELLED)
  if (boundedDelay === 0) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new ToolAdapterError('CANCELLED', SAFE_MESSAGE.CANCELLED))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, boundedDelay)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function retryDelayMs(attempt: number): number {
  return Math.min(1_000, 100 * 2 ** Math.max(0, attempt - 1))
}

function normalizePreExecutionError(error: unknown, toolCallId: string, command: NormalizedToolCommand): ToolError {
  if (error instanceof ToolAdapterError)
    return fromAdapterError(error, toolCallId, command.toolKey, command.toolVersion)
  if (error instanceof ToolRegistryError)
    return rawToolError(toolCallId, command.toolKey, command.toolVersion, 'TOOL_NOT_REGISTERED')
  if (error instanceof ToolPolicyDeniedError || error instanceof ToolRunLimitError) {
    return rawToolError(toolCallId, command.toolKey, command.toolVersion, error.code)
  }
  return rawToolError(toolCallId, command.toolKey, command.toolVersion, 'INTERNAL_ERROR')
}

function normalizeExecutionError(error: unknown, toolCallId: string, definition: ToolDefinition): ToolError {
  if (error instanceof ToolExecutionError) return error.result
  if (error instanceof ToolAdapterError) return fromAdapterError(error, toolCallId, definition.key, definition.version)
  return toolError(toolCallId, definition, 'INTERNAL_ERROR')
}

function fromAdapterError(
  error: ToolAdapterError,
  toolCallId: string,
  toolKey: string,
  toolVersion: number,
): ToolError {
  const retryAfterMs = normalizeRetryAfter(error.retryAfterMs)
  const details = normalizeSafeDetails(error.details)
  return {
    ...rawToolError(toolCallId, toolKey, toolVersion, error.code),
    retryable: error.retryable && RETRYABLE_TOOL_ERRORS.has(error.code),
    ...(retryAfterMs == null ? {} : { retryAfterMs }),
    ...(details ? { details } : {}),
  }
}

function toolError(toolCallId: string, definition: ToolDefinition, code: ToolErrorCode): ToolError {
  return rawToolError(toolCallId, definition.key, definition.version, code)
}

function rawToolError(toolCallId: string, toolKey: string, toolVersion: number, code: ToolErrorCode): ToolError {
  return { ok: false, toolCallId, toolKey, toolVersion, code, message: SAFE_MESSAGE[code], retryable: false }
}

function errorFromStoredCall(call: AiToolCall, command: NormalizedToolCommand): ToolError {
  const code = isToolErrorCode(call.errorClass) ? call.errorClass : 'INTERNAL_ERROR'
  return rawToolError(call.id, command.toolKey, command.toolVersion, code)
}

function isToolErrorCode(value: string | null): value is ToolErrorCode {
  return value != null && Object.prototype.hasOwnProperty.call(SAFE_MESSAGE, value)
}

function auditFailure(error: ToolError, durationMs: number) {
  return {
    errorClass: error.code,
    errorCode: TOOL_ERROR_AGENT_CODE[error.code],
    errorMessage: error.message,
    durationMs,
  }
}

function assertToolResultEnvelope(result: ToolResult, definition: ToolDefinition, toolCallId: string): void {
  if (
    !result ||
    !hasOnlyKeys(result, TOOL_RESULT_KEYS) ||
    result.ok !== true ||
    result.toolCallId !== toolCallId ||
    result.toolKey !== definition.key ||
    result.toolVersion !== definition.version
  ) {
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  }
  const provenance = result.provenance
  if (
    !provenance ||
    !hasOnlyKeys(provenance, TOOL_PROVENANCE_KEYS) ||
    !['DATABASE', 'PROGRAM_CALCULATION', 'OFFICIAL', 'MEDIA', 'INSTITUTION'].includes(provenance.sourceType) ||
    !isNonEmptyStringArray(provenance.sourceServices, 50, 160) ||
    !Array.isArray(provenance.sourceModels) ||
    provenance.sourceModels.length > 50 ||
    provenance.sourceModels.some((item) => !isTrimmedText(item, 160)) ||
    !provenance.asOf ||
    !hasOnlyKeys(provenance.asOf, TOOL_PROVENANCE_AS_OF_KEYS) ||
    !isIsoDateTime(provenance.asOf.retrievedAt) ||
    typeof provenance.timezone !== 'string' ||
    !isIanaTimezone(provenance.timezone) ||
    !validOptionalDate(provenance.asOf.tradeDate) ||
    !validOptionalDate(provenance.asOf.reportPeriod) ||
    !validOptionalDate(provenance.asOf.announcementDate) ||
    !validOptionalDateTime(provenance.asOf.availableAt) ||
    (provenance.unit != null && !isTrimmedText(provenance.unit, 64)) ||
    (provenance.currency != null && !/^[A-Z]{3}$/.test(provenance.currency)) ||
    (provenance.adjustment != null && !['NONE', 'FORWARD', 'BACKWARD'].includes(provenance.adjustment)) ||
    (provenance.dataVersion != null && !isTrimmedText(provenance.dataVersion, 160)) ||
    (provenance.algorithmVersion != null && !isTrimmedText(provenance.algorithmVersion, 160)) ||
    (provenance.inputHash != null && !/^[0-9a-f]{64}$/.test(provenance.inputHash)) ||
    (provenance.outputHash != null && !/^[0-9a-f]{64}$/.test(provenance.outputHash))
  ) {
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  }
  if (
    !Array.isArray(result.citationSourceIds) ||
    result.citationSourceIds.length > 200 ||
    !result.citationSourceIds.every(isSafeId)
  ) {
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  }
  if (!Array.isArray(result.warnings) || result.warnings.length > 100) {
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  }
  for (const warning of result.warnings) {
    if (
      !warning ||
      !hasOnlyKeys(warning, TOOL_WARNING_KEYS) ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(warning.code) ||
      !isTrimmedText(warning.message, 500) ||
      (warning.affectedFields != null &&
        (!Array.isArray(warning.affectedFields) ||
          warning.affectedFields.length > 50 ||
          warning.affectedFields.some((field) => !isTrimmedText(field, 128))))
    ) {
      throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
    }
  }
  if (
    typeof result.truncated !== 'boolean' ||
    (result.nextCursor != null && !isTrimmedText(result.nextCursor, 1_000))
  ) {
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  }
}

function countRows(definition: ToolDefinition, data: unknown): number {
  const count = definition.countRows ? definition.countRows(data as never) : inferRows(data)
  if (!Number.isSafeInteger(count) || count < 0)
    throw new ToolAdapterError('OUTPUT_SCHEMA_INVALID', SAFE_MESSAGE.OUTPUT_SCHEMA_INVALID)
  return count
}

function inferRows(data: unknown): number {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === 'object') {
    for (const key of ['rows', 'items', 'points', 'results']) {
      const value = (data as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value.length
    }
    return 1
  }
  return 0
}

function toAuditDate(result: ToolResult): Date | null {
  const value = result.provenance.asOf.tradeDate ?? result.provenance.asOf.reportPeriod
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null
}

function displayAsOf(result: ToolResult): string | null {
  return (
    result.provenance.asOf.tradeDate ??
    result.provenance.asOf.reportPeriod ??
    result.provenance.asOf.announcementDate ??
    result.provenance.asOf.availableAt ??
    null
  )
}

function isNonEmptyStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxItems &&
    value.every((item) => isTrimmedText(item, maxLength))
  )
}

function isSafeId(value: unknown): value is string {
  return isTrimmedText(value, 128)
}

function isTrimmedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value === value.trim()
}

function hasOnlyKeys(value: object, allowed: ReadonlySet<string>): boolean {
  return !Array.isArray(value) && Object.keys(value).every((key) => allowed.has(key))
}

function validOptionalDate(value: string | undefined): boolean {
  return value == null || isIsoDate(value)
}

function validOptionalDateTime(value: string | undefined): boolean {
  return value == null || isIsoDateTime(value)
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function normalizeRetryAfter(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined
  return Math.min(30_000, Math.floor(value))
}

function normalizeSafeDetails(
  details: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue
    if (/(password|token|secret|cookie|authorization|apikey|privatekey|credential)/i.test(key)) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    safe[key] = typeof value === 'string' ? value.slice(0, 200) : value
  }
  return Object.keys(safe).length ? safe : undefined
}

function requireText(value: string, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new Error(`${name} 必须为 1-${maxLength} 字符`)
  return normalized
}
