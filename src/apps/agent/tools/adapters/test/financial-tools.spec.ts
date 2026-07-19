import { UserRole, UserStatus } from '@prisma/client'
import { AGENT_TOOL_KEYS } from 'src/apps/agent/contracts'
import { FinancialToolDataQualityError } from 'src/apps/stock/financial-tool.facade'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolAdapterError } from '../../contracts/tool-error'
import { ToolRegistryService } from '../../tool-registry.service'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createFinancialToolDefinitions } from '../financial-tools'

const enabledTools = ['get_financial_statements', 'get_financial_indicators', 'get_stock_moneyflow'] as const

const config = {
  enabledTools: [...enabledTools],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
  priceMaxBars: 5_000,
  marketCacheTtlSeconds: 300,
  financialMaxPeriods: 20,
  moneyflowMaxDays: 250,
}

function context(overrides: Partial<ToolAccessContext> = {}): ToolAccessContext {
  return {
    userId: 7,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope_1',
    conversationId: 'conversation_1',
    runId: 'run_1',
    stepId: 'step_1',
    traceId: 'trace_1',
    workflowAllowedTools: [...enabledTools],
    allowedScopes: ['PUBLIC_MARKET_DATA'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'tool_call_1',
    attempt: 1,
    abortSignal: new AbortController().signal,
    ...overrides,
  }
}

function metric(overrides: Record<string, unknown> = {}) {
  return {
    key: 'total_revenue',
    sourceField: 'total_revenue',
    unit: 'CNY',
    valueBasis: 'CUMULATIVE',
    reportedValue: 260,
    singleQuarterValue: 160,
    singleQuarterDerived: true,
    ...overrides,
  }
}

function statementPeriod(overrides: Record<string, unknown> = {}) {
  return {
    reportPeriod: '2024-06-30',
    announcementDate: '2024-08-30',
    availableAt: '2024-08-30',
    reportType: '1',
    updateFlag: '1',
    revisionCount: 1,
    values: [metric()],
    ...overrides,
  }
}

function indicatorPeriod(overrides: Record<string, unknown> = {}) {
  return {
    reportPeriod: '2024-06-30',
    announcementDate: '2024-08-30',
    values: [{ key: 'roe', sourceField: 'roe', value: 12, unit: 'PERCENT' }],
    ...overrides,
  }
}

function moneyflowDay(overrides: Record<string, unknown> = {}) {
  return {
    tradeDate: '2024-06-28',
    netAmount: 999,
    netVolume: 777,
    ...overrides,
  }
}

function harness() {
  const financial = {
    getStatements: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        periodType: 'QUARTERLY',
        requestedAvailableAt: null,
        statements: [{ statementType: 'INCOME', periods: [statementPeriod()] }],
      },
      warnings: [],
      asOf: '2024-06-30',
      availableAsOf: '2024-08-30',
      sourceModels: ['Income'],
    }),
    getIndicators: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        requestedAvailableAt: null,
        indicators: ['roe'],
        periods: [indicatorPeriod()],
      },
      warnings: [],
      truncated: false,
      asOf: '2024-06-30',
      availableAsOf: '2024-08-30',
      sourceModels: ['FinaIndicator'],
    }),
  }
  const moneyflow = {
    getDaily: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        includeOrderBuckets: false,
        units: { amount: 'CNY_10K', volume: 'LOT', netSign: 'POSITIVE_INFLOW' },
        days: [moneyflowDay()],
      },
      truncated: false,
      asOf: '2024-06-28',
      sourceModels: ['Moneyflow'],
    }),
  }
  const definitions = createFinancialToolDefinitions({
    financial: financial as never,
    moneyflow: moneyflow as never,
    config: config as never,
  })
  return { definitions, financial, moneyflow }
}

describe('Batch 008 financial/moneyflow Tool adapters', () => {
  it('[FMT-E2E-001] 三 definitions schema 可编译、Registry 唯一注册且均为 READ/idempotent', () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const registry = new ToolRegistryService(validator, config as never, definitions)
    registry.onModuleInit()

    expect(definitions.map((definition) => definition.key)).toEqual(enabledTools)
    expect(
      definitions.every((definition) => definition.policy.sideEffect === 'READ' && definition.policy.idempotent),
    ).toBe(true)
    expect(registry.freezeSnapshot().entries).toHaveLength(3)
    expect(Object.keys(registry.implementationStatus())).toEqual([...AGENT_TOOL_KEYS])
    for (const key of enabledTools) expect(registry.implementationStatus()[key]).toEqual([1])
  })

  it('[FMT-SEC-001/002] strict schema 拒绝注入、未知指标和超上限，Facade 零调用', () => {
    const { definitions, financial, moneyflow } = harness()
    const validator = new ToolSchemaValidator()
    const indicators = definitions.find((item) => item.key === 'get_financial_indicators')!
    const flow = definitions.find((item) => item.key === 'get_stock_moneyflow')!

    for (const input of [
      { tsCode: '600519.SH', indicators: ['roe'], limit: 1, userId: 99 },
      { tsCode: '600519.SH', indicators: ['raw_sql'], limit: 1 },
      { tsCode: '600519.SH', indicators: ['roe'], limit: 21 },
      { tsCode: '600519.SH', indicators: ['roe'], limit: 1, select: { secret: true } },
    ]) {
      expect(validator.validateInput(indicators, input).valid).toBe(false)
    }
    expect(
      validator.validateInput(flow, {
        tsCode: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        limit: 251,
      }).valid,
    ).toBe(false)
    expect(financial.getIndicators).not.toHaveBeenCalled()
    expect(moneyflow.getDaily).not.toHaveBeenCalled()
  })

  it('[FMT-ERR-001] 反向报告期和资金日期在 Facade 前拒绝', async () => {
    const { definitions, financial, moneyflow } = harness()
    const statements = definitions.find((item) => item.key === 'get_financial_statements')!
    const flow = definitions.find((item) => item.key === 'get_stock_moneyflow')!

    await expect(
      statements.execute(
        {
          tsCode: '600519.SH',
          statementTypes: ['INCOME'],
          periodType: 'QUARTERLY',
          startReportPeriod: '2024-12-31',
          endReportPeriod: '2024-03-31',
          limit: 4,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      flow.execute({ tsCode: '600519.SH', startDate: '2024-02-01', endDate: '2024-01-01' }, context()),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(financial.getStatements).not.toHaveBeenCalled()
    expect(moneyflow.getDaily).not.toHaveBeenCalled()
  })

  it('[FMT-BIZ-006/DATA-005] 三 Tool 输出通过 strict schema，时点/单位/inputHash 进入 provenance', async () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const inputs = {
      get_financial_statements: {
        tsCode: '600519.SH',
        statementTypes: ['INCOME'],
        periodType: 'QUARTERLY',
        limit: 4,
      },
      get_financial_indicators: { tsCode: '600519.SH', indicators: ['roe'], limit: 4 },
      get_stock_moneyflow: {
        tsCode: '600519.SH',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        includeOrderBuckets: false,
        limit: 60,
      },
    } as const

    for (const definition of definitions) {
      const result = await definition.execute(inputs[definition.key as keyof typeof inputs], context())
      expect(validator.validateOutput(definition, result.data)).toEqual({ valid: true, issues: [] })
      expect(result.provenance.inputHash).toMatch(/^[0-9a-f]{64}$/)
      expect(result.provenance.sourceModels).not.toHaveLength(0)
    }
  })

  it('[FMT-EDGE-006/ERR-004] 空结果与数据质量失败使用不同 typed error', async () => {
    const { definitions, financial } = harness()
    const statements = definitions.find((item) => item.key === 'get_financial_statements')!
    const indicators = definitions.find((item) => item.key === 'get_financial_indicators')!
    financial.getStatements.mockResolvedValueOnce({
      data: {
        tsCode: '600519.SH',
        periodType: 'QUARTERLY',
        requestedAvailableAt: null,
        statements: [{ statementType: 'INCOME', periods: [] }],
      },
      warnings: [],
      asOf: null,
      availableAsOf: null,
      sourceModels: ['Income'],
    })
    financial.getIndicators.mockRejectedValueOnce(new FinancialToolDataQualityError('公告日早于报告期'))

    await expect(
      statements.execute(
        { tsCode: '600519.SH', statementTypes: ['INCOME'], periodType: 'QUARTERLY', limit: 4 },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'DATA_NOT_FOUND' })
    await expect(
      indicators.execute({ tsCode: '600519.SH', indicators: ['roe'], limit: 4 }, context()),
    ).rejects.toMatchObject({ code: 'DATA_QUALITY_FAILED' })
  })

  it('[FMT-ERR-003/SEC-003] 未知依赖错误映射为可重试 UPSTREAM_FAILED，不泄露 SQL', async () => {
    const { definitions, moneyflow } = harness()
    moneyflow.getDaily.mockRejectedValueOnce(new Error('SELECT secret FROM stock_capital_flows'))
    const definition = definitions.find((item) => item.key === 'get_stock_moneyflow')!

    try {
      await definition.execute({ tsCode: '600519.SH', startDate: '2024-06-01', endDate: '2024-06-30' }, context())
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ToolAdapterError)
      expect(error).toMatchObject({ code: 'UPSTREAM_FAILED', retryable: true })
      expect((error as Error).message).not.toContain('stock_capital_flows')
    }
  })

  it('[FMT-LOAD-001] 20 Run 并发调用三个 Tool，无跨 Run 输入污染', async () => {
    const { definitions, financial, moneyflow } = harness()
    const inputByKey = {
      get_financial_statements: {
        tsCode: '600519.SH',
        statementTypes: ['INCOME'],
        periodType: 'QUARTERLY',
        limit: 4,
      },
      get_financial_indicators: { tsCode: '600519.SH', indicators: ['roe'], limit: 4 },
      get_stock_moneyflow: {
        tsCode: '600519.SH',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        includeOrderBuckets: false,
        limit: 60,
      },
    } as const

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, runIndex) =>
        Promise.all(
          definitions.map((definition, toolIndex) =>
            definition.execute(
              inputByKey[definition.key as keyof typeof inputByKey],
              context({ runId: `run_${runIndex}`, toolCallId: `call_${runIndex}_${toolIndex}` }),
            ),
          ),
        ),
      ),
    )

    expect(results.flat()).toHaveLength(60)
    expect(results.flat().every((result) => result.ok)).toBe(true)
    expect(financial.getStatements).toHaveBeenCalledTimes(20)
    expect(financial.getIndicators).toHaveBeenCalledTimes(20)
    expect(moneyflow.getDaily).toHaveBeenCalledTimes(20)
  })

  it('[FMT-STRESS-001] 12期×3表、20期×30指标、250日资金流保持 schema/rows 有界', () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const statements = definitions.find((item) => item.key === 'get_financial_statements')!
    const indicators = definitions.find((item) => item.key === 'get_financial_indicators')!
    const flow = definitions.find((item) => item.key === 'get_stock_moneyflow')!
    const statementData = {
      tsCode: '600519.SH',
      periodType: 'QUARTERLY',
      requestedAvailableAt: null,
      statements: (['INCOME', 'BALANCE_SHEET', 'CASH_FLOW'] as const).map((statementType) => ({
        statementType,
        periods: Array.from({ length: 12 }, () => ({
          ...statementPeriod(),
          values: Array.from({ length: 30 }, () => metric()),
        })),
      })),
    }
    const indicatorData = {
      tsCode: '600519.SH',
      requestedAvailableAt: null,
      indicators: ['roe'],
      periods: Array.from({ length: 20 }, () => ({
        ...indicatorPeriod(),
        values: Array.from({ length: 30 }, () => ({
          key: 'roe',
          sourceField: 'roe',
          value: 12,
          unit: 'PERCENT',
        })),
      })),
    }
    const flowData = {
      tsCode: '600519.SH',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      includeOrderBuckets: true,
      units: { amount: 'CNY_10K', volume: 'LOT', netSign: 'POSITIVE_INFLOW' },
      days: Array.from({ length: 250 }, () =>
        moneyflowDay({
          orderBuckets: Object.fromEntries(
            ['small', 'medium', 'large', 'extraLarge'].map((key) => [
              key,
              {
                buyVolume: 100,
                buyAmount: 200,
                sellVolume: 80,
                sellAmount: 150,
                netVolume: 20,
                netAmount: 50,
              },
            ]),
          ),
        }),
      ),
    }

    expect(validator.validateOutput(statements, statementData).valid).toBe(true)
    expect(validator.validateOutput(indicators, indicatorData).valid).toBe(true)
    expect(validator.validateOutput(flow, flowData).valid).toBe(true)
    expect(statements.countRows!(statementData)).toBe(36)
    expect(indicators.countRows!(indicatorData)).toBe(20)
    expect(flow.countRows!(flowData)).toBe(250)
    for (const data of [statementData, indicatorData, flowData]) {
      expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThan(config.maxResultBytes)
    }
  })
})
