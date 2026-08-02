import { AiToolCallStatus, Prisma, UserRole, UserStatus, type AiToolCall } from '@prisma/client'
import { BacktestToolNotFoundError } from 'src/apps/backtest/backtest-tool.facade'
import { QuantCalculationError } from 'src/apps/agent/quant/performance-metrics'
import {
  AgentAuditRepository,
  type AuditFailureCommand,
  type BeginToolCallCommand,
  type CompleteToolCallCommand,
  type RetryToolCallCommand,
} from 'src/apps/agent/audit/agent-audit.repository'
import { AGENT_MVP_READ_TOOL_KEYS, type AgentToolKey } from 'src/apps/agent/contracts'
import { PortfolioToolNotFoundError } from 'src/apps/portfolio/portfolio-tool.facade'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { WebSearchError } from 'src/apps/web-search/web-search.errors'
import { ToolExecutionError, type ToolErrorCode } from '../../contracts/tool-error'
import { ToolExecutorService } from '../../tool-executor.service'
import { hashStableJson } from '../../tool-json'
import { ToolPolicyService } from '../../tool-policy.service'
import { ToolRegistryService } from '../../tool-registry.service'
import { ToolRunLimiterService } from '../../tool-run-limiter.service'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import type { ToolExecutionContext } from '../../tool-access-context'
import { createFinancialToolDefinitions } from '../financial-tools'
import { createQuantToolDefinitions } from '../quant-tools'
import { createStockMarketToolDefinitions } from '../stock-market-tools'
import { createWebResearchToolDefinitions } from '../web-research-tools'

const config = {
  enabledTools: [...AGENT_MVP_READ_TOOL_KEYS],
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
} as IAgentToolsConfig

const successInputs: Readonly<Record<Exclude<AgentToolKey, 'save_research_report'>, unknown>> = {
  resolve_security: { query: '浦发银行' },
  get_stock_price_history: {
    tsCode: '600000.SH',
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    frequency: 'DAILY',
    adjustment: 'FORWARD',
    fields: ['close'],
    limit: 100,
  },
  get_stock_overview: { tsCodes: ['600000.SH'], sections: ['BASIC'] },
  screen_stocks: { preset: 'main_inflow', pageSize: 10 },
  get_financial_statements: {
    tsCode: '600519.SH',
    statementTypes: ['INCOME'],
    periodType: 'QUARTERLY',
    availableAt: '2024-08-30T00:00:00.000Z',
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
  get_market_snapshot: { sections: ['INDEX_QUOTES'], topN: 10 },
  get_sector_membership: {
    mode: 'SECTORS_FOR_SECURITY',
    tsCode: '600000.SH',
    effectiveDate: '2024-06-28',
  },
  get_user_watchlist: { watchlistId: 12, includeLatestQuote: false, limit: 100 },
  get_portfolio_risk: {
    portfolioId: 'portfolio_1',
    asOfDate: '2026-07-21',
    sections: ['CONCENTRATION'],
  },
  get_backtest_result: { backtestRunId: 'backtest_1', sections: ['STATUS'] },
  compute_performance_metrics: {
    seriesType: 'EQUITY',
    points: [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 110 },
      { date: '2024-01-03', value: 99 },
    ],
    annualizationFactor: 252,
    riskFreeRateAnnual: 0,
    metrics: ['TOTAL_RETURN', 'MAX_DRAWDOWN'],
  },
  compute_valuation_percentile: {
    tsCode: '600519.SH',
    metric: 'PE_TTM',
    startDate: '2020-01-01',
    endDate: '2024-06-30',
    percentileMethod: 'WEAK',
  },
  search_web: { query: '贵州茅台 交易所 公告', resultLimit: 3, sourceTypes: ['EXCHANGE'] },
  fetch_web_page: { urlToken: 'token.'.padEnd(24, 'x'), maxCharacters: 30_000, extract: 'ARTICLE' },
}

interface FailureCase {
  toolKey: AgentToolKey
  input: unknown
  expectedCode: ToolErrorCode
  expectedStatus: AiToolCallStatus
  prepare?: (mocks: ToolMocks) => void
}

function executionContext(runId: string): ToolExecutionContext {
  return {
    userId: 7,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: `scope_${runId}`,
    conversationId: `conv_${runId}`,
    runId,
    stepId: `step_${runId}`,
    traceId: `trace_${runId}`,
    workflowAllowedTools: [...AGENT_MVP_READ_TOOL_KEYS],
    allowedScopes: ['PUBLIC_MARKET_DATA', 'USER_PRIVATE', 'QUANT_CALCULATION', 'PUBLIC_WEB'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
  }
}

function createToolHarness() {
  const mocks = createToolMocks()
  const unorderedDefinitions = [
    ...createStockMarketToolDefinitions({
      stock: mocks.stock as never,
      market: mocks.market as never,
      sector: mocks.sector as never,
      watchlist: mocks.watchlist as never,
      config,
    }),
    ...createFinancialToolDefinitions({
      financial: mocks.financial as never,
      moneyflow: mocks.moneyflow as never,
      config,
    }),
    ...createQuantToolDefinitions({
      portfolio: mocks.portfolio as never,
      backtest: mocks.backtest as never,
      valuation: mocks.valuation as never,
      config,
    }),
    ...createWebResearchToolDefinitions({ search: mocks.search as never, fetch: mocks.fetch as never }),
  ]
  const definitions = AGENT_MVP_READ_TOOL_KEYS.map((toolKey) => {
    const definition = unorderedDefinitions.find((item) => item.key === toolKey)
    if (!definition) throw new Error(`missing Tool definition: ${toolKey}`)
    return definition
  })
  const validator = new ToolSchemaValidator()
  const registry = new ToolRegistryService(validator, config, definitions)
  registry.onModuleInit()
  const audit = new MatrixAuditFake()
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService
  const executor = new ToolExecutorService(
    registry,
    validator,
    new ToolPolicyService(config),
    new ToolRunLimiterService(config),
    audit as unknown as AgentAuditRepository,
    config,
    logger,
  )
  return { definitions, executor, audit, mocks }
}

describe('Batch 018 MVP 15 Tool 成功与权限/边界统一矩阵', () => {
  it('[AG-MVP-TOOL-SUCCESS-001~015] 15 Tool 通过真实 schema、adapter、policy、audit 与 Executor 成功门禁', async () => {
    const { definitions, executor, audit, mocks } = createToolHarness()
    expect(definitions.map((definition) => definition.key)).toEqual(AGENT_MVP_READ_TOOL_KEYS)

    for (const [index, toolKey] of AGENT_MVP_READ_TOOL_KEYS.entries()) {
      const runId = `success_${index + 1}`
      let result: Awaited<ReturnType<ToolExecutorService['execute']>>
      try {
        result = await executor.execute(
          {
            toolKey,
            toolVersion: 1,
            logicalNodeKey: `matrix_success_${toolKey}`,
            input: successInputs[toolKey],
          },
          executionContext(runId),
        )
      } catch (error) {
        const code =
          error instanceof ToolExecutionError ? error.result.code : error instanceof Error ? error.message : 'unknown'
        throw new Error(`${toolKey} 成功门禁失败：${code}`)
      }

      expect(result).toMatchObject({ ok: true, toolKey, toolVersion: 1, truncated: expect.any(Boolean) })
      expect(result.provenance).toMatchObject({
        sourceServices: expect.any(Array),
        sourceModels: expect.any(Array),
        asOf: { retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
        timezone: expect.any(String),
        inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
      expect(result.provenance.sourceServices).not.toHaveLength(0)
      expect(audit.callFor(toolKey, runId)).toMatchObject({
        toolName: toolKey,
        status: AiToolCallStatus.SUCCEEDED,
        errorClass: null,
        outputSummary: expect.objectContaining({ toolKey }),
      })
      assertBusinessSuccess(toolKey, result.data, result, mocks)
    }
  })

  it.each(failureCases())(
    '[AG-MVP-TOOL-FAIL-001~015] $toolKey 返回 $expectedCode，审计进入 $expectedStatus',
    async ({ toolKey, input, expectedCode, expectedStatus, prepare }) => {
      const { executor, audit, mocks } = createToolHarness()
      prepare?.(mocks)
      const runId = `failure_${AGENT_MVP_READ_TOOL_KEYS.indexOf(toolKey as (typeof AGENT_MVP_READ_TOOL_KEYS)[number]) + 1}`

      try {
        await executor.execute(
          { toolKey, toolVersion: 1, logicalNodeKey: `matrix_failure_${toolKey}`, input },
          executionContext(runId),
        )
        throw new Error('expected ToolExecutionError')
      } catch (error) {
        expect(error).toBeInstanceOf(ToolExecutionError)
        expect((error as ToolExecutionError).result).toMatchObject({
          ok: false,
          toolKey,
          code: expectedCode,
          retryable: false,
        })
      }

      expect(audit.callFor(toolKey, runId)).toMatchObject({
        toolName: toolKey,
        status: expectedStatus,
        errorClass: expectedCode,
      })
    },
  )
})

function failureCases(): FailureCase[] {
  return [
    {
      toolKey: 'resolve_security',
      input: { query: '   ' },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'get_stock_price_history',
      input: {
        tsCode: '600000.SH',
        startDate: '2024-02-01',
        endDate: '2024-01-01',
        frequency: 'DAILY',
        adjustment: 'NONE',
      },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'get_stock_overview',
      input: { tsCodes: Array.from({ length: 21 }, (_, index) => `${String(index).padStart(6, '0')}.SH`) },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.REJECTED,
    },
    {
      toolKey: 'get_financial_statements',
      input: {
        tsCode: '600519.SH',
        statementTypes: ['INCOME'],
        periodType: 'QUARTERLY',
        startReportPeriod: '2024-12-31',
        endReportPeriod: '2024-03-31',
        limit: 4,
      },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'get_financial_indicators',
      input: { tsCode: '600519.SH', indicators: ['raw_sql'], limit: 4 },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.REJECTED,
    },
    {
      toolKey: 'get_stock_moneyflow',
      input: { tsCode: '600519.SH', startDate: '2024-07-01', endDate: '2024-06-01' },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'get_market_snapshot',
      input: { sections: ['UNKNOWN_SECTION'] },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.REJECTED,
    },
    {
      toolKey: 'get_sector_membership',
      input: { mode: 'SECTORS_FOR_SECURITY', tsCode: '600000.SH', sectorCode: '801780.SI' },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'get_user_watchlist',
      input: { watchlistId: 12, userId: 99 },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.REJECTED,
    },
    {
      toolKey: 'get_portfolio_risk',
      input: { portfolioId: 'other_user_portfolio', asOfDate: '2024-06-30', sections: ['BETA'] },
      expectedCode: 'DATA_NOT_FOUND',
      expectedStatus: AiToolCallStatus.FAILED,
      prepare: (mocks) => mocks.portfolio.risk.mockRejectedValueOnce(new PortfolioToolNotFoundError()),
    },
    {
      toolKey: 'get_backtest_result',
      input: { backtestRunId: 'other_user_backtest', sections: ['STATUS'] },
      expectedCode: 'DATA_NOT_FOUND',
      expectedStatus: AiToolCallStatus.FAILED,
      prepare: (mocks) => mocks.backtest.result.mockRejectedValueOnce(new BacktestToolNotFoundError()),
    },
    {
      toolKey: 'compute_performance_metrics',
      input: {
        seriesType: 'EQUITY',
        points: [
          { date: '2024-01-01', value: 100 },
          { date: '2024-01-01', value: 101 },
        ],
        annualizationFactor: 252,
        riskFreeRateAnnual: 0,
      },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.FAILED,
    },
    {
      toolKey: 'compute_valuation_percentile',
      input: {
        tsCode: '600519.SH',
        metric: 'PE_TTM',
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        percentileMethod: 'WEAK',
      },
      expectedCode: 'DATA_NOT_READY',
      expectedStatus: AiToolCallStatus.FAILED,
      prepare: (mocks) =>
        mocks.valuation.percentile.mockRejectedValueOnce(new QuantCalculationError('有效估值样本不足：59 < 60')),
    },
    {
      toolKey: 'search_web',
      input: { query: '公告', resultLimit: 11 },
      expectedCode: 'INVALID_ARGUMENT',
      expectedStatus: AiToolCallStatus.REJECTED,
    },
    {
      toolKey: 'fetch_web_page',
      input: { urlToken: 'token.'.padEnd(24, 'x') },
      expectedCode: 'PERMISSION_DENIED',
      expectedStatus: AiToolCallStatus.FAILED,
      prepare: (mocks) =>
        mocks.fetch.fetch.mockRejectedValueOnce(new WebSearchError('BLOCKED', 'http://127.0.0.1/private')),
    },
  ]
}

function assertBusinessSuccess(
  toolKey: AgentToolKey,
  data: unknown,
  result: Awaited<ReturnType<ToolExecutorService['execute']>>,
  mocks: ToolMocks,
): void {
  const record = data as MatrixResultData
  switch (toolKey) {
    case 'resolve_security':
      expect(record).toMatchObject({ ambiguous: false, candidates: [{ tsCode: '600000.SH', matchScore: 1 }] })
      expect(record).not.toHaveProperty('sourceModels')
      break
    case 'get_stock_price_history':
      expect(record.bars!.map((bar) => bar.tradeDate)).toEqual(['2024-01-31'])
      expect(result.provenance).toMatchObject({ adjustment: 'FORWARD', currency: 'CNY' })
      expect(result.provenance.asOf.tradeDate).toBe('2024-01-31')
      break
    case 'get_stock_overview':
      expect(record.items![0]).toMatchObject({ tsCode: '600000.SH', found: true })
      expect(result.provenance.unit).toContain('成交量为手')
      break
    case 'get_financial_statements':
      expect(record.statements![0].periods[0]).toMatchObject({
        reportPeriod: '2024-06-30',
        announcementDate: '2024-08-30',
        revisionCount: 2,
      })
      expect(result.provenance.asOf).toMatchObject({
        reportPeriod: '2024-06-30',
        announcementDate: '2024-08-30',
        availableAt: '2024-08-30T00:00:00.000Z',
      })
      break
    case 'get_financial_indicators':
      expect(record.periods![0].values[0].value).toBeNull()
      expect(result.warnings.map((warning) => warning.code)).toContain('FINANCIAL_INDICATOR_REVISION_LIMITED')
      expect(result.provenance.asOf.availableAt).toBe('2024-08-30T23:59:59.999+08:00')
      break
    case 'get_stock_moneyflow':
      expect(record.days![0].netAmount).toBe(999)
      expect(record.units).toEqual({ amount: 'CNY_10K', volume: 'LOT', netSign: 'POSITIVE_INFLOW' })
      break
    case 'get_market_snapshot':
      expect(record.sections![0]).toMatchObject({ section: 'INDEX_QUOTES', status: 'OK', asOf: '2024-06-28' })
      expect(result.provenance.asOf.tradeDate).toBe('2024-06-28')
      break
    case 'get_sector_membership':
      expect(record).toMatchObject({ effectiveDate: '2024-06-28', items: [{ sectorCode: '801780.SI' }] })
      break
    case 'get_user_watchlist':
      expect(mocks.watchlist.read).toHaveBeenCalledWith(7, expect.objectContaining({ watchlistId: 12 }))
      expect(record.groups![0].members[0].tsCode).toBe('600000.SH')
      break
    case 'get_portfolio_risk':
      expect(mocks.portfolio.risk).toHaveBeenCalledWith(7, expect.objectContaining({ portfolioId: 'portfolio_1' }))
      expect(record).toMatchObject({ dataAsOf: '2024-06-28', partial: false })
      break
    case 'get_backtest_result':
      expect(mocks.backtest.result).toHaveBeenCalledWith(7, expect.objectContaining({ maxEquityPoints: 500 }))
      expect(result.warnings.map((warning) => warning.code)).toContain('BACKTEST_BIAS_UNVERIFIED')
      break
    case 'compute_performance_metrics': {
      const values = Object.fromEntries(record.metrics!.map((metric) => [metric.key, metric.value]))
      expect(values.TOTAL_RETURN).toBeCloseTo(-0.01, 12)
      expect(values.MAX_DRAWDOWN).toBeCloseTo(-0.1, 12)
      expect(result.provenance.algorithmVersion).toBe('performance-metrics-v1')
      break
    }
    case 'compute_valuation_percentile':
      expect(record).toMatchObject({ sampleCount: 60, percentile: 0.8, dataDate: '2024-06-28' })
      expect(record.percentile!).toBeGreaterThanOrEqual(0)
      expect(record.percentile!).toBeLessThanOrEqual(1)
      break
    case 'search_web':
      expect(result.citationSourceIds).toEqual([])
      expect(result.warnings.map((warning) => warning.code)).toContain('SEARCH_SNIPPET_NOT_CITABLE')
      break
    case 'fetch_web_page':
      expect(result.citationSourceIds).toEqual(['source_2'])
      expect(record).toMatchObject({ contentHash: 'b'.repeat(64), untrustedExternalContent: true })
      break
  }
}

interface MatrixResultData extends Record<string, unknown> {
  bars?: Array<{ tradeDate: string }>
  items?: Array<Record<string, unknown>>
  statements?: Array<{ periods: Array<Record<string, unknown>> }>
  periods?: Array<{ values: Array<{ value: number | null }> }>
  days?: Array<{ netAmount: number | null }>
  units?: Record<string, string>
  sections?: Array<Record<string, unknown>>
  groups?: Array<{ members: Array<{ tsCode: string }> }>
  metrics?: Array<{ key: string; value: number | null }>
  percentile?: number
}

function createToolMocks() {
  const stock = {
    resolveSecurity: jest.fn().mockResolvedValue({
      query: '浦发银行',
      candidates: [
        {
          tsCode: '600000.SH',
          name: '浦发银行',
          securityType: 'STOCK',
          exchange: 'SSE',
          listStatus: 'L',
          listDate: '1999-11-10',
          delistDate: null,
          matchScore: 1,
        },
      ],
      ambiguous: false,
      sourceModels: ['StockBasic'],
    }),
    getPriceHistory: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600000.SH',
        frequency: 'DAILY',
        adjustment: 'FORWARD',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        fields: ['close'],
        units: {
          price: 'CNY',
          pctChange: 'PERCENT',
          volume: 'LOT',
          amount: 'CNY_THOUSAND',
          turnoverRate: 'PERCENT',
          peTtm: 'MULTIPLE',
        },
        bars: [{ tradeDate: '2024-01-31', close: 10 }],
      },
      truncated: false,
      asOf: '2024-01-31',
      adjustmentFactorAsOf: '2024-01-31',
      sourceModels: ['Daily', 'AdjFactor', 'DailyBasic'],
    }),
    getOverview: jest.fn().mockResolvedValue({
      data: {
        requestedAsOfDate: null,
        sections: ['BASIC'],
        items: [
          {
            tsCode: '600000.SH',
            found: true,
            basic: {
              symbol: '600000',
              name: '浦发银行',
              exchange: 'SSE',
              market: '主板',
              area: '上海',
              industry: '银行',
              listStatus: 'L',
              listDate: '1999-11-10',
              delistDate: null,
            },
          },
        ],
      },
      asOf: '2024-06-28',
      sourceModels: ['StockBasic'],
    }),
    screenStocks: jest.fn().mockResolvedValue({ page: 1, pageSize: 10, total: 1, items: [{ tsCode: '600000.SH', name: '浦发银行' }] }),
    getScreenerPresets: jest.fn().mockReturnValue({ presets: [{ id: 'main_inflow', name: '主力资金流入', description: '', filters: { minMainNetInflow5d: 0 } }] }),
  }
  const market = {
    snapshot: jest.fn().mockResolvedValue({
      data: {
        requestedTradeDate: null,
        sectorType: 'INDUSTRY',
        topN: 10,
        sections: [
          {
            section: 'INDEX_QUOTES',
            status: 'OK',
            asOf: '2024-06-28',
            facts: [{ key: 'close', value: 2967.4, unit: 'CNY' }],
            rows: [],
            warning: null,
          },
        ],
      },
      asOf: '2024-06-28',
      sourceModels: ['IndexDaily'],
    }),
  }
  const sector = {
    membership: jest.fn().mockResolvedValue({
      data: {
        mode: 'SECTORS_FOR_SECURITY',
        tsCode: '600000.SH',
        sectorCode: null,
        sectorType: 'INDUSTRY',
        effectiveDate: '2024-06-28',
        items: [
          {
            tsCode: '600000.SH',
            name: '浦发银行',
            sectorCode: '801780.SI',
            sectorName: '银行',
            sectorType: 'INDUSTRY',
            level: 'L1',
            weight: null,
            inDate: '1999-11-10',
            outDate: null,
          },
        ],
      },
      truncated: false,
      asOf: '2024-06-28',
      warningCodes: [],
      sourceModels: ['IndexMemberAll'],
    }),
  }
  const watchlist = {
    read: jest.fn().mockResolvedValue({
      data: {
        requestedWatchlistId: 12,
        includeLatestQuote: false,
        groups: [
          {
            id: 12,
            name: '银行观察',
            description: null,
            isDefault: false,
            sortOrder: 1,
            totalMembers: 1,
            members: [
              {
                id: 21,
                tsCode: '600000.SH',
                name: '浦发银行',
                notes: null,
                tags: ['银行'],
                targetPrice: null,
                sortOrder: 1,
                addedAt: '2024-06-01T00:00:00.000Z',
                latestQuote: null,
              },
            ],
          },
        ],
      },
      truncated: false,
      asOf: null,
      sourceModels: ['Watchlist', 'WatchlistStock'],
    }),
  }
  const financial = {
    getStatements: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        periodType: 'QUARTERLY',
        requestedAvailableAt: '2024-08-30T00:00:00.000Z',
        statements: [
          {
            statementType: 'INCOME',
            periods: [
              {
                reportPeriod: '2024-06-30',
                announcementDate: '2024-08-30',
                availableAt: '2024-08-30',
                reportType: '1',
                updateFlag: '1',
                revisionCount: 2,
                values: [
                  {
                    key: 'total_revenue',
                    sourceField: 'total_revenue',
                    unit: 'CNY',
                    valueBasis: 'CUMULATIVE',
                    reportedValue: 260,
                    singleQuarterValue: 160,
                    singleQuarterDerived: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      warnings: [{ code: 'FINANCIAL_REVISION_SELECTED', message: '已选择当时可得的最新修订版本' }],
      asOf: '2024-06-30',
      availableAsOf: '2024-08-30',
      sourceModels: ['Income'],
    }),
    getIndicators: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600519.SH',
        requestedAvailableAt: null,
        indicators: ['roe'],
        periods: [
          {
            reportPeriod: '2024-06-30',
            announcementDate: '2024-08-30',
            values: [{ key: 'roe', sourceField: 'roe', value: null, unit: 'PERCENT' }],
          },
        ],
      },
      warnings: [{ code: 'FINANCIAL_INDICATOR_REVISION_LIMITED', message: '历史修订追溯能力有限' }],
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
        days: [{ tradeDate: '2024-06-28', netAmount: 999, netVolume: 777 }],
      },
      truncated: false,
      asOf: '2024-06-28',
      sourceModels: ['Moneyflow'],
    }),
  }
  const portfolio = {
    risk: jest.fn().mockResolvedValue({
      data: {
        portfolio: { id: 'portfolio_1', name: '核心组合', kind: 'PAPER', isArchived: false },
        requestedAsOfDate: '2026-07-21',
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
        sampleCount: 60,
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
  const search = {
    search: jest.fn().mockResolvedValue({
      provider: 'fake',
      queryHash: 'a'.repeat(64),
      results: [
        {
          sourceId: 'source_1',
          urlToken: 'token.'.padEnd(24, 'x'),
          canonicalUrl: 'https://www.sse.com.cn/notice',
          title: '公告',
          snippet: '搜索摘要',
          publisher: '上海证券交易所',
          sourceType: 'EXCHANGE',
          publishedAt: '2026-07-19T00:00:00.000Z',
          retrievedAt: '2026-07-20T00:00:00.000Z',
          rank: 1,
        },
      ],
      truncated: false,
      retrievedAt: '2026-07-20T00:00:00.000Z',
      warningCodes: ['SEARCH_SNIPPET_NOT_CITABLE'],
    }),
  }
  const fetch = {
    fetch: jest.fn().mockResolvedValue({
      sourceId: 'source_2',
      canonicalUrl: 'https://www.sse.com.cn/notice',
      finalUrl: 'https://www.sse.com.cn/notice',
      title: '公告',
      publisher: '上海证券交易所',
      author: null,
      sourceType: 'EXCHANGE',
      publishedAt: '2026-07-19T00:00:00.000Z',
      retrievedAt: '2026-07-20T00:00:00.000Z',
      mimeType: 'text/html',
      language: 'zh-CN',
      contentHash: 'b'.repeat(64),
      text: '公告正文',
      sections: [
        {
          sectionId: 'section-1',
          heading: null,
          paragraphStart: 0,
          paragraphEnd: 0,
          startOffset: 0,
          endOffset: 4,
        },
      ],
      truncated: false,
      extractionVersion: 'html-text-v1',
      untrustedExternalContent: true,
      riskFlags: [],
      warningCodes: [],
    }),
  }
  return { stock, market, sector, watchlist, financial, moneyflow, portfolio, backtest, valuation, search, fetch }
}

type ToolMocks = ReturnType<typeof createToolMocks>

class MatrixAuditFake {
  private readonly calls = new Map<string, AiToolCall>()
  private sequence = 0

  async beginToolCall(command: BeginToolCallCommand): Promise<AiToolCall> {
    const id = `matrix_tool_call_${++this.sequence}`
    const call = {
      id,
      userId: command.userId,
      scopeId: command.scopeId,
      runId: command.runId,
      stepId: command.stepId,
      logicalNodeKey: command.logicalNodeKey,
      invocationIndex: command.invocationIndex,
      toolName: command.toolName,
      toolVersion: command.toolVersion,
      status: command.initialStatus ?? AiToolCallStatus.PENDING,
      attemptCount: 1,
      inputSummary: command.input as Prisma.JsonValue,
      inputHash: hashStableJson(command.input),
      outputSummary: null,
      outputHash: null,
      errorClass: null,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    } as unknown as AiToolCall
    this.calls.set(id, call)
    return call
  }

  async markToolCallRunning(_userId: number, callId: string, attemptCount: number): Promise<AiToolCall> {
    return this.update(callId, { status: AiToolCallStatus.RUNNING, attemptCount })
  }

  async markToolCallRetryWait(_userId: number, callId: string, command: RetryToolCallCommand): Promise<AiToolCall> {
    return this.update(callId, {
      status: AiToolCallStatus.RETRY_WAIT,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
    })
  }

  async completeToolCall(_userId: number, callId: string, command: CompleteToolCallCommand): Promise<AiToolCall> {
    return this.update(callId, {
      status: AiToolCallStatus.SUCCEEDED,
      outputSummary: command.output as Prisma.JsonValue,
      outputHash: hashStableJson(command.output),
      rowCount: command.rowCount,
      finishedAt: new Date(),
    })
  }

  async failToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    return this.finish(callId, AiToolCallStatus.FAILED, command)
  }

  async rejectToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    return this.finish(callId, AiToolCallStatus.REJECTED, command)
  }

  async cancelToolCall(_userId: number, callId: string, command: AuditFailureCommand): Promise<AiToolCall> {
    return this.finish(callId, AiToolCallStatus.CANCELLED, command)
  }

  callFor(toolKey: AgentToolKey, runId: string): AiToolCall {
    const call = [...this.calls.values()].find((item) => item.toolName === toolKey && item.runId === runId)
    if (!call) throw new Error(`missing audit call for ${toolKey}/${runId}`)
    return call
  }

  private finish(callId: string, status: AiToolCallStatus, command: AuditFailureCommand): AiToolCall {
    return this.update(callId, {
      status,
      errorClass: command.errorClass,
      errorCode: command.errorCode,
      errorMessage: typeof command.errorMessage === 'string' ? command.errorMessage : null,
      finishedAt: new Date(),
    })
  }

  private update(callId: string, patch: Partial<AiToolCall>): AiToolCall {
    const call = this.calls.get(callId)
    if (!call) throw new Error(`missing audit call ${callId}`)
    const updated = { ...call, ...patch } as AiToolCall
    this.calls.set(callId, updated)
    return updated
  }
}
