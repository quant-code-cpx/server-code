import { AiToolCallStatus, Prisma, UserRole, UserStatus, type AiToolCall } from '@prisma/client'
import {
  AgentAuditRepository,
  type AuditFailureCommand,
  type BeginToolCallCommand,
  type CompleteToolCallCommand,
  type RetryToolCallCommand,
} from 'src/apps/agent/audit/agent-audit.repository'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { ToolDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import type { ToolExecutionObserver } from '../contracts/tool-observer'
import type { ToolResult } from '../contracts/tool-result'
import { ToolExecutorService } from '../tool-executor.service'
import { hashStableJson } from '../tool-json'
import { ToolPolicyService } from '../tool-policy.service'
import { ToolRegistryService } from '../tool-registry.service'
import { ToolRunLimiterService } from '../tool-run-limiter.service'
import { ToolSchemaValidator } from '../tool-schema-validator'
import type { ToolAccessContext, ToolExecutionContext } from '../tool-access-context'

const baseConfig = {
  enabledTools: ['resolve_security'],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
  priceMaxBars: 5_000,
  marketCacheTtlSeconds: 300,
} as IAgentToolsConfig

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    userId: 1,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope_1',
    conversationId: 'conversation_1',
    runId: 'run_1',
    stepId: 'step_1',
    traceId: 'trace_1',
    workflowAllowedTools: ['resolve_security'],
    allowedScopes: ['PUBLIC_MARKET_DATA'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function toolResult(
  access: ToolAccessContext,
  input: Record<string, unknown>,
  rows: Array<{ tsCode: string; name: string }> = [{ tsCode: '600000.SH', name: '浦发银行' }],
): ToolResult<{ rows: Array<{ tsCode: string; name: string }> }> {
  return {
    ok: true,
    toolCallId: access.toolCallId,
    toolKey: 'resolve_security',
    toolVersion: 1,
    data: { rows },
    provenance: {
      sourceType: 'DATABASE',
      sourceServices: ['StockToolFixture'],
      sourceModels: ['StockBasic'],
      asOf: { tradeDate: '2026-07-18', retrievedAt: '2026-07-19T03:00:00.000Z' },
      timezone: 'Asia/Shanghai',
      dataVersion: 'stock-basic:20260718',
      inputHash: hashStableJson(input),
    },
    citationSourceIds: [],
    warnings: [],
    truncated: false,
  }
}

function definition(execute: ToolDefinition['execute'], overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    key: 'resolve_security',
    version: 1,
    description: '按名称或代码解析证券',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1, maxLength: 64 } },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tsCode', 'name'],
            properties: { tsCode: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    },
    policy: {
      requiredRole: UserRole.USER,
      sideEffect: 'READ',
      requiresConfirmation: false,
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 2,
      maxRows: 20,
      costClass: 'LOW',
      allowedDataScopes: ['PUBLIC_MARKET_DATA'],
    },
    execute,
    ...overrides,
  }
}

class StatefulAuditFake {
  readonly calls = new Map<string, AiToolCall>()
  readonly history: string[] = []
  failBegin = false
  failComplete = false
  private sequence = 0

  async beginToolCall(command: BeginToolCallCommand): Promise<AiToolCall> {
    this.history.push('begin')
    if (this.failBegin) throw new Error('audit unavailable')
    const idempotencyKey = `${command.userId}:${command.scopeId}:${command.logicalNodeKey}:${command.invocationIndex}`
    const existing = this.calls.get(idempotencyKey)
    if (existing) return existing
    const call = {
      id: `tool_call_${++this.sequence}`,
      userId: command.userId,
      scopeId: command.scopeId,
      runId: command.runId,
      stepId: command.stepId,
      logicalNodeKey: command.logicalNodeKey,
      invocationIndex: command.invocationIndex,
      toolName: command.toolName,
      toolVersion: command.toolVersion,
      status: command.initialStatus,
      attemptCount: 1,
      inputSummary: command.input,
      inputHash: hashStableJson(command.input),
      outputSummary: null,
      outputHash: null,
      errorClass: null,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    } as unknown as AiToolCall
    this.calls.set(idempotencyKey, call)
    return call
  }

  async markToolCallRunning(_userId: number, callId: string, attemptCount: number): Promise<AiToolCall> {
    this.history.push(`running:${attemptCount}`)
    return this.update(callId, { status: AiToolCallStatus.RUNNING, attemptCount, errorClass: null })
  }

  async markToolCallRetryWait(_userId: number, callId: string, command: RetryToolCallCommand): Promise<AiToolCall> {
    this.history.push(`retry:${command.expectedAttempt}`)
    return this.update(callId, {
      status: AiToolCallStatus.RETRY_WAIT,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
    })
  }

  async completeToolCall(_userId: number, callId: string, command: CompleteToolCallCommand): Promise<AiToolCall> {
    this.history.push('complete')
    if (this.failComplete) throw new Error('audit complete unavailable')
    return this.update(callId, {
      status: AiToolCallStatus.SUCCEEDED,
      outputSummary: command.output as Prisma.JsonValue,
      outputHash: hashStableJson(command.output),
      finishedAt: new Date(),
      rowCount: command.rowCount,
    })
  }

  async failToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    this.history.push(`failed:${command.errorClass}`)
    return this.update(callId, {
      status: AiToolCallStatus.FAILED,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
      finishedAt: new Date(),
    })
  }

  async rejectToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    this.history.push(`rejected:${command.errorClass}`)
    return this.update(callId, {
      status: AiToolCallStatus.REJECTED,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
      finishedAt: new Date(),
    })
  }

  async cancelToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    this.history.push('cancelled')
    return this.update(callId, {
      status: AiToolCallStatus.CANCELLED,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
      finishedAt: new Date(),
    })
  }

  countStatus(status: AiToolCallStatus): number {
    return [...this.calls.values()].filter((call) => call.status === status).length
  }

  private update(callId: string, patch: Partial<AiToolCall>): AiToolCall {
    const entry = [...this.calls.entries()].find(([, call]) => call.id === callId)
    if (!entry) throw new Error('missing fake audit call')
    const updated = { ...entry[1], ...patch } as AiToolCall
    this.calls.set(entry[0], updated)
    return updated
  }
}

function harness(
  adapter: jest.MockedFunction<ToolDefinition['execute']>,
  options: {
    config?: Partial<IAgentToolsConfig>
    definition?: Partial<ToolDefinition>
    audit?: StatefulAuditFake
  } = {},
) {
  const config = { ...baseConfig, ...options.config } as IAgentToolsConfig
  const validator = new ToolSchemaValidator()
  const tool = definition(adapter, options.definition)
  const registry = new ToolRegistryService(validator, config, [tool])
  registry.onModuleInit()
  const audit = options.audit ?? new StatefulAuditFake()
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService
  const observer: ToolExecutionObserver = {
    onStarted: jest.fn(),
    onRetry: jest.fn(),
    onCompleted: jest.fn(),
    onFailed: jest.fn(),
  }
  const limiter = new ToolRunLimiterService(config)
  const executor = new ToolExecutorService(
    registry,
    validator,
    new ToolPolicyService(config),
    limiter,
    audit as unknown as AgentAuditRepository,
    config,
    logger,
    observer,
  )
  return { executor, audit, observer, limiter, logger, definition: tool }
}

const command = { toolKey: 'resolve_security', toolVersion: 1, logicalNodeKey: 'resolve', input: { query: '浦发银行' } }

describe('ToolExecutorService', () => {
  it('合法调用按 audit→authorize→adapter→output audit 执行，返回来源完整结果且日志无原 input', async () => {
    const adapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>),
    )
    const { executor, audit, observer, logger } = harness(adapter)
    const value = await executor.execute(command, context())

    expect(value.data).toEqual({ rows: [{ tsCode: '600000.SH', name: '浦发银行' }] })
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(adapter.mock.calls[0][0])).toBe(true)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.data)).toBe(true)
    expect(audit.history).toEqual(['begin', 'running:1', 'complete'])
    expect(observer.onStarted).toHaveBeenCalledTimes(1)
    expect(observer.onCompleted).toHaveBeenCalledTimes(1)
    expect(observer.onCompleted).toHaveBeenCalledWith(
      expect.not.objectContaining({ result: expect.anything(), data: expect.anything() }),
    )
    expect(JSON.stringify((logger.log as jest.Mock).mock.calls)).not.toContain('浦发银行')
  })

  it('同逻辑调用并发合并，完成后重复调用复用审计结果，不再次触达 adapter', async () => {
    const adapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>),
    )
    const { executor, audit } = harness(adapter)
    const [left, right] = await Promise.all([
      executor.execute(command, context()),
      executor.execute(command, context({ runId: ' run_1 ' })),
    ])
    const restored = await executor.execute(command, context())

    expect(left).toEqual(right)
    expect(restored).toEqual(left)
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(audit.countStatus(AiToolCallStatus.SUCCEEDED)).toBe(1)
  })

  it('同一逻辑幂等键的并发输入不同立即冲突，不把首个请求结果返回给第二个请求', async () => {
    let release: (() => void) | undefined
    const adapter = jest.fn(
      async (input: Record<string, unknown>, access: ToolAccessContext) =>
        new Promise<ToolResult>((resolve) => {
          release = () => resolve(toolResult(access, input))
        }),
    )
    const { executor } = harness(adapter)
    const first = executor.execute(command, context())
    while (!release) await Promise.resolve()

    await expect(executor.execute({ ...command, input: { query: '招商银行' } }, context())).rejects.toThrow(
      '幂等键已被不同的并发请求占用',
    )
    release()
    await expect(first).resolves.toMatchObject({ data: { rows: [{ name: '浦发银行' }] } })
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('仅 retryable+idempotent READ 自动重试；同 toolCallId、attempt 递增并最终成功', async () => {
    const adapter = jest
      .fn()
      .mockRejectedValueOnce(new ToolAdapterError('UPSTREAM_FAILED', 'raw provider details', true, 0))
      .mockImplementation(async (input, access: ToolAccessContext) =>
        toolResult(access, input as Record<string, unknown>),
      )
    const { executor, audit, observer } = harness(adapter)
    const value = await executor.execute(command, context())

    expect(value.ok).toBe(true)
    expect(adapter).toHaveBeenCalledTimes(2)
    expect(audit.history).toEqual(['begin', 'running:1', 'retry:1', 'running:2', 'complete'])
    expect(observer.onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }))
    expect((adapter.mock.calls[1][1] as ToolAccessContext).attempt).toBe(2)
    expect((adapter.mock.calls[0][1] as ToolAccessContext).toolCallId).toBe(
      (adapter.mock.calls[1][1] as ToolAccessContext).toolCallId,
    )
  })

  it('adapter 不能把 INVALID_ARGUMENT 标成可重试；retry wait 超过 Run deadline 后落 FAILED 终态', async () => {
    const invalidAdapter = jest.fn().mockRejectedValue(new ToolAdapterError('INVALID_ARGUMENT', 'retry me', true, 0))
    const invalidHarness = harness(invalidAdapter)
    await expect(invalidHarness.executor.execute(command, context())).rejects.toMatchObject({
      result: { code: 'INVALID_ARGUMENT', retryable: false },
    })
    expect(invalidAdapter).toHaveBeenCalledTimes(1)
    expect(invalidHarness.audit.history).not.toContain('retry:1')

    const retryAdapter = jest.fn().mockRejectedValue(new ToolAdapterError('UPSTREAM_FAILED', 'transient', true, 1_000))
    const retryHarness = harness(retryAdapter)
    await expect(
      retryHarness.executor.execute(command, context({ deadlineAt: new Date(Date.now() + 50) })),
    ).rejects.toMatchObject({ result: { code: 'TIMEOUT' } })
    expect(retryHarness.audit.history).toEqual(['begin', 'running:1', 'retry:1', 'failed:TIMEOUT'])
    expect(retryHarness.audit.countStatus(AiToolCallStatus.FAILED)).toBe(1)
  })

  it('retry wait 期间 parent cancel 落 CANCELLED，不残留 RETRY_WAIT', async () => {
    const controller = new AbortController()
    const adapter = jest.fn().mockRejectedValue(new ToolAdapterError('UPSTREAM_FAILED', 'transient', true, 1_000))
    const { executor, audit } = harness(adapter)
    const pending = executor.execute(command, context({ parentSignal: controller.signal }))
    while (!audit.history.includes('retry:1')) await new Promise((resolve) => setImmediate(resolve))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ result: { code: 'CANCELLED' } })
    expect(audit.countStatus(AiToolCallStatus.CANCELLED)).toBe(1)
    expect(audit.countStatus(AiToolCallStatus.RETRY_WAIT)).toBe(0)
  })

  it.each([
    ['unknown', { ...command, toolKey: 'query_database' }, context(), 'TOOL_NOT_REGISTERED'],
    ['forged-context', { ...command, input: { query: '浦发银行', userId: 999 } }, context(), 'INVALID_ARGUMENT'],
    ['deactivated', command, context({ userStatus: UserStatus.DEACTIVATED }), 'PERMISSION_DENIED'],
    ['scope-denied', command, context({ allowedScopes: ['USER_PRIVATE'] }), 'PERMISSION_DENIED'],
  ])('%s 在 adapter 前拒绝并写 REJECTED 审计', async (_name, inputCommand, access, expectedCode) => {
    const adapter = jest.fn()
    const { executor, audit } = harness(adapter)
    await expect(executor.execute(inputCommand, access)).rejects.toMatchObject({ result: { code: expectedCode } })
    expect(adapter).not.toHaveBeenCalled()
    expect(audit.countStatus(AiToolCallStatus.REJECTED)).toBe(1)
  })

  it('audit start 失败 fail-closed，adapter 零调用；success audit 失败不返回成功', async () => {
    const adapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>),
    )
    const beginFailure = new StatefulAuditFake()
    beginFailure.failBegin = true
    const beginHarness = harness(adapter, { audit: beginFailure })
    await expect(beginHarness.executor.execute(command, context())).rejects.toThrow('Tool audit start failed')
    expect(adapter).not.toHaveBeenCalled()

    const completeFailure = new StatefulAuditFake()
    completeFailure.failComplete = true
    const completeHarness = harness(adapter, { audit: completeFailure })
    await expect(completeHarness.executor.execute(command, context())).rejects.toThrow()
    expect(completeFailure.countStatus(AiToolCallStatus.SUCCEEDED)).toBe(0)
  })

  it.each([
    [
      'output schema',
      async (_input: unknown, access: ToolAccessContext) => ({
        ...toolResult(access, { query: 'x' }),
        data: { rows: [{ tsCode: '600000.SH' }] },
      }),
      'OUTPUT_SCHEMA_INVALID',
    ],
    [
      'row limit',
      async (input: unknown, access: ToolAccessContext) =>
        toolResult(
          access,
          input as Record<string, unknown>,
          Array.from({ length: 21 }, (_, index) => ({
            tsCode: `${index}`.padStart(6, '0') + '.SH',
            name: `证券${index}`,
          })),
        ),
      'RESULT_TOO_LARGE',
    ],
    [
      'unknown envelope field',
      async (input: unknown, access: ToolAccessContext) => ({
        ...toolResult(access, input as Record<string, unknown>),
        rawProviderPayload: { authorization: 'must-not-escape' },
      }),
      'OUTPUT_SCHEMA_INVALID',
    ],
  ])('%s 失败不把不可信结果交给上层', async (_name, implementation, code) => {
    const adapter = jest.fn(implementation as ToolDefinition['execute'])
    const { executor, audit } = harness(adapter)
    await expect(executor.execute(command, context())).rejects.toMatchObject({ result: { code } })
    expect(audit.countStatus(AiToolCallStatus.FAILED)).toBe(1)
  })

  it('结果字节上限与 provenance 日期/时区门禁 fail-closed', async () => {
    const largeAdapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>, [{ tsCode: '600000.SH', name: 'x'.repeat(2_000) }]),
    )
    const largeHarness = harness(largeAdapter, { config: { maxResultBytes: 512 } })
    await expect(largeHarness.executor.execute(command, context())).rejects.toMatchObject({
      result: { code: 'RESULT_TOO_LARGE' },
    })

    const badProvenanceAdapter = jest.fn(async (input, access: ToolAccessContext) => {
      const value = toolResult(access, input as Record<string, unknown>)
      value.provenance.asOf.retrievedAt = '2026-02-30T03:00:00.000Z'
      value.provenance.timezone = 'Not/A_Timezone'
      return value
    })
    const provenanceHarness = harness(badProvenanceAdapter)
    await expect(provenanceHarness.executor.execute(command, context())).rejects.toMatchObject({
      result: { code: 'OUTPUT_SCHEMA_INVALID' },
    })
  })

  it('timeout 终止为 TIMEOUT；parent cancel 胜出后迟到结果不能 complete', async () => {
    let lateResolve: ((value: ToolResult) => void) | undefined
    const adapter = jest.fn((_input: Record<string, unknown>, _access: ToolAccessContext) => {
      void _input
      void _access
      return new Promise<ToolResult>((resolve) => {
        lateResolve = resolve
      })
    })
    const timeoutHarness = harness(adapter, {
      config: { defaultTimeoutMs: 20 },
      definition: { policy: { ...definition(adapter).policy, maxAttempts: 1 } },
    })
    await expect(timeoutHarness.executor.execute(command, context())).rejects.toMatchObject({
      result: { code: 'TIMEOUT' },
    })
    expect(timeoutHarness.audit.countStatus(AiToolCallStatus.FAILED)).toBe(1)

    const controller = new AbortController()
    const cancelHarness = harness(adapter, {
      definition: { policy: { ...definition(adapter).policy, maxAttempts: 1 } },
    })
    const pending = cancelHarness.executor.execute(command, context({ parentSignal: controller.signal }))
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ result: { code: 'CANCELLED' } })
    lateResolve?.(toolResult((adapter.mock.calls.at(-1)?.[1] ?? {}) as ToolAccessContext, { query: '浦发银行' }))
    await Promise.resolve()
    expect(cancelHarness.audit.countStatus(AiToolCallStatus.CANCELLED)).toBe(1)
    expect(cancelHarness.audit.history).not.toContain('complete')

    const preCancelled = new AbortController()
    preCancelled.abort()
    const preCancelledAdapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>),
    )
    const preCancelledHarness = harness(preCancelledAdapter, {
      definition: { policy: { ...definition(preCancelledAdapter).policy, maxAttempts: 1 } },
    })
    await expect(
      preCancelledHarness.executor.execute(command, context({ parentSignal: preCancelled.signal })),
    ).rejects.toMatchObject({ result: { code: 'CANCELLED' } })
    expect(preCancelledAdapter).not.toHaveBeenCalled()
    expect(preCancelledHarness.audit.countStatus(AiToolCallStatus.CANCELLED)).toBe(1)
  })

  it('同 Run 超过 bulkhead 立即 QUOTA_EXCEEDED；release 后计数归零', async () => {
    let release: (() => void) | undefined
    const adapter = jest.fn(
      async (input: Record<string, unknown>, access: ToolAccessContext) =>
        new Promise<ToolResult>((resolve) => {
          release = () => resolve(toolResult(access, input as Record<string, unknown>))
        }),
    )
    const { executor, limiter, audit } = harness(adapter, { config: { maxConcurrentPerRun: 1 } })
    const first = executor.execute(command, context({ maxConcurrentCalls: 1 }))
    while (!release) await Promise.resolve()
    await expect(
      executor.execute({ ...command, invocationIndex: 1 }, context({ maxConcurrentCalls: 1 })),
    ).rejects.toMatchObject({ result: { code: 'QUOTA_EXCEEDED' } })
    release()
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(audit.countStatus(AiToolCallStatus.REJECTED)).toBe(1)
    expect(limiter.snapshot('run_1').inFlight).toBe(0)
  })

  it('20 Run × 20 顺序调用无跨 Run 配额污染，400 次全部成功', async () => {
    const adapter = jest.fn(async (input, access: ToolAccessContext) =>
      toolResult(access, input as Record<string, unknown>),
    )
    const { executor, audit } = harness(adapter)
    const startedAt = Date.now()
    await Promise.all(
      Array.from({ length: 20 }, (_, runIndex) =>
        (async () => {
          for (let invocationIndex = 0; invocationIndex < 20; invocationIndex += 1) {
            await executor.execute(
              { ...command, logicalNodeKey: `resolve_${invocationIndex}`, invocationIndex },
              context({ runId: `run_${runIndex}`, scopeId: `scope_${runIndex}` }),
            )
          }
        })(),
      ),
    )
    const elapsedMs = Date.now() - startedAt

    expect(adapter).toHaveBeenCalledTimes(400)
    expect(audit.countStatus(AiToolCallStatus.SUCCEEDED)).toBe(400)
    expect(elapsedMs).toBeLessThan(10_000)
  }, 20_000)
})
