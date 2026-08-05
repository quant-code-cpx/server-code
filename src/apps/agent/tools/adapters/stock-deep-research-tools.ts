import { UserRole } from '@prisma/client'
import {
  STOCK_CHIP_SECTIONS,
  StockChipToolFacade,
  type StockChipProfileInput,
} from 'src/apps/stock-deep-research/chip/stock-chip-tool.facade'
import {
  STOCK_EVENT_SECTIONS,
  StockEventToolFacade,
  type StockEventsInput,
} from 'src/apps/stock-deep-research/events/stock-event-tool.facade'
import {
  STOCK_MARGIN_SECTIONS,
  StockMarginToolFacade,
  type StockMarginHistoryInput,
} from 'src/apps/stock-deep-research/margin/stock-margin-tool.facade'
import {
  RELATIVE_STRENGTH_SECTIONS,
  RelativeStrengthToolFacade,
  type StockRelativeStrengthInput,
} from 'src/apps/stock-deep-research/relative-strength/relative-strength-tool.facade'
import {
  STOCK_SHAREHOLDER_SECTIONS,
  StockShareholderToolFacade,
  type StockShareholderProfileInput,
} from 'src/apps/stock-deep-research/shareholders/stock-shareholder-tool.facade'
import { StockDeepResearchToolError } from 'src/apps/stock-deep-research/stock-deep-research.types'
import type { AgentToolKey, JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'

export interface StockDeepResearchToolDependencies {
  chip: StockChipToolFacade
  margin: StockMarginToolFacade
  relativeStrength: RelativeStrengthToolFacade
  events: StockEventToolFacade
  shareholders: StockShareholderToolFacade
}

export function createStockDeepResearchToolDefinitions(
  dependencies: StockDeepResearchToolDependencies,
): readonly ToolDefinition[] {
  return Object.freeze([
    chipDefinition(dependencies.chip),
    marginDefinition(dependencies.margin),
    relativeStrengthDefinition(dependencies.relativeStrength),
    eventsDefinition(dependencies.events),
    shareholderDefinition(dependencies.shareholders),
  ])
}

function chipDefinition(facade: StockChipToolFacade): ToolDefinition {
  return readDefinition({
    key: 'get_stock_chip_profile',
    description:
      '查询单只 A 股真实筹码成本、获利盘、价位分布和历史。默认只读入库数据；只有 sourcePolicy=ALLOW_LOCAL_ESTIMATE 时才允许本地行情估算分布。',
    inputSchema: withStockAndAsOf({
      sections: uniqueEnumArray(STOCK_CHIP_SECTIONS, 3),
      historyTradeDays: { type: 'integer', minimum: 1, maximum: 500 },
      maxPriceBuckets: { type: 'integer', minimum: 20, maximum: 500 },
      sourcePolicy: { enum: ['STORED_ONLY', 'ALLOW_LOCAL_ESTIMATE'] },
    }),
    outputSchema: chipOutputSchema(),
    policy: policy(20_000, 1_000, 'MEDIUM'),
    sourceType: 'DATABASE',
    sourceServices: ['StockChipToolFacade', 'StockChipRepository'],
    sourceModels: ['CyqPerf', 'CyqChips', 'Daily'],
    execute: (input) => facade.getProfile(input as unknown as StockChipProfileInput),
    dataThrough: deepMetaDate,
    countRows: (data) => sectionRows(data, ['summary', 'distribution', 'history']),
  })
}

function marginDefinition(facade: StockMarginToolFacade): ToolDefinition {
  return readDefinition({
    key: 'get_stock_margin_history',
    description: '查询单只 A 股融资融券余额、实际观测日净买入、5/20 日变化和固定规则趋势，不触发在线同步。',
    inputSchema: withStockAndAsOf({
      sections: uniqueEnumArray(STOCK_MARGIN_SECTIONS, 2),
      lookbackTradeDays: { type: 'integer', minimum: 1, maximum: 500 },
    }),
    outputSchema: marginOutputSchema(),
    policy: policy(15_000, 500, 'MEDIUM'),
    sourceType: 'DATABASE',
    sourceServices: ['StockMarginToolFacade', 'StockMarginRepository'],
    sourceModels: ['MarginDetail', 'Daily', 'AdjFactor'],
    execute: (input) => facade.getHistory(input as unknown as StockMarginHistoryInput),
    dataThrough: deepMetaDate,
    algorithmVersion: 'margin-trend.v1',
    countRows: (data) => sectionRows(data, ['summary', 'history']),
  })
}

function relativeStrengthDefinition(facade: RelativeStrengthToolFacade): ToolDefinition {
  return readDefinition({
    key: 'get_stock_relative_strength',
    description:
      '计算单只 A 股相对本地指数基准的复合收益、超额收益、波动率、回撤、beta 和信息比率；使用共同交易日与本地前复权比例。',
    inputSchema: withStockAndAsOf({
      benchmarkCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|CSI)$' },
      lookbackTradeDays: { type: 'integer', minimum: 20, maximum: 1_250 },
      sections: uniqueEnumArray(RELATIVE_STRENGTH_SECTIONS, 2),
    }),
    outputSchema: relativeStrengthOutputSchema(),
    policy: policy(20_000, 1_250, 'HIGH'),
    sourceType: 'PROGRAM_CALCULATION',
    sourceServices: ['RelativeStrengthToolFacade', 'RelativeStrengthCalculationService', 'RelativeStrengthRepository'],
    sourceModels: ['Daily', 'AdjFactor', 'IndexDaily'],
    execute: (input) => facade.getRelativeStrength(input as unknown as StockRelativeStrengthInput),
    dataThrough: deepMetaDate,
    algorithmVersion: 'relative-strength.v1',
    countRows: (data) => sectionRows(data, ['summary', 'series']),
  })
}

function eventsDefinition(facade: StockEventToolFacade): ToolDefinition {
  return readDefinition({
    key: 'get_stock_events',
    description:
      '按点时可得规则查询单只 A 股业绩预告、财报披露、分红、回购、解禁、停复牌、龙虎榜和大宗交易，支持 366 天内分页。',
    inputSchema: withStock({
      sections: uniqueEnumArray(STOCK_EVENT_SECTIONS, 8),
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      asOfDate: { type: 'string', format: 'date' },
      page: { type: 'integer', minimum: 1, maximum: 100 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    }),
    outputSchema: eventsOutputSchema(),
    policy: policy(20_000, 100, 'MEDIUM'),
    sourceType: 'DATABASE',
    sourceServices: ['StockEventToolFacade', 'StockEventRepository'],
    sourceModels: [
      'Forecast',
      'DisclosureDate',
      'Dividend',
      'Repurchase',
      'ShareFloat',
      'SuspendD',
      'TopList',
      'BlockTrade',
    ],
    execute: (input) => facade.getEvents(input as unknown as StockEventsInput),
    dataThrough: deepMetaDate,
    countRows: (data) => (data as { items?: unknown[] }).items?.length ?? 0,
  })
}

function shareholderDefinition(facade: StockShareholderToolFacade): ToolDefinition {
  return readDefinition({
    key: 'get_stock_shareholder_profile',
    description:
      '查询单只 A 股在指定可得日已公告的股东人数、前十大股东、流通股东和增减持，并单独标记缺少公告日的质押现状。',
    inputSchema: withStockAndAsOf({
      sections: uniqueEnumArray(STOCK_SHAREHOLDER_SECTIONS, 5),
      periods: { type: 'integer', minimum: 1, maximum: 12 },
      tradeLimit: { type: 'integer', minimum: 1, maximum: 100 },
    }),
    outputSchema: shareholderOutputSchema(),
    policy: policy(20_000, 250, 'MEDIUM'),
    sourceType: 'DATABASE',
    sourceServices: ['StockShareholderToolFacade', 'StockShareholderRepository'],
    sourceModels: ['StkHolderNumber', 'Top10Holders', 'Top10FloatHolders', 'StkHolderTrade', 'PledgeStat'],
    execute: (input) => facade.getProfile(input as unknown as StockShareholderProfileInput),
    dataThrough: deepMetaDate,
    countRows: (data) => sectionRows(data, ['holderCount', 'top10', 'top10Float', 'trades', 'pledge']),
  })
}

interface ReadDefinitionOptions {
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

function readDefinition(options: ReadDefinitionOptions): ToolDefinition {
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
          tradeDate: dataThrough,
          dataVersion: `${options.key}.v1:${dataThrough ?? 'empty'}`,
          algorithmVersion: options.algorithmVersion,
          warnings: result.warnings as [],
          truncated: result.truncated,
        })
      } catch (error) {
        if (error instanceof StockDeepResearchToolError) {
          throw new ToolAdapterError(error.code, error.message, error.retryable)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', `${options.key} 暂时不可用`, true)
      }
    },
    countRows: options.countRows,
  }
}

function policy(timeoutMs: number, maxRows: number, costClass: 'MEDIUM' | 'HIGH'): ToolPolicyDefinition {
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

function withStock(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tsCode'],
    properties: { tsCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' }, ...properties },
  }
}

function withStockAndAsOf(properties: Record<string, JsonSchema>): JsonSchema {
  return withStock({ asOfDate: { type: 'string', format: 'date' }, ...properties })
}

function uniqueEnumArray(values: readonly string[], maximum: number): JsonSchema {
  return { type: 'array', minItems: 1, maxItems: maximum, uniqueItems: true, items: { enum: [...values] } }
}

const nullableNumber: JsonSchema = { type: ['number', 'null'] }
const nullableDate: JsonSchema = { type: ['string', 'null'], format: 'date' }
const nullableString: JsonSchema = { type: ['string', 'null'] }

function objectSchema(properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties }
}

function arraySchema(items: JsonSchema, maxItems: number): JsonSchema {
  return { type: 'array', maxItems, items }
}

function metaSchema(extra: Record<string, JsonSchema> = {}): JsonSchema {
  return objectSchema({
    tsCode: { type: 'string' },
    requestedAsOfDate: nullableDate,
    dataThrough: nullableDate,
    coverageStart: nullableDate,
    timezone: { const: 'Asia/Shanghai' },
    ...extra,
  })
}

function sectionSchema(data: JsonSchema): JsonSchema {
  return objectSchema({
    status: { enum: ['OK', 'NOT_REQUESTED', 'NOT_READY', 'ERROR'] },
    data: { anyOf: [data, { type: 'null' }] },
    error: {
      anyOf: [{ type: 'null' }, objectSchema({ code: { type: 'string' }, message: { type: 'string' } })],
    },
  })
}

function chipOutputSchema(): JsonSchema {
  const bucket = objectSchema({ price: { type: 'number' }, percent: nullableNumber })
  return objectSchema({
    meta: metaSchema(),
    summary: sectionSchema(
      objectSchema({
        tradeDate: { type: 'string', format: 'date' },
        currentPrice: nullableNumber,
        cost5Pct: nullableNumber,
        cost15Pct: nullableNumber,
        medianCost: nullableNumber,
        cost85Pct: nullableNumber,
        cost95Pct: nullableNumber,
        weightedAverageCost: nullableNumber,
        winnerRate: nullableNumber,
        source: { const: 'TUSHARE_CYQ_PERF' },
        isEstimated: { const: false },
      }),
    ),
    distribution: sectionSchema(
      objectSchema({
        tradeDate: { type: 'string', format: 'date' },
        totalBuckets: { type: 'integer', minimum: 0 },
        returnedBuckets: { type: 'integer', minimum: 0, maximum: 500 },
        sampling: { enum: ['NONE', 'WEIGHTED_BUCKET_MERGE'] },
        buckets: arraySchema(bucket, 500),
        source: { enum: ['TUSHARE_CYQ_CHIPS', 'LOCAL_OHLCV_ESTIMATE'] },
        isEstimated: { type: 'boolean' },
        algorithmVersion: nullableString,
      }),
    ),
    history: sectionSchema(
      arraySchema(
        objectSchema({
          tradeDate: { type: 'string', format: 'date' },
          medianCost: nullableNumber,
          weightedAverageCost: nullableNumber,
          winnerRate: nullableNumber,
        }),
        500,
      ),
    ),
  })
}

function marginOutputSchema(): JsonSchema {
  return objectSchema({
    meta: metaSchema({
      marketPriceDataThrough: nullableDate,
      lagVsStockTradingDays: { type: ['integer', 'null'], minimum: 0 },
      algorithmVersion: { const: 'margin-trend.v1' },
    }),
    summary: sectionSchema(
      objectSchema({
        latestFinancingBalance: nullableNumber,
        latestSecuritiesLendingBalance: nullableNumber,
        latestTotalBalance: nullableNumber,
        financingNetBuy5d: nullableNumber,
        financingNetBuy20d: nullableNumber,
        financingBalanceChange5dPct: nullableNumber,
        financingBalanceChange20dPct: nullableNumber,
        trend: { enum: ['UP', 'DOWN', 'STABLE', 'INSUFFICIENT_DATA'] },
      }),
    ),
    history: sectionSchema(
      arraySchema(
        objectSchema({
          tradeDate: { type: 'string', format: 'date' },
          financingBalance: nullableNumber,
          financingBuy: nullableNumber,
          financingRepay: nullableNumber,
          financingNetBuy: nullableNumber,
          lendingBalance: nullableNumber,
          lendingSellVolume: nullableNumber,
          lendingRepayVolume: nullableNumber,
          lendingRemainingVolume: nullableNumber,
          totalBalance: nullableNumber,
          qfqClose: nullableNumber,
        }),
        500,
      ),
    ),
    units: objectSchema({
      balances: { const: 'CNY' },
      volumes: { const: 'SHARE' },
      close: { const: 'CNY_PER_SHARE' },
      changes: { const: 'PERCENT' },
    }),
  })
}

function relativeStrengthOutputSchema(): JsonSchema {
  return objectSchema({
    meta: metaSchema({
      benchmarkCode: { type: 'string' },
      benchmarkName: nullableString,
      commonTradeDays: { type: 'integer', minimum: 2, maximum: 1_250 },
      adjustment: { const: 'QFQ_RATIO' },
      algorithmVersion: { const: 'relative-strength.v1' },
    }),
    summary: sectionSchema(
      objectSchema({
        stockTotalReturn: nullableNumber,
        benchmarkTotalReturn: nullableNumber,
        excessReturn: nullableNumber,
        excess20d: nullableNumber,
        annualizedVolatility: nullableNumber,
        maxDrawdown: nullableNumber,
        beta: nullableNumber,
        informationRatio: nullableNumber,
      }),
    ),
    series: sectionSchema(
      arraySchema(
        objectSchema({
          tradeDate: { type: 'string', format: 'date' },
          stockNormalizedNav: { type: 'number' },
          benchmarkNormalizedNav: { type: 'number' },
          stockCumulativeReturn: { type: 'number' },
          benchmarkCumulativeReturn: { type: 'number' },
          cumulativeExcessReturn: { type: 'number' },
        }),
        1_250,
      ),
    ),
  })
}

function eventsOutputSchema(): JsonSchema {
  return objectSchema({
    meta: metaSchema(),
    sections: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: { enum: [...STOCK_EVENT_SECTIONS] },
    },
    total: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1, maximum: 100 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    items: arraySchema(
      objectSchema({
        id: { type: 'string' },
        type: { enum: [...STOCK_EVENT_SECTIONS] },
        eventDate: { type: 'string', format: 'date' },
        knownAt: nullableDate,
        tsCode: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        status: nullableString,
        reportPeriod: nullableDate,
        values: {},
        sourceModel: { type: 'string' },
        pointInTimeVerified: { type: 'boolean' },
      }),
      100,
    ),
  })
}

function shareholderOutputSchema(): JsonSchema {
  const holder = objectSchema({
    holderName: { type: 'string', maxLength: 256 },
    holdAmount: nullableNumber,
    holdRatio: nullableNumber,
    holdFloatRatio: nullableNumber,
    holdChange: nullableNumber,
    holderType: nullableString,
  })
  const period = objectSchema({
    reportPeriod: { type: 'string', format: 'date' },
    latestAnnouncementAt: { type: 'string', format: 'date' },
    holders: arraySchema(holder, 10),
  })
  return objectSchema({
    meta: metaSchema(),
    holderCount: sectionSchema(
      arraySchema(
        objectSchema({
          reportPeriod: { type: 'string', format: 'date' },
          announcedAt: { type: 'string', format: 'date' },
          holderCount: { type: 'integer', minimum: 0 },
          changeFromPrevious: { type: ['integer', 'null'] },
          changePctFromPrevious: nullableNumber,
        }),
        12,
      ),
    ),
    top10: sectionSchema(arraySchema(period, 12)),
    top10Float: sectionSchema(arraySchema(period, 12)),
    trades: sectionSchema(
      arraySchema(
        objectSchema({
          announcedAt: { type: 'string', format: 'date' },
          holderName: { type: 'string', maxLength: 256 },
          holderType: { type: 'string', maxLength: 32 },
          direction: { enum: ['INCREASE', 'DECREASE'] },
          changeVolume: nullableNumber,
          changeRatio: nullableNumber,
          averagePrice: nullableNumber,
          beginDate: nullableDate,
          endDate: nullableDate,
        }),
        100,
      ),
    ),
    pledge: sectionSchema(
      arraySchema(
        objectSchema({
          reportPeriod: { type: 'string', format: 'date' },
          pledgeCount: { type: 'integer', minimum: 0 },
          pledgedShares: nullableNumber,
          totalShares: nullableNumber,
          pledgeRatio: nullableNumber,
          announcedAt: { type: 'null' },
          pointInTimeVerified: { const: false },
        }),
        12,
      ),
    ),
  })
}

function deepMetaDate(data: unknown): string | undefined {
  const meta = (data as { meta?: { dataThrough?: string | null } }).meta
  return meta?.dataThrough ?? undefined
}

function sectionRows(data: unknown, keys: readonly string[]): number {
  const record = data as Record<string, { status?: string; data?: unknown }>
  return keys.reduce((sum, key) => {
    const section = record[key]
    if (section?.status !== 'OK') return sum
    return sum + (Array.isArray(section.data) ? section.data.length : 1)
  }, 0)
}
