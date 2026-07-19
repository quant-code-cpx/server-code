import { UserRole, UserStatus } from '@prisma/client'
import { Test } from '@nestjs/testing'
import { AGENT_TOOL_KEYS } from 'src/apps/agent/contracts'
import { AgentToolsConfig, buildAgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { ToolDefinition } from '../contracts/tool-definition'
import type { ToolResult } from '../contracts/tool-result'
import { ToolPolicyDeniedError, ToolPolicyService } from '../tool-policy.service'
import { ToolRegistryError, ToolRegistryService } from '../tool-registry.service'
import { AGENT_TOOL_DEFINITIONS } from '../tool-registry.service'
import { ToolRunLimiterService, ToolRunLimitError } from '../tool-run-limiter.service'
import { ToolSchemaValidator } from '../tool-schema-validator'
import type { ToolAccessContext, ToolExecutionContext } from '../tool-access-context'
import { hashStableJson, stableJson } from '../tool-json'

const enabledConfig = {
  enabledTools: ['resolve_security'],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
} as IAgentToolsConfig

function result(toolCallId: string): ToolResult<{ rows: Array<{ tsCode: string; name: string }> }> {
  return {
    ok: true,
    toolCallId,
    toolKey: 'resolve_security',
    toolVersion: 1,
    data: { rows: [{ tsCode: '600000.SH', name: '浦发银行' }] },
    provenance: {
      sourceType: 'DATABASE',
      sourceServices: ['StockToolFixture'],
      sourceModels: ['StockBasic'],
      asOf: { tradeDate: '2026-07-18', retrievedAt: '2026-07-19T03:00:00.000Z' },
      timezone: 'Asia/Shanghai',
    },
    citationSourceIds: [],
    warnings: [],
    truncated: false,
  }
}

function definition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    key: 'resolve_security',
    version: 1,
    description: '按名称或代码解析证券',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'asOfDate'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 64 },
        asOfDate: { type: 'string', format: 'date' },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          maxItems: 20,
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
    execute: async (_input, context: ToolAccessContext) => result(context.toolCallId),
    ...overrides,
  }
}

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

describe('Agent Tool config / Registry / Schema / Policy', () => {
  it('默认空 allowlist；严格解析 canonical key 与数值边界', () => {
    expect(buildAgentToolsConfig({})).toEqual({
      enabledTools: [],
      maxCallsPerRun: 20,
      defaultTimeoutMs: 10_000,
      maxResultBytes: 256_000,
      maxConcurrentPerRun: 3,
    })
    expect(
      buildAgentToolsConfig({ AGENT_TOOLS_ENABLED: 'search_web,resolve_security,search_web' }).enabledTools,
    ).toEqual(['resolve_security', 'search_web'])
    expect(() => buildAgentToolsConfig({ AGENT_TOOLS_ENABLED: 'query_database' })).toThrow('未知 Tool')
    expect(() => buildAgentToolsConfig({ AGENT_TOOL_MAX_CALLS_PER_RUN: '0' })).toThrow('1-1000')
  })

  it('Registry fail-fast 拒绝重复、非 READ、非幂等、缺上限和宽松 input schema', () => {
    const validator = new ToolSchemaValidator()
    const registry = new ToolRegistryService(validator, enabledConfig, [])
    registry.register(definition())
    expect(() => registry.register(definition())).toThrow(ToolRegistryError)

    const cases: ToolDefinition[] = [
      definition({ version: 2, policy: { ...definition().policy, sideEffect: 'WRITE' } }),
      definition({ version: 3, policy: { ...definition().policy, idempotent: false } }),
      definition({ version: 4, policy: { ...definition().policy, maxRows: 0 } }),
      definition({ version: 5, inputSchema: { type: 'object', properties: {} } }),
      definition({ version: 6, outputSchema: { type: 'object', properties: { value: { type: 'number' } } } }),
    ]
    for (const candidate of cases) expect(() => registry.register(candidate)).toThrow()
    registry.onModuleInit()
    expect(() => registry.register(definition({ version: 7 }))).toThrow('已冻结')
  })

  it('snapshot 只含 enabled+registered，按 key/version 稳定排序且 provider schema 不泄露 callback/context', () => {
    const validator = new ToolSchemaValidator()
    const config = { ...enabledConfig, enabledTools: ['resolve_security', 'search_web'] } as IAgentToolsConfig
    const registry = new ToolRegistryService(validator, config, [])
    registry.register(definition({ version: 2 }))
    registry.register(definition({ version: 1 }))
    const snapshot = registry.freezeSnapshot([{ key: 'resolve_security', version: 1 }])
    const schemas = registry.toModelSchemas(snapshot)

    expect(snapshot.entries).toEqual([{ key: 'resolve_security', version: 1 }])
    expect(snapshot.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(registry.freezeSnapshot([{ key: 'resolve_security', version: 1 }]).signature).toBe(snapshot.signature)
    const changedRegistry = new ToolRegistryService(validator, config, [definition({ description: '变更后的定义' })])
    expect(changedRegistry.freezeSnapshot([{ key: 'resolve_security', version: 1 }]).signature).not.toBe(
      snapshot.signature,
    )
    expect(schemas).toEqual([
      expect.objectContaining({ name: 'resolve_security', description: '按名称或代码解析证券' }),
    ])
    const serialized = JSON.stringify(schemas)
    expect(serialized).not.toContain('execute')
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('allowedScopes')
    expect(registry.implementationStatus().resolve_security).toEqual([1, 2])
    expect(Object.keys(registry.implementationStatus())).toEqual([...AGENT_TOOL_KEYS])
  })

  it('注册时深拷贝并冻结 schema/policy，调用方后续修改不影响已发布 definition', () => {
    const validator = new ToolSchemaValidator()
    const mutable = definition()
    const registry = new ToolRegistryService(validator, enabledConfig, [mutable])
    const mutableProperties = mutable.inputSchema.properties as Record<string, Record<string, unknown>>
    mutableProperties.query.maxLength = 1
    ;(mutable.policy.allowedDataScopes as string[]).push('USER_PRIVATE')
    const stored = registry.get('resolve_security', 1)

    const storedProperties = stored.inputSchema.properties as Record<string, Record<string, unknown>>
    expect(storedProperties.query.maxLength).toBe(64)
    expect(stored.policy.allowedDataScopes).toEqual(['PUBLIC_MARKET_DATA'])
    expect(Object.isFrozen(stored.inputSchema.properties)).toBe(true)
    expect(() => ((stored.inputSchema.properties as Record<string, unknown>).extra = {})).toThrow()
  })

  it('Ajv 严格拒绝额外字段、非法真实日期和输出字段缺失，不修改原 input', () => {
    const validator = new ToolSchemaValidator()
    const tool = definition()
    validator.assertDefinitionSchemas(tool)
    const validInput = { query: '浦发银行', asOfDate: '2026-02-28' }
    expect(validator.validateInput(tool, validInput)).toEqual({ valid: true, issues: [] })
    expect(validator.validateInput(tool, { ...validInput, userId: 999 }).valid).toBe(false)
    expect(validator.validateInput(tool, { ...validInput, asOfDate: '2026-02-30' }).valid).toBe(false)
    expect(validator.validateOutput(tool, { rows: [{ tsCode: '600000.SH' }] }).valid).toBe(false)
    expect(validInput).toEqual({ query: '浦发银行', asOfDate: '2026-02-28' })

    for (let index = 0; index < 100; index += 1) {
      expect(validator.validateInput(tool, { ...validInput, [`unknown_${index}`]: index }).valid).toBe(false)
    }
    const cyclic: Record<string, unknown> = { ...validInput }
    cyclic.self = cyclic
    expect(validator.validateInput(tool, cyclic).valid).toBe(false)
    expect(validator.validateInput(tool, { ...validInput, query: 1n }).valid).toBe(false)
    const dateTimeTool = definition({
      version: 2,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['retrievedAt'],
        properties: { retrievedAt: { type: 'string', format: 'date-time' } },
      },
    })
    validator.assertDefinitionSchemas(dateTimeTool)
    expect(validator.validateInput(dateTimeTool, { retrievedAt: '2026-02-30T03:00:00.000Z' }).valid).toBe(false)
    expect(validator.validateInput(dateTimeTool, { retrievedAt: '2026-02-28T24:00:00.000Z' }).valid).toBe(false)
    expect(() => stableJson(Array(1))).toThrow('JSON 不支持 undefined')
    const deeplyNested: Record<string, unknown> = {}
    let cursor = deeplyNested
    for (let depth = 0; depth < 34; depth += 1) {
      cursor.child = {}
      cursor = cursor.child as Record<string, unknown>
    }
    expect(() => stableJson(deeplyNested)).toThrow('JSON 嵌套深度超过 32')
    const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    expect(stableJson(prototypeKey)).toContain('"__proto__"')
    expect(hashStableJson({ b: 2, a: 1 })).toBe(hashStableJson({ a: 1, b: 2 }))
  })

  it('1000 次 schema validation 错误率 0，并记录本机 p50/p95/p99 基线', () => {
    const validator = new ToolSchemaValidator()
    const tool = definition()
    validator.assertDefinitionSchemas(tool)
    for (let index = 0; index < 100; index += 1) {
      validator.validateInput(tool, { query: `预热${index}`, asOfDate: '2026-07-18' })
    }
    const samples: number[] = []
    for (let index = 0; index < 1_000; index += 1) {
      const startedAt = performance.now()
      expect(validator.validateInput(tool, { query: `证券${index}`, asOfDate: '2026-07-18' }).valid).toBe(true)
      samples.push(performance.now() - startedAt)
    }
    samples.sort((left, right) => left - right)
    expect(samples[Math.floor(samples.length * 0.5)]).toBeLessThan(10)
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(20)
    expect(samples[Math.floor(samples.length * 0.99)]).toBeLessThan(50)
  })

  it('Nest TestingModule 初始化默认空 Registry，不向 provider 暴露未实现 canonical key', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ToolSchemaValidator,
        ToolRegistryService,
        { provide: AgentToolsConfig.KEY, useValue: { ...enabledConfig, enabledTools: [] } },
        { provide: AGENT_TOOL_DEFINITIONS, useValue: Object.freeze([]) },
      ],
    }).compile()
    await module.init()
    const registry = module.get(ToolRegistryService)

    expect(registry.freezeSnapshot().entries).toEqual([])
    expect(registry.toModelSchemas(registry.freezeSnapshot())).toEqual([])
    expect(Object.values(registry.implementationStatus()).every((versions) => versions.length === 0)).toBe(true)
    await module.close()
  })

  it('Policy 按 ACTIVE、角色、workflow、scope、quota、deadline 全部取交集', () => {
    const policy = new ToolPolicyService(enabledConfig)
    const adminTool = definition({ policy: { ...definition().policy, requiredRole: UserRole.ADMIN } })
    expect(() => policy.authorize(adminTool, context({ role: UserRole.ADMIN }))).not.toThrow()

    const denied: Array<[Partial<ToolExecutionContext>, string]> = [
      [{ userStatus: UserStatus.DEACTIVATED }, 'PERMISSION_DENIED'],
      [{ role: UserRole.USER }, 'PERMISSION_DENIED'],
      [{ workflowAllowedTools: [] }, 'PERMISSION_DENIED'],
      [{ allowedScopes: ['USER_PRIVATE'] }, 'PERMISSION_DENIED'],
      [{ callsUsed: 20 }, 'QUOTA_EXCEEDED'],
      [{ deadlineAt: new Date(Date.now() - 1) }, 'TIMEOUT'],
    ]
    for (const [override, code] of denied) {
      try {
        policy.authorize(adminTool, context({ role: UserRole.ADMIN, ...override }))
        throw new Error('expected policy rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(ToolPolicyDeniedError)
        expect((error as ToolPolicyDeniedError).code).toBe(code)
      }
    }
  })

  it('per-run limiter 原子限制总次数与并发，不污染其他 Run，release 幂等', () => {
    const limiter = new ToolRunLimiterService({ ...enabledConfig, maxCallsPerRun: 2, maxConcurrentPerRun: 1 })
    const first = limiter.reserve('run_a', 0)
    expect(() => limiter.reserve('run_a', 0)).toThrow(ToolRunLimitError)
    expect(() => limiter.reserve(' run_a ', 0)).toThrow(ToolRunLimitError)
    expect(() => limiter.reserve('run_invalid_budget', Number.NaN)).toThrow('预算状态无效')
    expect(() => limiter.clearRun('run_a')).toThrow('仍在执行')
    const other = limiter.reserve('run_b', 0)
    first.release()
    first.release()
    const second = limiter.reserve('run_a', 0)
    second.release()
    expect(() => limiter.reserve('run_a', 0)).toThrow('次数已达上限')
    other.release()
    expect(limiter.snapshot('run_a')).toEqual({ used: 2, inFlight: 0 })
    limiter.clearRun('run_a')
    expect(limiter.snapshot('run_a')).toEqual({ used: 0, inFlight: 0 })
  })
})
