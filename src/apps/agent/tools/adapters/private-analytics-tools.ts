import { UserRole } from '@prisma/client'
import {
  BACKTEST_ANALYSIS_KEYS,
  BacktestAnalyticsToolError,
  BacktestAnalyticsToolFacade,
  type BacktestAnalyticsToolInput,
} from 'src/apps/backtest/backtest-analytics-tool.facade'
import {
  PORTFOLIO_ANALYTICS_SECTIONS,
  PortfolioAnalyticsToolError,
  PortfolioAnalyticsToolFacade,
  type PortfolioAnalyticsToolInput,
} from 'src/apps/portfolio/portfolio-analytics-tool.facade'
import { PORTFOLIO_NAV_ALGORITHM_VERSION } from 'src/apps/portfolio/portfolio-snapshot.service'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'

export interface PrivateAnalyticsToolDependencies {
  backtest: BacktestAnalyticsToolFacade
  portfolio: PortfolioAnalyticsToolFacade
}

const BACKTEST_POLICY: ToolPolicyDefinition = {
  requiredRole: UserRole.USER,
  sideEffect: 'READ',
  requiresConfirmation: false,
  idempotent: true,
  timeoutMs: 90_000,
  maxAttempts: 1,
  maxRows: 10_000,
  costClass: 'HIGH',
  allowedDataScopes: ['USER_PRIVATE'],
}

const PORTFOLIO_POLICY: ToolPolicyDefinition = {
  ...BACKTEST_POLICY,
  timeoutMs: 30_000,
  maxAttempts: 2,
  maxRows: 3_000,
}

export function createPrivateAnalyticsToolDefinitions(
  dependencies: PrivateAnalyticsToolDependencies,
): readonly ToolDefinition[] {
  return Object.freeze([
    backtestAnalyticsDefinition(dependencies.backtest),
    portfolioAnalyticsDefinition(dependencies.portfolio),
  ])
}

function backtestAnalyticsDefinition(facade: BacktestAnalyticsToolFacade): ToolDefinition {
  return {
    key: 'get_backtest_analytics',
    version: 1,
    description:
      '按当前用户所有权读取或计算回测 Monte Carlo、Brinson 归因、成本敏感度及已持久化高级结果；不会创建任务。',
    inputSchema: strictObject(
      {
        analyses: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { enum: [...BACKTEST_ANALYSIS_KEYS] },
        },
        backtestRunId: idSchema(),
        paramSweepId: idSchema(),
        walkForwardRunId: idSchema(),
        comparisonGroupId: idSchema(),
        monteCarlo: strictObject(
          {
            simulations: { type: 'integer', minimum: 100, maximum: 5_000 },
            seed: { type: 'integer', minimum: -2_147_483_648, maximum: 2_147_483_647 },
            confidenceLevels: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              uniqueItems: true,
              items: { type: 'number', minimum: 0.01, maximum: 0.99 },
            },
            maxSeriesPoints: { type: 'integer', minimum: 20, maximum: 1_000, default: 500 },
          },
          ['simulations', 'seed'],
        ),
        attribution: strictObject(
          {
            industryLevel: { enum: ['L1', 'L2'] },
            granularity: { enum: ['WEEKLY', 'MONTHLY'] },
            benchmarkCode: { enum: ['000300.SH', '000905.SH', '000852.SH'] },
          },
          [],
        ),
        costSensitivity: strictObject(
          {
            commissionRates: boundedNumberArray(0, 0.01),
            slippageBps: boundedNumberArray(0, 100),
          },
          [],
        ),
      },
      ['analyses'],
    ),
    outputSchema: backtestOutputSchema(),
    policy: BACKTEST_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const value = await facade.analyze(context.userId, input as unknown as BacktestAnalyticsToolInput)
        return adapterToolResult(context, input, 'get_backtest_analytics', value.data, {
          version: 1,
          sourceType: 'PROGRAM_CALCULATION',
          sourceServices: ['BacktestAnalyticsToolFacade', 'BacktestAnalyticsReadPort'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf ?? undefined,
          dataVersion: 'private-backtest-analytics-v1',
          algorithmVersion: 'backtest-analytics.v1',
          warnings: value.warnings,
        })
      }),
    countRows: countBacktestRows,
  }
}

function portfolioAnalyticsDefinition(facade: PortfolioAnalyticsToolFacade): ToolDefinition {
  return {
    key: 'get_portfolio_analytics',
    version: 1,
    description: '按当前用户所有权读取不可变持仓事件和每日点时快照，分析组合历史绩效、盈亏、漂移和交易。',
    inputSchema: strictObject(
      {
        portfolioId: { type: 'string', minLength: 1, maxLength: 32 },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: { enum: [...PORTFOLIO_ANALYTICS_SECTIONS] },
        },
        asOfDate: dateSchema(),
        startDate: dateSchema(),
        endDate: dateSchema(),
        benchmarkCode: { enum: ['000300.SH', '000905.SH', '000852.SH'], default: '000300.SH' },
        targetWeights: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          maxProperties: 100,
          patternProperties: {
            '^\\d{6}\\.(SH|SZ|BJ)$': { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        tradePage: { type: 'integer', minimum: 1, default: 1 },
        tradePageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        maxSeriesPoints: { type: 'integer', minimum: 20, maximum: 1_000, default: 500 },
      },
      ['portfolioId'],
    ),
    outputSchema: portfolioOutputSchema(),
    policy: PORTFOLIO_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const value = await facade.analyze(context.userId, input as unknown as PortfolioAnalyticsToolInput)
        return adapterToolResult(context, input, 'get_portfolio_analytics', value.data, {
          version: 1,
          sourceType: 'PROGRAM_CALCULATION',
          sourceServices: ['PortfolioAnalyticsToolFacade', 'PortfolioAnalyticsRepository'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          unit: '金额 CNY；收益/权重 DECIMAL',
          currency: 'CNY',
          dataVersion: 'portfolio-point-in-time-v1',
          algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
          warnings: value.warnings,
        })
      }),
    countRows: countPortfolioRows,
  }
}

async function executeSafely<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader()
  } catch (error) {
    if (error instanceof ToolAdapterError) throw error
    if (error instanceof BacktestAnalyticsToolError || error instanceof PortfolioAnalyticsToolError) {
      throw new ToolAdapterError(
        error.code,
        error.message,
        error.retryable,
        undefined,
        'details' in error ? error.details : undefined,
      )
    }
    throw new ToolAdapterError('UPSTREAM_FAILED', '私有分析 Tool 暂时不可用', true)
  }
}

function backtestOutputSchema(): JsonSchema {
  return strictObject(
    {
      ownerScoped: { const: true },
      backtestRunId: nullableString(),
      runStatus: nullableString(),
      reproducibility: {
        anyOf: [
          strictObject(
            {
              verified: { type: 'boolean' },
              engineVersion: nullableString(),
              dataContractVersion: nullableString(),
              universePolicyVersion: nullableString(),
              financialAsOfPolicyVersion: nullableString(),
              adjustmentPolicyVersion: nullableString(),
              qualityFlags: { type: 'array', items: { type: 'string' } },
            },
            [
              'verified',
              'engineVersion',
              'dataContractVersion',
              'universePolicyVersion',
              'financialAsOfPolicyVersion',
              'adjustmentPolicyVersion',
              'qualityFlags',
            ],
          ),
          { type: 'null' },
        ],
      },
      monteCarlo: sectionSchema(),
      brinsonAttribution: sectionSchema(),
      costSensitivity: sectionSchema(),
      paramSweepResult: sectionSchema(),
      walkForwardResult: sectionSchema(),
      comparisonResult: sectionSchema(),
      partial: { type: 'boolean' },
    },
    [
      'ownerScoped',
      'backtestRunId',
      'runStatus',
      'reproducibility',
      'monteCarlo',
      'brinsonAttribution',
      'costSensitivity',
      'paramSweepResult',
      'walkForwardResult',
      'comparisonResult',
      'partial',
    ],
  )
}

function portfolioOutputSchema(): JsonSchema {
  return strictObject(
    {
      meta: strictObject(
        {
          portfolioId: { type: 'string' },
          name: { type: 'string' },
          coverageStart: dateSchema(),
          requestedAsOfDate: { type: ['string', 'null'], format: 'date' },
          dataThrough: dateSchema(),
          benchmarkCode: { type: 'string' },
          algorithmVersion: { const: PORTFOLIO_NAV_ALGORITHM_VERSION },
          ownerScoped: { const: true },
        },
        [
          'portfolioId',
          'name',
          'coverageStart',
          'requestedAsOfDate',
          'dataThrough',
          'benchmarkCode',
          'algorithmVersion',
          'ownerScoped',
        ],
      ),
      overview: sectionSchema(),
      performance: sectionSchema(),
      pnl: sectionSchema(),
      drift: sectionSchema(),
      trades: sectionSchema(),
    },
    ['meta', 'overview', 'performance', 'pnl', 'drift', 'trades'],
  )
}

function sectionSchema(): JsonSchema {
  return strictObject(
    {
      status: { enum: ['OK', 'NOT_REQUESTED', 'NOT_READY', 'ERROR'] },
      // 各高级分析已由领域 Facade 强类型约束；这里仅将 section envelope 作为稳定公开契约。
      data: {},
      error: {
        anyOf: [
          strictObject({ code: { type: 'string' }, message: { type: 'string' } }, ['code', 'message']),
          { type: 'null' },
        ],
      },
    },
    ['status', 'data', 'error'],
  )
}

function countBacktestRows(data: unknown): number {
  const value = asRecord(data)
  return [
    'monteCarlo',
    'brinsonAttribution',
    'costSensitivity',
    'paramSweepResult',
    'walkForwardResult',
    'comparisonResult',
  ]
    .map((key) => asRecord(value[key]))
    .reduce((sum, section) => sum + estimateRows(section.data), 0)
}

function countPortfolioRows(data: unknown): number {
  const value = asRecord(data)
  const performance = asRecord(asRecord(value.performance).data)
  const trades = asRecord(asRecord(value.trades).data)
  const overview = asRecord(asRecord(value.overview).data)
  return arrayLength(performance.series) + arrayLength(trades.items) + arrayLength(overview.topPositions) + 1
}

function estimateRows(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  return Math.max(1, ...Object.values(value).map(arrayLength))
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function strictObject(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', additionalProperties: false, properties, required }
}

function idSchema(): JsonSchema {
  return { type: 'string', minLength: 1, maxLength: 64 }
}

function dateSchema(): JsonSchema {
  return { type: 'string', format: 'date' }
}

function nullableString(): JsonSchema {
  return { type: ['string', 'null'] }
}

function boundedNumberArray(minimum: number, maximum: number): JsonSchema {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 5,
    uniqueItems: true,
    items: { type: 'number', minimum, maximum },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
