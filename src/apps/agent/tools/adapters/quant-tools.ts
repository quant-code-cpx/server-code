import { UserRole } from '@prisma/client'
import {
  computePerformanceMetrics,
  PERFORMANCE_METRIC_KEYS,
  PERFORMANCE_METRICS_ALGORITHM_VERSION,
  QuantCalculationError,
  type PerformanceMetricsInput,
} from 'src/apps/agent/quant/performance-metrics'
import {
  BACKTEST_RESULT_ALGORITHM_VERSION,
  BACKTEST_RESULT_SECTIONS,
  BacktestToolFacade,
  BacktestToolNotFoundError,
  BacktestToolResultTooLargeError,
  type BacktestResultToolInput,
} from 'src/apps/backtest/backtest-tool.facade'
import {
  PORTFOLIO_RISK_SECTIONS,
  PortfolioToolFacade,
  PortfolioToolNotFoundError,
  type PortfolioRiskToolInput,
} from 'src/apps/portfolio/portfolio-tool.facade'
import {
  VALUATION_METRICS,
  ValuationToolFacade,
  ValuationToolInvalidArgumentError,
  type ValuationToolInput,
} from 'src/apps/stock/valuation-tool.facade'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import type { ToolResult, ToolSourceType, ToolWarning } from '../contracts/tool-result'
import type { ToolAccessContext } from '../tool-access-context'
import { hashStableJson } from '../tool-json'

export interface QuantToolDependencies {
  portfolio: PortfolioToolFacade
  backtest: BacktestToolFacade
  valuation: ValuationToolFacade
  config: IAgentToolsConfig
}

const CALCULATION_POLICY: ToolPolicyDefinition = {
  requiredRole: UserRole.USER,
  sideEffect: 'READ',
  requiresConfirmation: false,
  idempotent: true,
  timeoutMs: 10_000,
  maxAttempts: 1,
  maxRows: 10_000,
  costClass: 'MEDIUM',
  allowedDataScopes: ['QUANT_CALCULATION'],
}

const PRIVATE_POLICY: ToolPolicyDefinition = {
  ...CALCULATION_POLICY,
  timeoutMs: 30_000,
  maxAttempts: 2,
  maxRows: 2_000,
  costClass: 'HIGH',
  allowedDataScopes: ['USER_PRIVATE'],
}

const PUBLIC_DATA_POLICY: ToolPolicyDefinition = {
  ...CALCULATION_POLICY,
  timeoutMs: 30_000,
  maxAttempts: 2,
  maxRows: 2_600,
  costClass: 'MEDIUM',
  allowedDataScopes: ['PUBLIC_MARKET_DATA'],
}

export function createQuantToolDefinitions(dependencies: QuantToolDependencies): readonly ToolDefinition[] {
  return Object.freeze([
    portfolioRiskDefinition(dependencies.portfolio),
    backtestResultDefinition(dependencies.backtest),
    performanceMetricsDefinition(dependencies.config),
    valuationPercentileDefinition(dependencies.valuation, dependencies.config),
  ])
}

function portfolioRiskDefinition(portfolio: PortfolioToolFacade): ToolDefinition {
  return {
    key: 'get_portfolio_risk',
    version: 1,
    description: '按用户所有权和指定数据时点读取组合持仓、集中度、行业、市值、Beta 与风险违规。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['portfolioId', 'asOfDate', 'sections'],
      properties: {
        portfolioId: { type: 'string', minLength: 1, maxLength: 64 },
        asOfDate: { type: 'string', format: 'date' },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          uniqueItems: true,
          items: { enum: [...PORTFOLIO_RISK_SECTIONS] },
        },
      },
    },
    outputSchema: portfolioRiskOutputSchema(),
    policy: PRIVATE_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const value = await portfolio.risk(context.userId, input as unknown as PortfolioRiskToolInput)
        const warnings: ToolWarning[] = [
          ...(value.data.partial
            ? [
                {
                  code: 'PORTFOLIO_RISK_PARTIAL',
                  message: '部分风险维度计算失败，缺失维度不能解释为零风险',
                  affectedFields: value.data.componentErrors.map((error) => error.section),
                },
              ]
            : []),
          ...(value.data.requestedAsOfDate < currentShanghaiDate()
            ? [
                {
                  code: 'PORTFOLIO_HOLDINGS_NOT_POINT_IN_TIME',
                  message: '组合仅保存当前持仓；历史 asOfDate 只约束市场数据与违规记录，不代表历史持仓快照',
                  affectedFields: ['holdings', 'concentration', 'industry', 'marketCap', 'beta'],
                },
              ]
            : []),
        ]
        return toolResult(context, input, 'get_portfolio_risk', value.data, {
          sourceType: 'DATABASE',
          sourceServices: ['PortfolioToolFacade', 'PortfolioRiskService'],
          sourceModels: value.sourceModels,
          asOf: value.asOf,
          dataVersion: 'portfolio-risk-snapshot-v1',
          warnings,
        })
      }),
    countRows: (data) => (data as { holdings: unknown[] | null }).holdings?.length ?? 1,
  }
}

function backtestResultDefinition(backtest: BacktestToolFacade): ToolDefinition {
  return {
    key: 'get_backtest_result',
    version: 1,
    description: '按用户所有权读取回测配置、状态、指标、净值和交易摘要，并强制返回历史偏差标记。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['backtestRunId', 'sections'],
      properties: {
        backtestRunId: { type: 'string', minLength: 1, maxLength: 64 },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          uniqueItems: true,
          items: { enum: [...BACKTEST_RESULT_SECTIONS] },
        },
        maxEquityPoints: { type: 'integer', minimum: 10, maximum: 2_000, default: 500 },
      },
    },
    outputSchema: backtestResultOutputSchema(),
    policy: PRIVATE_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<BacktestResultToolInput, 'maxEquityPoints'> & { maxEquityPoints?: number }
        const value = await backtest.result(context.userId, { ...raw, maxEquityPoints: raw.maxEquityPoints ?? 500 })
        return toolResult(context, input, 'get_backtest_result', value.data, {
          sourceType: 'DATABASE',
          sourceServices: ['BacktestToolFacade'],
          sourceModels: value.sourceModels,
          asOf: value.asOf,
          dataVersion: 'backtest-result-v1',
          algorithmVersion: BACKTEST_RESULT_ALGORITHM_VERSION,
          warnings: value.warnings,
          truncated: value.truncated,
        })
      }),
    countRows: (data) => (data as { equity: { points: unknown[] } | null }).equity?.points.length ?? 1,
  }
}

function performanceMetricsDefinition(config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'compute_performance_metrics',
    version: 1,
    description: '用固定 TypeScript 算法计算收益、年化、波动、Sharpe、Sortino、回撤和历史 VaR/CVaR。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['seriesType', 'points', 'annualizationFactor', 'riskFreeRateAnnual'],
      properties: {
        seriesType: { enum: ['EQUITY', 'RETURN'] },
        points: {
          type: 'array',
          minItems: 2,
          maxItems: config.quantMaxPoints,
          items: strictObject({ date: { type: 'string', format: 'date' }, value: { type: 'number' } }, [
            'date',
            'value',
          ]),
        },
        annualizationFactor: { type: 'integer', enum: [12, 52, 242, 252] },
        riskFreeRateAnnual: { type: 'number', minimum: -0.1, maximum: 0.5 },
        metrics: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: { enum: [...PERFORMANCE_METRIC_KEYS] },
        },
      },
    },
    outputSchema: performanceMetricsOutputSchema(),
    policy: { ...CALCULATION_POLICY, maxRows: config.quantMaxPoints },
    execute: async (input, context) =>
      executeSafely(async () => {
        const command = input as unknown as PerformanceMetricsInput
        if (command.points.length > config.quantMaxPoints) throw invalidArgument('绩效序列超过服务端点数上限')
        const data = computePerformanceMetrics(command, PERFORMANCE_METRICS_ALGORITHM_VERSION)
        return toolResult(context, input, 'compute_performance_metrics', data, {
          sourceType: 'PROGRAM_CALCULATION',
          sourceServices: ['computePerformanceMetrics'],
          sourceModels: [],
          asOf: data.sample.endDate,
          unit: '收益与风险为 DECIMAL，比率为 RATIO',
          dataVersion: 'inline-series-v1',
          algorithmVersion: data.algorithmVersion,
          warnings: data.warnings,
        })
      }),
    countRows: (data) => (data as { sample: { pointCount: number } }).sample.pointCount,
  }
}

function valuationPercentileDefinition(valuation: ValuationToolFacade, config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'compute_valuation_percentile',
    version: 1,
    description: '查询单股最多十年历史估值，用固定过滤、缩尾和分位方法计算当前估值分位。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode', 'metric', 'startDate', 'endDate', 'percentileMethod'],
      properties: {
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        metric: { enum: [...VALUATION_METRICS] },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        asOfDate: { type: 'string', format: 'date' },
        percentileMethod: { enum: ['WEAK', 'MEAN'] },
        excludeNonPositive: { type: 'boolean', default: true },
        winsorize: { enum: ['NONE', 'P1_P99'], default: 'NONE' },
      },
    },
    outputSchema: valuationPercentileOutputSchema(),
    policy: PUBLIC_DATA_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<ValuationToolInput, 'excludeNonPositive' | 'winsorize' | 'minimumSamples'> & {
          excludeNonPositive?: boolean
          winsorize?: 'NONE' | 'P1_P99'
        }
        const value = await valuation.percentile({
          ...raw,
          excludeNonPositive: raw.excludeNonPositive ?? true,
          winsorize: raw.winsorize ?? 'NONE',
          minimumSamples: config.valuationMinSamples,
        })
        return toolResult(context, input, 'compute_valuation_percentile', value.data, {
          sourceType: 'PROGRAM_CALCULATION',
          sourceServices: ['ValuationToolFacade', 'computeValuationPercentile'],
          sourceModels: value.sourceModels,
          asOf: value.asOf,
          unit: value.data.unit,
          dataVersion: 'daily-basic-valuation-v1',
          algorithmVersion: value.data.algorithmVersion,
          warnings: value.data.warnings,
        })
      }),
    countRows: (data) => (data as { sampleCount: number }).sampleCount,
  }
}

interface ToolResultOptions {
  sourceType: ToolSourceType
  sourceServices: string[]
  sourceModels: string[]
  asOf: string | null
  unit?: string
  dataVersion: string
  algorithmVersion?: string
  warnings?: ToolWarning[]
  truncated?: boolean
}

function toolResult<T>(
  context: ToolAccessContext,
  input: unknown,
  toolKey: ToolResult<T>['toolKey'],
  data: T,
  options: ToolResultOptions,
): ToolResult<T> {
  return {
    ok: true,
    toolCallId: context.toolCallId,
    toolKey,
    toolVersion: 1,
    data,
    provenance: {
      sourceType: options.sourceType,
      sourceServices: options.sourceServices,
      sourceModels: options.sourceModels,
      asOf: { ...(options.asOf ? { tradeDate: options.asOf } : {}), retrievedAt: new Date().toISOString() },
      timezone: 'Asia/Shanghai',
      ...(options.unit ? { unit: options.unit } : {}),
      dataVersion: options.dataVersion,
      ...(options.algorithmVersion ? { algorithmVersion: options.algorithmVersion } : {}),
      inputHash: hashStableJson(input),
      outputHash: hashStableJson(data),
    },
    citationSourceIds: [],
    warnings: options.warnings ?? [],
    truncated: options.truncated ?? false,
  }
}

async function executeSafely<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader()
  } catch (error) {
    if (error instanceof ToolAdapterError) throw error
    if (error instanceof PortfolioToolNotFoundError || error instanceof BacktestToolNotFoundError) {
      throw new ToolAdapterError('DATA_NOT_FOUND', error.message)
    }
    if (error instanceof BacktestToolResultTooLargeError) {
      throw new ToolAdapterError('RESULT_TOO_LARGE', error.message)
    }
    if (error instanceof ValuationToolInvalidArgumentError) throw invalidArgument(error.message)
    if (error instanceof QuantCalculationError) {
      if (error.message.startsWith('有效估值样本不足')) {
        throw new ToolAdapterError('DATA_NOT_READY', error.message)
      }
      throw invalidArgument(error.message)
    }
    throw new ToolAdapterError('UPSTREAM_FAILED', '确定性量化 Tool 暂时不可用', true)
  }
}

function invalidArgument(message: string): ToolAdapterError {
  return new ToolAdapterError('INVALID_ARGUMENT', message)
}

function performanceMetricsOutputSchema(): JsonSchema {
  return strictObject(
    {
      algorithmVersion: { type: 'string' },
      seriesType: { enum: ['EQUITY', 'RETURN'] },
      annualizationFactor: { type: 'integer' },
      riskFreeRateAnnual: { type: 'number' },
      sample: strictObject(
        {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          pointCount: { type: 'integer', minimum: 2 },
          returnCount: { type: 'integer', minimum: 1 },
        },
        ['startDate', 'endDate', 'pointCount', 'returnCount'],
      ),
      metrics: {
        type: 'array',
        maxItems: 10,
        items: strictObject(
          {
            key: { enum: [...PERFORMANCE_METRIC_KEYS] },
            value: nullableNumber(),
            unit: { enum: ['DECIMAL', 'RATIO'] },
            sampleCount: { type: 'integer', minimum: 1 },
          },
          ['key', 'value', 'unit', 'sampleCount'],
        ),
      },
      warnings: warningSchema(),
    },
    ['algorithmVersion', 'seriesType', 'annualizationFactor', 'riskFreeRateAnnual', 'sample', 'metrics', 'warnings'],
  )
}

function valuationPercentileOutputSchema(): JsonSchema {
  return strictObject(
    {
      tsCode: { type: 'string' },
      metric: { enum: [...VALUATION_METRICS] },
      unit: { enum: ['RATIO', 'PERCENT'] },
      requestedWindow: dateWindowSchema(),
      requestedAsOfDate: nullableDate(),
      effectiveEndDate: { type: 'string', format: 'date' },
      algorithmVersion: { type: 'string' },
      currentValue: { type: 'number' },
      percentileValue: { type: 'number' },
      percentile: { type: 'number', minimum: 0, maximum: 1 },
      percentileMethod: { enum: ['WEAK', 'MEAN'] },
      sampleCount: { type: 'integer', minimum: 1 },
      dataDate: { type: 'string', format: 'date' },
      window: dateWindowSchema(),
      statistics: strictObject({ min: { type: 'number' }, max: { type: 'number' }, median: { type: 'number' } }, [
        'min',
        'max',
        'median',
      ]),
      filtered: strictObject(
        {
          missingOrNonFinite: { type: 'integer', minimum: 0 },
          nonPositive: { type: 'integer', minimum: 0 },
          winsorized: { type: 'integer', minimum: 0 },
        },
        ['missingOrNonFinite', 'nonPositive', 'winsorized'],
      ),
      warnings: warningSchema(),
    },
    [
      'tsCode',
      'metric',
      'unit',
      'requestedWindow',
      'requestedAsOfDate',
      'effectiveEndDate',
      'algorithmVersion',
      'currentValue',
      'percentileValue',
      'percentile',
      'percentileMethod',
      'sampleCount',
      'dataDate',
      'window',
      'statistics',
      'filtered',
      'warnings',
    ],
  )
}

function portfolioRiskOutputSchema(): JsonSchema {
  const holding = strictObject(
    {
      tsCode: { type: 'string' },
      stockName: { type: 'string' },
      quantity: { type: 'integer' },
      avgCost: { type: 'number' },
      marketValue: nullableNumber(),
      weight: nullableNumber(),
    },
    ['tsCode', 'stockName', 'quantity', 'avgCost', 'marketValue', 'weight'],
  )
  return strictObject(
    {
      portfolio: strictObject(
        {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string' },
          isArchived: { type: 'boolean' },
        },
        ['id', 'name', 'kind', 'isArchived'],
      ),
      requestedAsOfDate: { type: 'string', format: 'date' },
      dataAsOf: nullableDate(),
      sections: { type: 'array', maxItems: 6, uniqueItems: true, items: { enum: [...PORTFOLIO_RISK_SECTIONS] } },
      partial: { type: 'boolean' },
      holdings: nullableArray(holding, 500),
      concentration: nullableObject(
        {
          hhi: { type: 'number' },
          top1Weight: { type: 'number' },
          top3Weight: { type: 'number' },
          top5Weight: { type: 'number' },
        },
        ['hhi', 'top1Weight', 'top3Weight', 'top5Weight'],
      ),
      industry: nullableObject(
        {
          tradeDate: nullableDate(),
          industries: {
            type: 'array',
            maxItems: 500,
            items: strictObject(
              {
                industry: { type: 'string' },
                stockCount: { type: 'integer' },
                totalMarketValue: nullableNumber(),
                weight: nullableNumber(),
              },
              ['industry', 'stockCount', 'totalMarketValue', 'weight'],
            ),
          },
        },
        ['tradeDate', 'industries'],
      ),
      marketCap: nullableObject(
        {
          tradeDate: nullableDate(),
          byStock: {
            type: 'array',
            maxItems: 500,
            items: strictObject(
              {
                tsCode: { type: 'string' },
                stockName: { type: 'string' },
                totalMv: nullableNumber(),
                weight: nullableNumber(),
                capTier: { type: 'string' },
              },
              ['tsCode', 'stockName', 'totalMv', 'weight', 'capTier'],
            ),
          },
          tiers: {
            type: 'array',
            maxItems: 5,
            items: strictObject(
              { tier: { type: 'string' }, weight: { type: 'number' }, stockCount: { type: 'integer' } },
              ['tier', 'weight', 'stockCount'],
            ),
          },
        },
        ['tradeDate', 'byStock', 'tiers'],
      ),
      beta: nullableObject(
        {
          tradeDate: nullableDate(),
          benchmarkCode: { type: 'string' },
          portfolioBeta: nullableNumber(),
          holdings: {
            type: 'array',
            maxItems: 500,
            items: strictObject(
              {
                tsCode: { type: 'string' },
                stockName: { type: 'string' },
                beta: nullableNumber(),
                dataPoints: { type: 'integer' },
              },
              ['tsCode', 'stockName', 'beta', 'dataPoints'],
            ),
          },
        },
        ['tradeDate', 'benchmarkCode', 'portfolioBeta', 'holdings'],
      ),
      violations: nullableArray(
        strictObject(
          {
            id: { type: 'string' },
            ruleType: { type: 'string' },
            actualValue: { type: 'number' },
            threshold: { type: 'number' },
            detail: nullableString(),
            checkedAt: { type: 'string', format: 'date-time' },
          },
          ['id', 'ruleType', 'actualValue', 'threshold', 'detail', 'checkedAt'],
        ),
        100,
      ),
      componentErrors: {
        type: 'array',
        maxItems: 6,
        items: strictObject({ section: { enum: [...PORTFOLIO_RISK_SECTIONS] }, code: { type: 'string' } }, [
          'section',
          'code',
        ]),
      },
    },
    [
      'portfolio',
      'requestedAsOfDate',
      'dataAsOf',
      'sections',
      'partial',
      'holdings',
      'concentration',
      'industry',
      'marketCap',
      'beta',
      'violations',
      'componentErrors',
    ],
  )
}

function backtestResultOutputSchema(): JsonSchema {
  const metrics = [
    'totalReturn',
    'annualizedReturn',
    'benchmarkReturn',
    'excessReturn',
    'maxDrawdown',
    'sharpeRatio',
    'sortinoRatio',
    'calmarRatio',
    'volatility',
    'alpha',
    'beta',
    'informationRatio',
    'winRate',
    'turnoverRate',
  ]
  const metricProperties = Object.fromEntries(metrics.map((key) => [key, nullableNumber()]))
  return strictObject(
    {
      backtestRunId: { type: 'string' },
      sections: { type: 'array', maxItems: 6, uniqueItems: true, items: { enum: [...BACKTEST_RESULT_SECTIONS] } },
      algorithmVersion: { type: 'string' },
      partial: { type: 'boolean' },
      config: nullableObject(
        {
          strategyType: { type: 'string' },
          strategyConfigJson: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          benchmarkTsCode: { type: 'string' },
          universe: { type: 'string' },
          customUniverseTsCodes: { type: ['array', 'null'], items: { type: 'string' } },
          initialCapital: { type: 'number' },
          rebalanceFrequency: { type: 'string' },
          priceMode: { type: 'string' },
          commissionRate: nullableNumber(),
          stampDutyRate: nullableNumber(),
          minCommission: nullableNumber(),
          slippageBps: { type: ['integer', 'null'] },
        },
        [
          'strategyType',
          'strategyConfigJson',
          'startDate',
          'endDate',
          'benchmarkTsCode',
          'universe',
          'customUniverseTsCodes',
          'initialCapital',
          'rebalanceFrequency',
          'priceMode',
          'commissionRate',
          'stampDutyRate',
          'minCommission',
          'slippageBps',
        ],
      ),
      runStatus: nullableObject(
        {
          status: { type: 'string' },
          terminal: { type: 'boolean' },
          progress: { type: 'integer' },
          failedReason: nullableString(),
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: nullableDateTime(),
          completedAt: nullableDateTime(),
        },
        ['status', 'terminal', 'progress', 'failedReason', 'createdAt', 'startedAt', 'completedAt'],
      ),
      metrics: nullableObject(
        {
          ...metricProperties,
          tradeCount: { type: ['integer', 'null'] },
          units: strictObject({ returns: { const: 'DECIMAL' }, ratios: { const: 'RATIO' } }, ['returns', 'ratios']),
        },
        [...metrics, 'tradeCount', 'units'],
      ),
      equity: nullableObject(
        {
          totalPoints: { type: 'integer', minimum: 0 },
          returnedPoints: { type: 'integer', minimum: 0 },
          sampling: { enum: ['NONE', 'EVEN'] },
          truncated: { type: 'boolean' },
          points: {
            type: 'array',
            maxItems: 2_000,
            items: strictObject(
              {
                tradeDate: { type: 'string', format: 'date' },
                nav: { type: 'number' },
                benchmarkNav: nullableNumber(),
                drawdown: nullableNumber(),
                dailyReturn: nullableNumber(),
                benchmarkReturn: nullableNumber(),
                exposure: nullableNumber(),
                cashRatio: nullableNumber(),
              },
              [
                'tradeDate',
                'nav',
                'benchmarkNav',
                'drawdown',
                'dailyReturn',
                'benchmarkReturn',
                'exposure',
                'cashRatio',
              ],
            ),
          },
        },
        ['totalPoints', 'returnedPoints', 'sampling', 'truncated', 'points'],
      ),
      tradesSummary: nullableObject(
        {
          tradeCount: { type: 'integer' },
          symbolCount: { type: 'integer' },
          totalAmount: nullableNumber(),
          totalCommission: nullableNumber(),
          totalStampDuty: nullableNumber(),
          totalSlippageCost: nullableNumber(),
          bySide: {
            type: 'array',
            items: strictObject({ side: { type: 'string' }, count: { type: 'integer' }, amount: nullableNumber() }, [
              'side',
              'count',
              'amount',
            ]),
          },
          currency: { const: 'CNY' },
        },
        [
          'tradeCount',
          'symbolCount',
          'totalAmount',
          'totalCommission',
          'totalStampDuty',
          'totalSlippageCost',
          'bySide',
          'currency',
        ],
      ),
      attribution: { type: 'null' },
      biasFlags: strictObject(
        {
          survivorship: { const: 'UNVERIFIED' },
          pointInTimeUniverse: { const: false },
          announcementDate: { const: false },
          adjustment: { const: 'UNVERIFIED' },
          reproducible: { const: false },
        },
        ['survivorship', 'pointInTimeUniverse', 'announcementDate', 'adjustment', 'reproducible'],
      ),
      componentErrors: {
        type: 'array',
        maxItems: 6,
        items: strictObject({ section: { enum: [...BACKTEST_RESULT_SECTIONS] }, code: { type: 'string' } }, [
          'section',
          'code',
        ]),
      },
    },
    [
      'backtestRunId',
      'sections',
      'algorithmVersion',
      'partial',
      'config',
      'runStatus',
      'metrics',
      'equity',
      'tradesSummary',
      'attribution',
      'biasFlags',
      'componentErrors',
    ],
  )
}

function strictObject(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, ...(required.length ? { required } : {}), properties }
}

function nullableObject(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: ['object', 'null'], additionalProperties: false, required, properties }
}

function nullableArray(items: JsonSchema, maxItems: number): JsonSchema {
  return { type: ['array', 'null'], maxItems, items }
}

function nullableNumber(): JsonSchema {
  return { type: ['number', 'null'] }
}

function nullableString(): JsonSchema {
  return { type: ['string', 'null'] }
}

function nullableDate(): JsonSchema {
  return { type: ['string', 'null'], format: 'date' }
}

function nullableDateTime(): JsonSchema {
  return { type: ['string', 'null'], format: 'date-time' }
}

function dateWindowSchema(): JsonSchema {
  return strictObject({ startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } }, [
    'startDate',
    'endDate',
  ])
}

function warningSchema(): JsonSchema {
  return {
    type: 'array',
    items: strictObject({ code: { type: 'string' }, message: { type: 'string' } }, ['code', 'message']),
  }
}

function currentShanghaiDate(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
