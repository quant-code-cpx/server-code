import { UserRole, UserStatus } from '@prisma/client'
import { BacktestToolNotFoundError } from 'src/apps/backtest/backtest-tool.facade'
import { PortfolioToolNotFoundError } from 'src/apps/portfolio/portfolio-tool.facade'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createQuantToolDefinitions } from '../quant-tools'

const enabledTools = [
  'get_portfolio_risk',
  'get_backtest_result',
  'compute_performance_metrics',
  'compute_valuation_percentile',
] as const

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
  quantMaxPoints: 10_000,
  valuationMinSamples: 60,
}

function context(scopes: string[]): ToolAccessContext {
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
    allowedScopes: scopes,
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'tool_call_1',
    attempt: 1,
    abortSignal: new AbortController().signal,
  }
}

function harness() {
  const portfolio = {
    risk: jest.fn().mockResolvedValue({
      data: {
        portfolio: { id: 'portfolio_1', name: '核心组合', kind: 'PAPER', isArchived: false },
        requestedAsOfDate: '2024-06-30',
        dataAsOf: '2024-06-28',
        sections: ['CONCENTRATION'],
        partial: false,
        holdings: null,
        concentration: { hhi: 0.5, top1Weight: 0.6, top3Weight: 1, top5Weight: 1 },
        industry: null,
        marketCap: null,
        beta: null,
        violations: null,
        componentErrors: [],
      },
      asOf: '2024-06-28',
      sourceModels: ['Portfolio', 'PortfolioHolding'],
    }),
  }
  const backtest = {
    result: jest.fn().mockResolvedValue({
      data: {
        backtestRunId: 'backtest_1',
        sections: ['STATUS'],
        algorithmVersion: 'backtest-research-v1',
        partial: false,
        config: null,
        runStatus: {
          status: 'COMPLETED',
          terminal: true,
          progress: 100,
          failedReason: null,
          createdAt: '2024-07-01T00:00:00.000Z',
          startedAt: '2024-07-01T00:00:01.000Z',
          completedAt: '2024-07-01T00:01:00.000Z',
        },
        metrics: null,
        equity: null,
        tradesSummary: null,
        attribution: null,
        biasFlags: {
          survivorship: 'UNVERIFIED',
          pointInTimeUniverse: false,
          announcementDate: false,
          adjustment: 'UNVERIFIED',
          reproducible: false,
        },
        componentErrors: [],
      },
      asOf: '2024-06-30',
      sourceModels: ['BacktestRun'],
      warnings: [{ code: 'BACKTEST_BIAS_UNVERIFIED', message: '必须传播' }],
      truncated: false,
    }),
  }
  const valuation = {
    percentile: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        metric: 'PE_TTM',
        unit: 'RATIO',
        requestedWindow: { startDate: '2020-01-01', endDate: '2024-06-30' },
        requestedAsOfDate: null,
        effectiveEndDate: '2024-06-30',
        algorithmVersion: 'valuation-percentile-v1',
        currentValue: 25,
        percentileValue: 25,
        percentile: 0.8,
        percentileMethod: 'WEAK',
        sampleCount: 600,
        dataDate: '2024-06-28',
        window: { startDate: '2020-01-02', endDate: '2024-06-28' },
        statistics: { min: 10, max: 40, median: 20 },
        filtered: { missingOrNonFinite: 2, nonPositive: 0, winsorized: 0 },
        warnings: [{ code: 'VALUES_FILTERED', message: '固定过滤' }],
      },
      asOf: '2024-06-28',
      sourceModels: ['DailyBasic'],
    }),
  }
  const definitions = createQuantToolDefinitions({
    portfolio: portfolio as never,
    backtest: backtest as never,
    valuation: valuation as never,
    config: config as never,
  })
  return { definitions, portfolio, backtest, valuation }
}

describe('Batch 009 deterministic quant Tool adapters', () => {
  it('四个 schema 均严格可编译并拒绝未知字段/超限点数', () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    for (const definition of definitions) expect(() => validator.assertDefinitionSchemas(definition)).not.toThrow()

    const performance = definitions.find((definition) => definition.key === 'compute_performance_metrics')!
    expect(
      validator.validateInput(performance, {
        seriesType: 'EQUITY',
        points: [
          { date: '2024-01-01', value: 1 },
          { date: '2024-01-02', value: 1.1 },
        ],
        annualizationFactor: 252,
        riskFreeRateAnnual: 0,
        formula: 'model supplied',
      }).valid,
    ).toBe(false)
  })

  it('绩效 Tool 数值由纯函数计算，相同输入/version hash 稳定', async () => {
    const { definitions } = harness()
    const definition = definitions.find((item) => item.key === 'compute_performance_metrics')!
    const input = {
      seriesType: 'EQUITY',
      points: [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 110 },
        { date: '2024-01-03', value: 99 },
      ],
      annualizationFactor: 252,
      riskFreeRateAnnual: 0,
      metrics: ['TOTAL_RETURN', 'MAX_DRAWDOWN'],
    }
    const first = await definition.execute(input, context(['QUANT_CALCULATION']))
    const second = await definition.execute(input, context(['QUANT_CALCULATION']))
    expect(first.data).toMatchObject({
      algorithmVersion: 'performance-metrics-v1',
      metrics: [
        { key: 'TOTAL_RETURN', value: expect.any(Number) },
        { key: 'MAX_DRAWDOWN', value: expect.any(Number) },
      ],
    })
    expect(first.provenance.inputHash).toBe(second.provenance.inputHash)
    expect(first.provenance.outputHash).toBe(second.provenance.outputHash)
    expect(new ToolSchemaValidator().validateOutput(definition, first.data).valid).toBe(true)
  })

  it('估值 Tool 注入固定最小样本与默认过滤策略', async () => {
    const { definitions, valuation } = harness()
    const definition = definitions.find((item) => item.key === 'compute_valuation_percentile')!
    const result = await definition.execute(
      {
        tsCode: '600519.SH',
        metric: 'PE_TTM',
        startDate: '2020-01-01',
        endDate: '2024-06-30',
        percentileMethod: 'WEAK',
      },
      context(['PUBLIC_MARKET_DATA']),
    )
    expect(valuation.percentile).toHaveBeenCalledWith(
      expect.objectContaining({ minimumSamples: 60, excludeNonPositive: true, winsorize: 'NONE' }),
    )
    expect(result.provenance).toMatchObject({
      algorithmVersion: 'valuation-percentile-v1',
      outputHash: expect.any(String),
    })
    expect(result.warnings.map((warning) => warning.code)).toContain('VALUES_FILTERED')
  })

  it('组合与回测调用强制注入 context.userId，回测 bias warning 不可隐藏', async () => {
    const { definitions, portfolio, backtest } = harness()
    const portfolioDefinition = definitions.find((item) => item.key === 'get_portfolio_risk')!
    const backtestDefinition = definitions.find((item) => item.key === 'get_backtest_result')!
    await portfolioDefinition.execute(
      { portfolioId: 'portfolio_1', asOfDate: '2024-06-30', sections: ['CONCENTRATION'] },
      context(['USER_PRIVATE']),
    )
    const backtestResult = await backtestDefinition.execute(
      { backtestRunId: 'backtest_1', sections: ['STATUS'] },
      context(['USER_PRIVATE']),
    )
    expect(portfolio.risk).toHaveBeenCalledWith(7, expect.any(Object))
    expect(backtest.result).toHaveBeenCalledWith(7, expect.objectContaining({ maxEquityPoints: 500 }))
    expect(backtestResult.warnings.map((warning) => warning.code)).toContain('BACKTEST_BIAS_UNVERIFIED')
  })

  it('跨租户 facade not found 统一映射 DATA_NOT_FOUND，不暴露资源存在性', async () => {
    const { definitions, portfolio, backtest } = harness()
    portfolio.risk.mockRejectedValueOnce(new PortfolioToolNotFoundError())
    backtest.result.mockRejectedValueOnce(new BacktestToolNotFoundError())
    const portfolioDefinition = definitions.find((item) => item.key === 'get_portfolio_risk')!
    const backtestDefinition = definitions.find((item) => item.key === 'get_backtest_result')!
    await expect(
      portfolioDefinition.execute(
        { portfolioId: 'other', asOfDate: '2024-06-30', sections: ['BETA'] },
        context(['USER_PRIVATE']),
      ),
    ).rejects.toMatchObject({ code: 'DATA_NOT_FOUND', retryable: false })
    await expect(
      backtestDefinition.execute({ backtestRunId: 'other', sections: ['STATUS'] }, context(['USER_PRIVATE'])),
    ).rejects.toMatchObject({ code: 'DATA_NOT_FOUND', retryable: false })
  })
})
