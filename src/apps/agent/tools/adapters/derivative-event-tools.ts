import { UserRole } from '@prisma/client'
import {
  CONVERTIBLE_BOND_OPERATIONS,
  CONVERTIBLE_BOND_STATUSES,
  ConvertibleBondToolFacade,
  type ConvertibleBondMarketInput,
} from 'src/apps/convertible-bond/convertible-bond-tool.facade'
import {
  EVENT_STUDY_ALGORITHM_VERSION,
  EVENT_STUDY_BENCHMARKS,
  EventStudyToolFacade,
  type EventStudyToolInput,
} from 'src/apps/event-study/event-study-tool.facade'
import { EventType } from 'src/apps/event-study/event-type.registry'
import { MarketMultiAssetToolError } from 'src/apps/market-multi-asset/market-multi-asset.types'
import {
  OPTION_EXCHANGES,
  OPTION_MARKET_OPERATIONS,
  OptionMarketToolFacade,
  type OptionMarketInput,
} from 'src/apps/option-market/option-market-tool.facade'
import type { AgentToolKey, JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'

export interface DerivativeEventToolDependencies {
  option: OptionMarketToolFacade
  convertibleBond: ConvertibleBondToolFacade
  eventStudy: EventStudyToolFacade
}

export function createDerivativeEventToolDefinitions(
  dependencies: DerivativeEventToolDependencies,
): readonly ToolDefinition[] {
  return Object.freeze([
    definition({
      key: 'get_option_market',
      description: '查询本地期权合约搜索、详情和日线历史；不提供未验证标的映射、期权链、IV 或 Greeks。',
      inputSchema: optionInputSchema(),
      outputSchema: operationOutputSchema(2_000),
      policy: readPolicy(20_000, 2_000, 'MEDIUM'),
      sourceType: 'DATABASE',
      sourceServices: ['OptionMarketToolFacade', 'OptionMarketRepository'],
      sourceModels: ['OptBasic', 'OptDaily'],
      execute: (input) => dependencies.option.getMarket(input as unknown as OptionMarketInput),
      dataThrough: (data) => (data as { dataThrough?: string }).dataThrough,
      countRows: operationRows,
    }),
    definition({
      key: 'get_convertible_bond_market',
      description: '查询本地可转债搜索、基本信息和逐债真实覆盖的日线历史；历史覆盖不足时显式告警。',
      inputSchema: convertibleBondInputSchema(),
      outputSchema: operationOutputSchema(2_000),
      policy: readPolicy(20_000, 2_000, 'MEDIUM'),
      sourceType: 'DATABASE',
      sourceServices: ['ConvertibleBondToolFacade', 'ConvertibleBondRepository'],
      sourceModels: ['CbBasic', 'CbDaily'],
      execute: (input) => dependencies.convertibleBond.getMarket(input as unknown as ConvertibleBondMarketInput),
      dataThrough: (data) => (data as { dataThrough?: string }).dataThrough,
      countRows: operationRows,
    }),
    definition({
      key: 'run_event_study',
      description: '按固定企业事件定义执行市场调整法事件研究，严格排除缺失窗口，不把缺失收益填零。',
      inputSchema: eventStudyInputSchema(),
      outputSchema: eventStudyOutputSchema(),
      policy: readPolicy(60_000, 5_000, 'HIGH'),
      sourceType: 'PROGRAM_CALCULATION',
      sourceServices: ['EventStudyToolFacade', 'EventStudyService', 'EventStudyToolRepository'],
      sourceModels: [
        'Forecast',
        'Dividend',
        'StkHolderTrade',
        'ShareFloat',
        'Repurchase',
        'FinaAudit',
        'DisclosureDate',
        'Daily',
        'IndexDaily',
        'TradeCal',
      ],
      execute: (input) => dependencies.eventStudy.run(input as unknown as EventStudyToolInput),
      dataThrough: (data) =>
        (data as { actualEventRange?: { endDate?: string | null } }).actualEventRange?.endDate ?? undefined,
      algorithmVersion: EVENT_STUDY_ALGORITHM_VERSION,
      countRows: eventStudyRows,
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

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties }
}

function optionInputSchema(): JsonSchema {
  return objectSchema(
    {
      operation: { enum: [...OPTION_MARKET_OPERATIONS] },
      optionCode: { type: 'string', minLength: 1, maxLength: 30, pattern: '^[A-Za-z0-9._-]+$' },
      nameQuery: { type: 'string', minLength: 2, maxLength: 64 },
      exchange: { enum: [...OPTION_EXCHANGES] },
      callPut: { enum: ['CALL', 'PUT'] },
      maturityFrom: dateSchema,
      maturityTo: dateSchema,
      listedOnly: { type: 'boolean' },
      asOfDate: dateSchema,
      startDate: dateSchema,
      endDate: dateSchema,
      page: { type: 'integer', minimum: 1, maximum: 10_000 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      maxSeriesPoints: { type: 'integer', minimum: 20, maximum: 1_000 },
    },
    ['operation'],
  )
}

function convertibleBondInputSchema(): JsonSchema {
  return objectSchema(
    {
      operation: { enum: [...CONVERTIBLE_BOND_OPERATIONS] },
      bondCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ)$' },
      stockCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
      status: { enum: [...CONVERTIBLE_BOND_STATUSES] },
      rating: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 8, pattern: '^[A-Za-z+-]+$' },
      },
      asOfDate: dateSchema,
      startDate: dateSchema,
      endDate: dateSchema,
      page: { type: 'integer', minimum: 1, maximum: 10_000 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      maxSeriesPoints: { type: 'integer', minimum: 20, maximum: 1_000 },
    },
    ['operation'],
  )
}

function eventStudyInputSchema(): JsonSchema {
  return objectSchema(
    {
      eventType: { enum: Object.values(EventType) },
      tsCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
      startDate: dateSchema,
      endDate: dateSchema,
      preTradeDays: { type: 'integer', minimum: 0, maximum: 20 },
      postTradeDays: { type: 'integer', minimum: 1, maximum: 60 },
      benchmarkCode: { enum: [...EVENT_STUDY_BENCHMARKS] },
      minSamples: { type: 'integer', minimum: 1, maximum: 100 },
      maxSamples: { type: 'integer', minimum: 10, maximum: 500 },
      includeTopSamples: { type: 'boolean' },
    },
    ['eventType'],
  )
}

function operationOutputSchema(maxRows: number): JsonSchema {
  return objectSchema({
    operation: { type: 'string' },
    asOfDate: dateSchema,
    total: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    items: { type: 'array', maxItems: 100, items: {} },
    contract: {},
    bond: {},
    optionCode: { type: 'string' },
    bondCode: { type: 'string' },
    requestedRange: {},
    coverageStart: { type: ['string', 'null'], format: 'date' },
    dataThrough: { type: ['string', 'null'], format: 'date' },
    totalPoints: { type: 'integer', minimum: 0 },
    returnedPoints: { type: 'integer', minimum: 0 },
    sampling: { enum: ['NONE', 'EVEN_WITH_ENDPOINTS'] },
    points: { type: 'array', maxItems: maxRows, items: {} },
  })
}

function eventStudyOutputSchema(): JsonSchema {
  return objectSchema(
    {
      eventType: { enum: Object.values(EventType) },
      eventLabel: { type: 'string' },
      requestedRange: {},
      actualEventRange: {},
      benchmarkCode: { enum: [...EVENT_STUDY_BENCHMARKS] },
      preTradeDays: { type: 'integer' },
      postTradeDays: { type: 'integer' },
      sampleCount: { type: 'integer', minimum: 0, maximum: 500 },
      excludedSampleCount: { type: 'integer', minimum: 0 },
      exclusionReasons: {},
      aarSeries: { type: 'array', maxItems: 81, items: {} },
      caarSeries: { type: 'array', maxItems: 81, items: {} },
      finalCar: {},
      topPositiveSamples: { anyOf: [{ type: 'null' }, { type: 'array', maxItems: 10, items: {} }] },
      topNegativeSamples: { anyOf: [{ type: 'null' }, { type: 'array', maxItems: 10, items: {} }] },
      algorithmVersion: { const: EVENT_STUDY_ALGORITHM_VERSION },
      eventDefinitionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
    [
      'eventType',
      'eventLabel',
      'requestedRange',
      'actualEventRange',
      'benchmarkCode',
      'preTradeDays',
      'postTradeDays',
      'sampleCount',
      'excludedSampleCount',
      'exclusionReasons',
      'aarSeries',
      'caarSeries',
      'finalCar',
      'topPositiveSamples',
      'topNegativeSamples',
      'algorithmVersion',
      'eventDefinitionHash',
    ],
  )
}

function operationRows(data: unknown): number {
  const value = data as { items?: unknown[]; points?: unknown[]; contract?: unknown; bond?: unknown }
  return value.items?.length ?? value.points?.length ?? (value.contract || value.bond ? 1 : 0)
}

function eventStudyRows(data: unknown): number {
  const value = data as {
    aarSeries?: unknown[]
    caarSeries?: unknown[]
    topPositiveSamples?: unknown[] | null
    topNegativeSamples?: unknown[] | null
  }
  return (
    (value.aarSeries?.length ?? 0) +
    (value.caarSeries?.length ?? 0) +
    (value.topPositiveSamples?.length ?? 0) +
    (value.topNegativeSamples?.length ?? 0)
  )
}
