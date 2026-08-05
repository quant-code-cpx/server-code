import { UserRole } from '@prisma/client'
import {
  FACTOR_ANALYSIS_TYPES,
  FACTOR_UNIVERSES,
  FactorAnalysisToolFacade,
  type FactorAnalysisToolInput,
} from 'src/apps/factor/factor-analysis-tool.facade'
import {
  FUND_RESEARCH_SECTIONS,
  FundResearchToolFacade,
  type FundResearchInput,
} from 'src/apps/fund/fund-research-tool.facade'
import {
  INDUSTRY_ROTATION_SECTIONS,
  IndustryRotationToolFacade,
  type IndustryRotationResearchInput,
} from 'src/apps/industry-rotation/industry-rotation-tool.facade'
import {
  INDEX_RESEARCH_SECTIONS,
  IndexResearchToolFacade,
  type IndexMarketDataInput,
} from 'src/apps/index/index-research-tool.facade'
import {
  MACRO_SECTIONS,
  MACRO_SERIES,
  MacroResearchToolFacade,
  type MacroSnapshotInput,
} from 'src/apps/macro-research/macro-research-tool.facade'
import { MarketMultiAssetToolError } from 'src/apps/market-multi-asset/market-multi-asset.types'
import type { AgentToolKey, JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'

export interface MarketMultiAssetToolDependencies {
  index: IndexResearchToolFacade
  fund: FundResearchToolFacade
  industry: IndustryRotationToolFacade
  factor: FactorAnalysisToolFacade
  macro: MacroResearchToolFacade
}

export function createMarketMultiAssetToolDefinitions(
  dependencies: MarketMultiAssetToolDependencies,
): readonly ToolDefinition[] {
  return Object.freeze([
    definition({
      key: 'get_index_market_data',
      description: '查询指数基本信息、最新行情、历史行情、估值和最近成分权重；周/月线由本地日线确定性聚合。',
      inputSchema: objectSchema(
        {
          indexCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ)$' },
          sections: uniqueEnumArray(INDEX_RESEARCH_SECTIONS, 5),
          asOfDate: dateSchema,
          startDate: dateSchema,
          endDate: dateSchema,
          frequency: { enum: ['D', 'W', 'M'] },
          constituentLimit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        ['indexCode'],
      ),
      outputSchema: indexOutputSchema(),
      policy: readPolicy(20_000, 2_500, 'MEDIUM'),
      sourceType: 'DATABASE',
      sourceServices: ['IndexResearchToolFacade', 'IndexResearchRepository'],
      sourceModels: ['IndexDaily', 'IndexDailyBasic', 'IndexWeight', 'StockBasic'],
      execute: (input) => dependencies.index.getMarketData(input as unknown as IndexMarketDataInput),
      dataThrough: sectionDataThrough,
      algorithmVersion: 'index-bar-aggregation.v1',
      countRows: sectionRows,
    }),
    definition({
      key: 'get_fund_research',
      description: '查询公募基金基本信息、净值、场内价格、份额、已公告持仓和显式标记的 ETF 资金流估算。',
      inputSchema: objectSchema(
        {
          fundCode: { type: 'string', pattern: '^\\d{6}\\.(OF|SH|SZ)$' },
          sections: uniqueEnumArray(FUND_RESEARCH_SECTIONS, 6),
          asOfDate: dateSchema,
          startDate: dateSchema,
          endDate: dateSchema,
          holdingPeriods: { type: 'integer', minimum: 1, maximum: 12 },
          maxSeriesPoints: { type: 'integer', minimum: 20, maximum: 1_000 },
        },
        ['fundCode'],
      ),
      outputSchema: fundOutputSchema(),
      policy: readPolicy(25_000, 3_000, 'MEDIUM'),
      sourceType: 'DATABASE',
      sourceServices: ['FundResearchToolFacade', 'FundResearchRepository'],
      sourceModels: ['FundBasic', 'FundNav', 'FundDaily', 'FundShare', 'FundPortfolio'],
      execute: (input) => dependencies.fund.getResearch(input as unknown as FundResearchInput),
      dataThrough: sectionDataThrough,
      algorithmVersion: 'etf-flow-estimate.v1',
      countRows: sectionRows,
    }),
    definition({
      key: 'get_industry_rotation',
      description: '按 THS 固定分类查询行业收益、动量、资金流、估值、热力图和详情；跨来源仅做名称完全匹配。',
      inputSchema: objectSchema({
        sections: uniqueEnumArray(INDUSTRY_ROTATION_SECTIONS, 6),
        industryCodes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', pattern: '^[A-Z0-9]{4,12}\\.[A-Z]{2}$' },
        },
        asOfDate: dateSchema,
        periods: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: { type: 'integer', minimum: 1, maximum: 120 },
        },
        topN: { type: 'integer', minimum: 1, maximum: 50 },
        heatmapTradeDays: { type: 'integer', minimum: 5, maximum: 60 },
      }),
      outputSchema: industryOutputSchema(),
      policy: readPolicy(30_000, 3_000, 'HIGH'),
      sourceType: 'PROGRAM_CALCULATION',
      sourceServices: ['IndustryRotationToolFacade', 'IndustryRotationResearchRepository'],
      sourceModels: ['ThsIndex', 'ThsDaily', 'MoneyflowIndDc', 'ValuationDailyMedian'],
      execute: (input) => dependencies.industry.getRotation(input as unknown as IndustryRotationResearchInput),
      dataThrough: sectionDataThrough,
      algorithmVersion: 'industry-rotation.v1',
      countRows: sectionRows,
    }),
    definition({
      key: 'get_factor_analysis',
      description:
        '对已启用内置/预计算因子执行单项 VALUES、IC、QUANTILE、DECAY、DISTRIBUTION 或 CORRELATION 分析；不接受表达式、SQL 或写操作。',
      inputSchema: factorInputSchema(),
      outputSchema: factorOutputSchema(),
      policy: readPolicy(60_000, 5_000, 'HIGH'),
      sourceType: 'PROGRAM_CALCULATION',
      sourceServices: ['FactorAnalysisToolFacade', 'FactorComputeService', 'FactorAnalysisService'],
      sourceModels: ['FactorDefinition', 'FactorSnapshot', 'FactorSnapshotSummary', 'Daily', 'AdjFactor'],
      execute: (input) => dependencies.factor.analyze(input as unknown as FactorAnalysisToolInput),
      dataThrough: (data) => (data as { dataThrough?: string }).dataThrough,
      algorithmVersion: 'factor-analysis.v1',
      countRows: (data) => factorRows(data),
    }),
    definition({
      key: 'get_macro_snapshot',
      description:
        '查询本地 CPI、PPI、GDP 和 SHIBOR 最新值或历史序列；官方发布日期缺失会显式告警，systemKnownAt 不冒充官方发布时间。',
      inputSchema: objectSchema({
        series: uniqueEnumArray(MACRO_SERIES, 4),
        sections: uniqueEnumArray(MACRO_SECTIONS, 2),
        startPeriod: { type: 'string', minLength: 6, maxLength: 10 },
        endPeriod: { type: 'string', minLength: 6, maxLength: 10 },
        historyLimit: { type: 'integer', minimum: 1, maximum: 500 },
      }),
      outputSchema: macroOutputSchema(),
      policy: readPolicy(10_000, 2_000, 'LOW'),
      sourceType: 'DATABASE',
      sourceServices: ['MacroResearchToolFacade', 'MacroResearchRepository'],
      sourceModels: ['MacroCpi', 'MacroPpi', 'MacroGdp', 'MacroShibor'],
      execute: (input) => dependencies.macro.getSnapshot(input as unknown as MacroSnapshotInput),
      dataThrough: (data) =>
        maxString(
          Object.values((data as { dataThroughBySeries?: Record<string, string | null> }).dataThroughBySeries ?? {}),
        ),
      countRows: (data) => macroRows(data),
    }),
  ])
}

interface DefinitionOptions {
  key: AgentToolKey
  description: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  policy: ToolPolicyDefinition
  sourceType: 'DATABASE' | 'PROGRAM_CALCULATION'
  sourceServices: string[]
  sourceModels: string[]
  execute(input: Record<string, unknown>): Promise<{ data: unknown; warnings: unknown[]; truncated?: boolean }>
  dataThrough(data: unknown): string | undefined
  algorithmVersion?: string
  countRows(data: unknown): number
}

function definition(options: DefinitionOptions): ToolDefinition {
  return {
    key: options.key,
    version: 1,
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    policy: options.policy,
    execute: async (input, context) => {
      try {
        const result = await options.execute(input)
        const dataThrough = options.dataThrough(result.data)
        return adapterToolResult(context, input, options.key, result.data, {
          version: 1,
          sourceType: options.sourceType,
          sourceServices: options.sourceServices,
          sourceModels: options.sourceModels,
          tradeDate: dataThrough && /^\d{4}-\d{2}-\d{2}$/.test(dataThrough) ? dataThrough : undefined,
          dataVersion: `${options.key}.v1:${dataThrough ?? 'empty'}`,
          algorithmVersion: options.algorithmVersion,
          warnings: result.warnings as [],
          truncated: result.truncated,
        })
      } catch (error) {
        if (error instanceof MarketMultiAssetToolError) {
          throw new ToolAdapterError(error.code, error.message, error.retryable)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', `${options.key} 暂时不可用`, true)
      }
    },
    countRows: options.countRows,
  }
}

function readPolicy(timeoutMs: number, maxRows: number, costClass: 'LOW' | 'MEDIUM' | 'HIGH'): ToolPolicyDefinition {
  return {
    requiredRole: UserRole.USER,
    sideEffect: 'READ',
    requiresConfirmation: false,
    idempotent: true,
    timeoutMs,
    maxAttempts: 2,
    maxRows,
    costClass,
    allowedDataScopes: ['PUBLIC_MARKET_DATA'],
  }
}

const dateSchema: JsonSchema = { type: 'string', format: 'date' }
const nullableString: JsonSchema = { type: ['string', 'null'] }
const nullableDate: JsonSchema = { type: ['string', 'null'], format: 'date' }
const nullableNumber: JsonSchema = { type: ['number', 'null'] }

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties }
}

function uniqueEnumArray(values: readonly string[], maximum: number): JsonSchema {
  return { type: 'array', minItems: 1, maxItems: maximum, uniqueItems: true, items: { enum: [...values] } }
}

function arraySchema(items: JsonSchema, maxItems: number): JsonSchema {
  return { type: 'array', maxItems, items }
}

function sectionSchema(data: JsonSchema): JsonSchema {
  return objectSchema(
    {
      status: { enum: ['OK', 'NOT_REQUESTED', 'NOT_READY', 'ERROR'] },
      data: { anyOf: [data, { type: 'null' }] },
      error: {
        anyOf: [
          { type: 'null' },
          objectSchema({ code: { type: 'string' }, message: { type: 'string' } }, ['code', 'message']),
        ],
      },
    },
    ['status', 'data', 'error'],
  )
}

function looseObject(): JsonSchema {
  return {}
}

function nullableStringMap(keys: readonly string[]): JsonSchema {
  return objectSchema(Object.fromEntries(keys.map((key) => [key, nullableString])))
}

function barSchema(): JsonSchema {
  return objectSchema(
    {
      tradeDate: dateSchema,
      open: nullableNumber,
      high: nullableNumber,
      low: nullableNumber,
      close: nullableNumber,
      preClose: nullableNumber,
      change: nullableNumber,
      pctChg: nullableNumber,
      vol: nullableNumber,
      amount: nullableNumber,
    },
    ['tradeDate', 'open', 'high', 'low', 'close', 'preClose', 'change', 'pctChg', 'vol', 'amount'],
  )
}

function indexOutputSchema(): JsonSchema {
  return objectSchema(
    {
      meta: objectSchema(
        {
          indexCode: { type: 'string' },
          name: nullableString,
          requestedAsOfDate: nullableDate,
          dataThroughBySection: nullableStringMap(INDEX_RESEARCH_SECTIONS),
          coverageStartBySection: nullableStringMap(INDEX_RESEARCH_SECTIONS),
          currency: { const: 'CNY' },
          adjustment: { const: 'NONE' },
          frequency: { enum: ['D', 'W', 'M'] },
          algorithmVersion: nullableString,
        },
        [
          'indexCode',
          'name',
          'requestedAsOfDate',
          'dataThroughBySection',
          'coverageStartBySection',
          'currency',
          'adjustment',
          'frequency',
          'algorithmVersion',
        ],
      ),
      basic: sectionSchema(looseObject()),
      quote: sectionSchema({ anyOf: [barSchema(), { type: 'null' }] }),
      history: sectionSchema(arraySchema(barSchema(), 2_500)),
      valuation: sectionSchema(arraySchema(looseObject(), 2_500)),
      constituents: sectionSchema(looseObject()),
      units: looseObject(),
    },
    ['meta', 'basic', 'quote', 'history', 'valuation', 'constituents', 'units'],
  )
}

function fundOutputSchema(): JsonSchema {
  return objectSchema(
    {
      meta: objectSchema(
        {
          fundCode: { type: 'string' },
          name: nullableString,
          requestedAsOfDate: nullableDate,
          dataThroughBySection: nullableStringMap(FUND_RESEARCH_SECTIONS),
          coverageStartBySection: nullableStringMap(FUND_RESEARCH_SECTIONS),
          seriesStatsBySection: objectSchema(
            Object.fromEntries(
              FUND_RESEARCH_SECTIONS.map((section) => [
                section,
                {
                  anyOf: [
                    { type: 'null' },
                    objectSchema(
                      {
                        total: { type: 'integer', minimum: 0 },
                        returned: { type: 'integer', minimum: 0 },
                        sampling: { enum: ['NONE', 'EVEN_WITH_ENDPOINTS'] },
                        truncated: { type: 'boolean' },
                      },
                      ['total', 'returned', 'sampling', 'truncated'],
                    ),
                  ],
                },
              ]),
            ),
          ),
        },
        [
          'fundCode',
          'name',
          'requestedAsOfDate',
          'dataThroughBySection',
          'coverageStartBySection',
          'seriesStatsBySection',
        ],
      ),
      basic: sectionSchema(looseObject()),
      nav: sectionSchema(arraySchema(looseObject(), 1_000)),
      price: sectionSchema(arraySchema(looseObject(), 1_000)),
      share: sectionSchema(arraySchema(looseObject(), 1_000)),
      holdings: sectionSchema(arraySchema(looseObject(), 12)),
      etfFlow: sectionSchema(arraySchema(looseObject(), 1_000)),
      units: looseObject(),
    },
    ['meta', 'basic', 'nav', 'price', 'share', 'holdings', 'etfFlow', 'units'],
  )
}

function industryOutputSchema(): JsonSchema {
  return objectSchema(
    {
      meta: objectSchema(
        {
          classification: { const: 'THS' },
          requestedAsOfDate: nullableDate,
          dataThroughBySection: nullableStringMap(INDUSTRY_ROTATION_SECTIONS),
          algorithmVersion: { const: 'industry-rotation.v1' },
          primaryReturnPeriod: { type: 'integer' },
          rankingPopulation: { type: 'integer' },
        },
        [
          'classification',
          'requestedAsOfDate',
          'dataThroughBySection',
          'algorithmVersion',
          'primaryReturnPeriod',
          'rankingPopulation',
        ],
      ),
      returns: sectionSchema(arraySchema(looseObject(), 50)),
      momentum: sectionSchema(arraySchema(looseObject(), 50)),
      flow: sectionSchema(arraySchema(looseObject(), 50)),
      valuation: sectionSchema(arraySchema(looseObject(), 50)),
      heatmap: sectionSchema(arraySchema(looseObject(), 3_000)),
      detail: sectionSchema(arraySchema(looseObject(), 50)),
    },
    ['meta', 'returns', 'momentum', 'flow', 'valuation', 'heatmap', 'detail'],
  )
}

function factorInputSchema(): JsonSchema {
  return objectSchema(
    {
      analysis: { enum: [...FACTOR_ANALYSIS_TYPES] },
      factorNames: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
      },
      asOfDate: dateSchema,
      startDate: dateSchema,
      endDate: dateSchema,
      universe: { enum: [...FACTOR_UNIVERSES] },
      forwardDays: { type: 'integer', minimum: 1, maximum: 60 },
      icMethod: { enum: ['SPEARMAN', 'PEARSON'] },
      quantiles: { type: 'integer', minimum: 3, maximum: 10 },
      rebalanceDays: { type: 'integer', minimum: 1, maximum: 20 },
      decayPeriods: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'integer', minimum: 1, maximum: 60 },
      },
      bins: { type: 'integer', minimum: 10, maximum: 100 },
      page: { type: 'integer', minimum: 1, maximum: 1_000 },
      pageSize: { type: 'integer', minimum: 10, maximum: 200 },
    },
    ['analysis', 'factorNames'],
  )
}

function factorOutputSchema(): JsonSchema {
  return objectSchema(
    {
      analysis: { enum: [...FACTOR_ANALYSIS_TYPES] },
      factorDefinitions: arraySchema(looseObject(), 10),
      universe: { enum: [...FACTOR_UNIVERSES] },
      requestedAsOfDate: nullableDate,
      dataThrough: dateSchema,
      sampleCount: { type: 'integer', minimum: 0 },
      result: looseObject(),
      algorithmVersion: { type: 'string' },
    },
    [
      'analysis',
      'factorDefinitions',
      'universe',
      'requestedAsOfDate',
      'dataThrough',
      'sampleCount',
      'result',
      'algorithmVersion',
    ],
  )
}

function macroOutputSchema(): JsonSchema {
  return objectSchema(
    {
      requestedSeries: uniqueEnumArray(MACRO_SERIES, 4),
      dataThroughBySeries: nullableStringMap(MACRO_SERIES),
      coverageStartBySeries: nullableStringMap(MACRO_SERIES),
      latest: sectionSchema(objectSchema(Object.fromEntries(MACRO_SERIES.map((series) => [series, {}])))),
      history: sectionSchema(
        objectSchema(
          Object.fromEntries(MACRO_SERIES.map((series) => [series, { type: 'array', maxItems: 500, items: {} }])),
        ),
      ),
      unitsByField: {},
    },
    ['requestedSeries', 'dataThroughBySeries', 'coverageStartBySeries', 'latest', 'history', 'unitsByField'],
  )
}

function sectionDataThrough(data: unknown): string | undefined {
  const values = Object.values(
    (data as { meta?: { dataThroughBySection?: Record<string, string | null> } }).meta?.dataThroughBySection ?? {},
  )
  return maxString(values)
}

function maxString(values: Array<string | null>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
}

function sectionRows(data: unknown): number {
  const record = data as Record<string, unknown>
  return Object.values(record).reduce<number>((total, value) => {
    if (!value || typeof value !== 'object' || !('status' in value)) return total
    const section = value as { status: string; data: unknown }
    if (section.status !== 'OK') return total
    if (Array.isArray(section.data)) return total + section.data.length
    if (
      section.data &&
      typeof section.data === 'object' &&
      Array.isArray((section.data as { items?: unknown[] }).items)
    ) {
      return total + ((section.data as { items: unknown[] }).items.length || 1)
    }
    return total + 1
  }, 0)
}

function factorRows(data: unknown): number {
  const value = data as { analysis?: string; result?: Record<string, unknown> }
  if (value.analysis === 'VALUES') return ((value.result?.items as unknown[]) ?? []).length
  if (value.analysis === 'IC') return ((value.result?.series as unknown[]) ?? []).length
  if (value.analysis === 'QUANTILE') return ((value.result?.groups as unknown[]) ?? []).length
  if (value.analysis === 'DECAY') return ((value.result?.results as unknown[]) ?? []).length
  if (value.analysis === 'DISTRIBUTION') return ((value.result?.histogram as unknown[]) ?? []).length
  if (value.analysis === 'CORRELATION') return ((value.result?.matrix as unknown[]) ?? []).length
  return 0
}

function macroRows(data: unknown): number {
  const value = data as {
    history?: { status?: string; data?: Record<string, unknown[]> }
    latest?: { status?: string }
  }
  if (value.history?.status === 'OK') {
    return Object.values(value.history.data ?? {}).reduce((sum, rows) => sum + rows.length, 0)
  }
  return value.latest?.status === 'OK' ? 1 : 0
}
