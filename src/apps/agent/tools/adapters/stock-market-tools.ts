import { UserRole } from '@prisma/client'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import type { ToolResult, ToolWarning } from '../contracts/tool-result'
import type { ToolAccessContext } from '../tool-access-context'
import { hashStableJson } from '../tool-json'
import {
  SectorHistoryUnavailableError,
  SectorToolFacade,
  type SectorMembershipInput,
} from 'src/apps/industry/sector-tool.facade'
import { MarketToolFacade, type MarketSnapshotInput } from 'src/apps/market/market-tool.facade'
import {
  StockPriceDataQualityError,
  StockToolFacade,
  type ResolveSecurityInput,
  type StockOverviewInput,
  type StockPriceHistoryInput,
} from 'src/apps/stock/stock-tool.facade'
import {
  WatchlistToolFacade,
  WatchlistToolNotFoundError,
  type WatchlistToolInput,
} from 'src/apps/watchlist/watchlist-tool.facade'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import { MARKET_PRICE_DATA_CONTRACT_VERSION } from 'src/tushare/data-contract'

export interface StockMarketToolDependencies {
  stock: StockToolFacade
  market: MarketToolFacade
  sector: SectorToolFacade
  watchlist: WatchlistToolFacade
  config: IAgentToolsConfig
}

const PUBLIC_POLICY: ToolPolicyDefinition = {
  requiredRole: UserRole.USER,
  sideEffect: 'READ',
  requiresConfirmation: false,
  idempotent: true,
  timeoutMs: 15_000,
  maxAttempts: 2,
  maxRows: 5_000,
  costClass: 'MEDIUM',
  allowedDataScopes: ['PUBLIC_MARKET_DATA'],
}

const PRIVATE_POLICY: ToolPolicyDefinition = {
  ...PUBLIC_POLICY,
  timeoutMs: 10_000,
  maxRows: 200,
  costClass: 'LOW',
  allowedDataScopes: ['USER_PRIVATE'],
}

export function createStockMarketToolDefinitions(dependencies: StockMarketToolDependencies): readonly ToolDefinition[] {
  return Object.freeze([
    resolveSecurityDefinition(dependencies.stock),
    stockPriceHistoryDefinition(dependencies.stock, dependencies.config),
    stockOverviewDefinition(dependencies.stock),
    marketSnapshotDefinition(dependencies.market),
    sectorMembershipDefinition(dependencies.sector),
    userWatchlistDefinition(dependencies.watchlist),
  ])
}

function resolveSecurityDefinition(stock: StockToolFacade): ToolDefinition {
  return {
    key: 'resolve_security',
    version: 1,
    description: '按代码、名称或简称解析股票、指数、基金和期权，返回有界候选并标记歧义。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 64 },
        securityTypes: {
          type: 'array',
          maxItems: 4,
          uniqueItems: true,
          items: { enum: ['STOCK', 'INDEX', 'FUND', 'OPTION'] },
        },
        includeDelisted: { type: 'boolean', default: false },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'candidates', 'ambiguous'],
      properties: {
        query: { type: 'string' },
        candidates: {
          type: 'array',
          maxItems: 20,
          items: strictObject(
            {
              tsCode: { type: 'string' },
              name: nullableString(),
              securityType: { enum: ['STOCK', 'INDEX', 'FUND', 'OPTION'] },
              exchange: nullableString(),
              listStatus: nullableString(),
              listDate: nullableDate(),
              delistDate: nullableDate(),
              matchScore: { type: 'number', minimum: 0, maximum: 1 },
            },
            ['tsCode', 'name', 'securityType', 'exchange', 'listStatus', 'listDate', 'delistDate', 'matchScore'],
          ),
        },
        ambiguous: { type: 'boolean' },
      },
    },
    policy: { ...PUBLIC_POLICY, maxRows: 20, costClass: 'LOW' },
    execute: async (input, context) =>
      executeSafely(async () => {
        const command = input as unknown as ResolveSecurityInput
        if (!command.query.trim()) throw invalidArgument('query 不能为空')
        const value = await stock.resolveSecurity(command)
        return toolResult(context, input, 'resolve_security', value, {
          sourceServices: ['StockToolFacade'],
          sourceModels: value.sourceModels,
        })
      }),
    countRows: (data) => (data as { candidates: unknown[] }).candidates.length,
  }
}

function stockPriceHistoryDefinition(stock: StockToolFacade, config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'get_stock_price_history',
    version: 1,
    description: '读取股票日、周、月行情，限定日期、字段、行数和复权口径，按交易日升序返回。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode', 'startDate', 'endDate', 'frequency', 'adjustment'],
      properties: {
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        frequency: { enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
        adjustment: { enum: ['NONE', 'FORWARD', 'BACKWARD'] },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: {
            enum: [
              'open',
              'high',
              'low',
              'close',
              'preClose',
              'pctChange',
              'volume',
              'amount',
              'turnoverRate',
              'peTtm',
            ],
          },
        },
        limit: { type: 'integer', minimum: 1, maximum: 5_000, default: 1_000 },
      },
    },
    outputSchema: priceHistoryOutputSchema(),
    policy: { ...PUBLIC_POLICY, maxRows: config.priceMaxBars, costClass: 'HIGH', timeoutMs: 30_000 },
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<StockPriceHistoryInput, 'limit'> & { limit?: number }
        const limit = raw.limit ?? Math.min(1_000, config.priceMaxBars)
        if (raw.startDate > raw.endDate) throw invalidArgument('startDate 不能晚于 endDate')
        if (limit > config.priceMaxBars) throw invalidArgument('limit 超过服务端行情上限')
        const value = await stock.getPriceHistory({ ...raw, limit })
        if (value.data.bars.length === 0) throw new ToolAdapterError('DATA_NOT_FOUND', '请求区间无行情数据')
        return toolResult(context, input, 'get_stock_price_history', value.data, {
          sourceServices: ['StockToolFacade'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          adjustment: raw.adjustment,
          unit: '字段单位见 data.units',
          currency: 'CNY',
          dataVersion: `${MARKET_PRICE_DATA_CONTRACT_VERSION}:${raw.frequency}:${value.adjustmentFactorAsOf ?? 'none'}`,
          truncated: value.truncated,
        })
      }),
    countRows: (data) => (data as { bars: unknown[] }).bars.length,
  }
}

function stockOverviewDefinition(stock: StockToolFacade): ToolDefinition {
  return {
    key: 'get_stock_overview',
    version: 1,
    description: '批量读取股票基本信息、行情、估值、行业、股本和各数据截止日，支持历史时点。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCodes'],
      properties: {
        tsCodes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 12 },
        },
        asOfDate: { type: 'string', format: 'date' },
        sections: {
          type: 'array',
          maxItems: 6,
          uniqueItems: true,
          items: { enum: ['BASIC', 'QUOTE', 'VALUATION', 'INDUSTRY', 'SHARE_CAPITAL', 'DATA_DATES'] },
        },
      },
    },
    outputSchema: stockOverviewOutputSchema(),
    policy: { ...PUBLIC_POLICY, maxRows: 20 },
    execute: async (input, context) =>
      executeSafely(async () => {
        const value = await stock.getOverview(input as unknown as StockOverviewInput)
        return toolResult(context, input, 'get_stock_overview', value.data, {
          sourceServices: ['StockToolFacade'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          unit: '行情金额为千元，成交量为手，比例为百分数',
          currency: 'CNY',
          dataVersion: MARKET_PRICE_DATA_CONTRACT_VERSION,
        })
      }),
    countRows: (data) => (data as { items: unknown[] }).items.length,
  }
}

function marketSnapshotDefinition(market: MarketToolFacade): ToolDefinition {
  return {
    key: 'get_market_snapshot',
    version: 1,
    description: '读取指数、宽度、估值、情绪、资金、北向和板块排行，每个分区独立标记数据状态与截止日。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sections'],
      properties: {
        tradeDate: { type: 'string', format: 'date' },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          uniqueItems: true,
          items: {
            enum: [
              'INDEX_QUOTES',
              'BREADTH',
              'VALUATION',
              'SENTIMENT',
              'MONEY_FLOW',
              'HSGT',
              'SECTOR_RANKING',
              'DATA_DATES',
            ],
          },
        },
        sectorType: { enum: ['INDUSTRY', 'CONCEPT'] },
        topN: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
    outputSchema: marketSnapshotOutputSchema(),
    policy: { ...PUBLIC_POLICY, maxRows: 408, costClass: 'HIGH', timeoutMs: 30_000 },
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<MarketSnapshotInput, 'topN'> & { topN?: number }
        const value = await market.snapshot({ ...raw, topN: raw.topN ?? 10 })
        const failed = value.data.sections.filter((section) => section.status === 'ERROR')
        if (failed.length === value.data.sections.length) {
          throw new ToolAdapterError('UPSTREAM_FAILED', '市场快照全部分区暂时不可用', true)
        }
        const warnings: ToolWarning[] = failed.length
          ? [
              {
                code: 'PARTIAL_SECTION_FAILURE',
                message: '部分市场分区暂时不可用',
                affectedFields: failed.map((item) => item.section),
              },
            ]
          : []
        return toolResult(context, input, 'get_market_snapshot', value.data, {
          sourceServices: ['MarketToolFacade', 'MarketService'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          dataVersion: MARKET_SNAPSHOT_DATA_VERSION,
          warnings,
        })
      }),
    countRows: (data) =>
      (data as { sections: Array<{ rows: unknown[] }> }).sections.reduce(
        (total, section) => total + section.rows.length,
        0,
      ),
  }
}

const MARKET_SNAPSHOT_DATA_VERSION = 'market-snapshot-v1'

function sectorMembershipDefinition(sector: SectorToolFacade): ToolDefinition {
  return {
    key: 'get_sector_membership',
    version: 1,
    description: '查询证券所属板块或板块成员，支持申万行业、当前概念与指数快照。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { enum: ['SECTORS_FOR_SECURITY', 'MEMBERS_FOR_SECTOR'] },
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        sectorCode: { type: 'string', minLength: 1, maxLength: 40 },
        sectorType: { enum: ['INDUSTRY', 'CONCEPT', 'INDEX'] },
        effectiveDate: { type: 'string', format: 'date' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
      oneOf: [
        { required: ['tsCode'], properties: { tsCode: {} } },
        {
          required: ['sectorCode', 'sectorType'],
          properties: { sectorCode: {}, sectorType: {} },
        },
      ],
    },
    outputSchema: sectorMembershipOutputSchema(),
    policy: { ...PUBLIC_POLICY, maxRows: 500 },
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<SectorMembershipInput, 'limit'> & { limit?: number }
        assertSectorInput(raw)
        const value = await sector.membership({ ...raw, limit: raw.limit ?? 100 })
        const warnings = value.warningCodes.map((code) => ({
          code,
          message: 'THS 概念数据只代表当前成分，不提供历史有效期',
        }))
        return toolResult(context, input, 'get_sector_membership', value.data, {
          sourceServices: ['SectorToolFacade'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          dataVersion: 'sector-membership-v1',
          warnings,
          truncated: value.truncated,
        })
      }),
    countRows: (data) => (data as { items: unknown[] }).items.length,
  }
}

function userWatchlistDefinition(watchlist: WatchlistToolFacade): ToolDefinition {
  return {
    key: 'get_user_watchlist',
    version: 1,
    description: '读取当前登录用户全部或单个自选组，可选最新行情；用户身份只能来自执行上下文。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        watchlistId: { type: 'integer', minimum: 1 },
        includeLatestQuote: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
    },
    outputSchema: watchlistOutputSchema(),
    policy: PRIVATE_POLICY,
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<WatchlistToolInput, 'limit'> & { limit?: number }
        const value = await watchlist.read(context.userId, { ...raw, limit: raw.limit ?? 100 })
        return toolResult(context, input, 'get_user_watchlist', value.data, {
          sourceServices: ['WatchlistToolFacade'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          unit: raw.includeLatestQuote ? '行情金额为千元，成交量为手，比例为百分数' : undefined,
          currency: raw.includeLatestQuote ? 'CNY' : undefined,
          dataVersion: 'watchlist-owner-scoped-v1',
          truncated: value.truncated,
        })
      }),
    countRows: (data) =>
      (data as { groups: Array<{ members: unknown[] }> }).groups.reduce(
        (total, group) => total + group.members.length,
        0,
      ),
  }
}

interface ToolResultOptions {
  sourceServices: string[]
  sourceModels: string[]
  tradeDate?: string | null
  unit?: string
  currency?: string
  adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD'
  dataVersion?: string
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
      sourceType: 'DATABASE',
      sourceServices: options.sourceServices,
      sourceModels: options.sourceModels,
      asOf: {
        ...(options.tradeDate ? { tradeDate: options.tradeDate } : {}),
        retrievedAt: new Date().toISOString(),
      },
      timezone: 'Asia/Shanghai',
      ...(options.unit ? { unit: options.unit } : {}),
      ...(options.currency ? { currency: options.currency } : {}),
      ...(options.adjustment ? { adjustment: options.adjustment } : {}),
      ...(options.dataVersion ? { dataVersion: options.dataVersion } : {}),
      inputHash: hashStableJson(input),
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
    if (error instanceof StockPriceDataQualityError || error instanceof SectorHistoryUnavailableError) {
      throw new ToolAdapterError('DATA_QUALITY_FAILED', error.message)
    }
    if (error instanceof WatchlistToolNotFoundError) {
      throw new ToolAdapterError('DATA_NOT_FOUND', '自选组不存在')
    }
    throw new ToolAdapterError('UPSTREAM_FAILED', '金融数据查询暂时不可用', true)
  }
}

function invalidArgument(message: string): ToolAdapterError {
  return new ToolAdapterError('INVALID_ARGUMENT', message)
}

function assertSectorInput(input: Omit<SectorMembershipInput, 'limit'> & { limit?: number }): void {
  if (input.mode === 'SECTORS_FOR_SECURITY') {
    if (!input.tsCode || input.sectorCode) throw invalidArgument('证券查板块参数组合非法')
    return
  }
  if (!input.sectorCode || !input.sectorType || input.tsCode) throw invalidArgument('板块查成员参数组合非法')
}

function priceHistoryOutputSchema(): JsonSchema {
  const barProperties: Record<string, JsonSchema> = { tradeDate: { type: 'string', format: 'date' } }
  for (const field of [
    'open',
    'high',
    'low',
    'close',
    'preClose',
    'pctChange',
    'volume',
    'amount',
    'turnoverRate',
    'peTtm',
  ]) {
    barProperties[field] = nullableNumber()
  }
  return strictObject(
    {
      tsCode: { type: 'string' },
      frequency: { enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
      adjustment: { enum: ['NONE', 'FORWARD', 'BACKWARD'] },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      fields: { type: 'array', items: { type: 'string' } },
      units: strictObject(
        {
          price: { const: 'CNY' },
          pctChange: { const: 'PERCENT' },
          volume: { const: 'LOT' },
          amount: { const: 'CNY_THOUSAND' },
          turnoverRate: { const: 'PERCENT' },
          peTtm: { const: 'MULTIPLE' },
        },
        ['price', 'pctChange', 'volume', 'amount', 'turnoverRate', 'peTtm'],
      ),
      bars: { type: 'array', maxItems: 5_000, items: strictObject(barProperties, ['tradeDate']) },
    },
    ['tsCode', 'frequency', 'adjustment', 'startDate', 'endDate', 'fields', 'units', 'bars'],
  )
}

function stockOverviewOutputSchema(): JsonSchema {
  const basic = nullableObject(
    {
      symbol: nullableString(),
      name: nullableString(),
      exchange: nullableString(),
      market: nullableString(),
      area: nullableString(),
      industry: nullableString(),
      listStatus: nullableString(),
      listDate: nullableDate(),
      delistDate: nullableDate(),
    },
    ['symbol', 'name', 'exchange', 'market', 'area', 'industry', 'listStatus', 'listDate', 'delistDate'],
  )
  const quote = nullableObject(
    {
      tradeDate: nullableDate(),
      open: nullableNumber(),
      high: nullableNumber(),
      low: nullableNumber(),
      close: nullableNumber(),
      preClose: nullableNumber(),
      pctChange: nullableNumber(),
      volume: nullableNumber(),
      amount: nullableNumber(),
    },
    ['tradeDate', 'open', 'high', 'low', 'close', 'preClose', 'pctChange', 'volume', 'amount'],
  )
  const valuation = nullableObject(
    {
      tradeDate: nullableDate(),
      turnoverRate: nullableNumber(),
      pe: nullableNumber(),
      peTtm: nullableNumber(),
      pb: nullableNumber(),
      psTtm: nullableNumber(),
      dividendYieldTtm: nullableNumber(),
      totalMarketValue: nullableNumber(),
      circulatingMarketValue: nullableNumber(),
    },
    [
      'tradeDate',
      'turnoverRate',
      'pe',
      'peTtm',
      'pb',
      'psTtm',
      'dividendYieldTtm',
      'totalMarketValue',
      'circulatingMarketValue',
    ],
  )
  const industry = nullableObject(
    {
      level1Code: { type: 'string' },
      level1Name: { type: 'string' },
      level2Code: { type: 'string' },
      level2Name: { type: 'string' },
      level3Code: { type: 'string' },
      level3Name: { type: 'string' },
      inDate: nullableDate(),
      outDate: nullableDate(),
    },
    ['level1Code', 'level1Name', 'level2Code', 'level2Name', 'level3Code', 'level3Name', 'inDate', 'outDate'],
  )
  const shareCapital = nullableObject(
    {
      tradeDate: nullableDate(),
      totalShares: nullableNumber(),
      floatShares: nullableNumber(),
      freeFloatShares: nullableNumber(),
    },
    ['tradeDate', 'totalShares', 'floatShares', 'freeFloatShares'],
  )
  return strictObject(
    {
      requestedAsOfDate: nullableDate(),
      sections: { type: 'array', items: { type: 'string' } },
      items: {
        type: 'array',
        maxItems: 20,
        items: strictObject(
          {
            tsCode: { type: 'string' },
            found: { type: 'boolean' },
            basic,
            quote,
            valuation,
            industry,
            shareCapital,
            dataDates: strictObject({ quote: nullableDate(), valuation: nullableDate() }, ['quote', 'valuation']),
          },
          ['tsCode', 'found'],
        ),
      },
    },
    ['requestedAsOfDate', 'sections', 'items'],
  )
}

function marketSnapshotOutputSchema(): JsonSchema {
  const metric = strictObject(
    { key: { type: 'string' }, value: { type: ['string', 'number', 'boolean', 'null'] }, unit: nullableString() },
    ['key', 'value', 'unit'],
  )
  const row = strictObject(
    {
      key: { type: 'string' },
      name: nullableString(),
      category: nullableString(),
      metrics: { type: 'array', items: metric },
    },
    ['key', 'name', 'category', 'metrics'],
  )
  const section = strictObject(
    {
      section: {
        enum: [
          'INDEX_QUOTES',
          'BREADTH',
          'VALUATION',
          'SENTIMENT',
          'MONEY_FLOW',
          'HSGT',
          'SECTOR_RANKING',
          'DATA_DATES',
        ],
      },
      status: { enum: ['OK', 'MISSING', 'ERROR'] },
      asOf: nullableDate(),
      facts: { type: 'array', items: metric },
      rows: { type: 'array', items: row },
      warning: nullableString(),
    },
    ['section', 'status', 'asOf', 'facts', 'rows', 'warning'],
  )
  return strictObject(
    {
      requestedTradeDate: nullableDate(),
      sectorType: { enum: ['INDUSTRY', 'CONCEPT'] },
      topN: { type: 'integer' },
      sections: { type: 'array', maxItems: 8, items: section },
    },
    ['requestedTradeDate', 'sectorType', 'topN', 'sections'],
  )
}

function sectorMembershipOutputSchema(): JsonSchema {
  const item = strictObject(
    {
      tsCode: { type: 'string' },
      name: nullableString(),
      sectorCode: { type: 'string' },
      sectorName: nullableString(),
      sectorType: { enum: ['INDUSTRY', 'CONCEPT', 'INDEX'] },
      level: nullableString(),
      weight: nullableNumber(),
      inDate: nullableDate(),
      outDate: nullableDate(),
    },
    ['tsCode', 'name', 'sectorCode', 'sectorName', 'sectorType', 'level', 'weight', 'inDate', 'outDate'],
  )
  return strictObject(
    {
      mode: { enum: ['SECTORS_FOR_SECURITY', 'MEMBERS_FOR_SECTOR'] },
      tsCode: nullableString(),
      sectorCode: nullableString(),
      sectorType: { type: ['string', 'null'], enum: ['INDUSTRY', 'CONCEPT', 'INDEX', null] },
      effectiveDate: nullableDate(),
      items: { type: 'array', maxItems: 500, items: item },
    },
    ['mode', 'tsCode', 'sectorCode', 'sectorType', 'effectiveDate', 'items'],
  )
}

function watchlistOutputSchema(): JsonSchema {
  const quote = nullableObject(
    {
      tradeDate: { type: 'string', format: 'date' },
      close: nullableNumber(),
      pctChange: nullableNumber(),
      volume: nullableNumber(),
      amount: nullableNumber(),
    },
    ['tradeDate', 'close', 'pctChange', 'volume', 'amount'],
  )
  const member = strictObject(
    {
      id: { type: 'integer' },
      tsCode: { type: 'string' },
      name: nullableString(),
      notes: nullableString(),
      tags: { type: 'array', items: { type: 'string' } },
      targetPrice: nullableNumber(),
      sortOrder: { type: 'integer' },
      addedAt: { type: 'string', format: 'date-time' },
      latestQuote: quote,
    },
    ['id', 'tsCode', 'name', 'notes', 'tags', 'targetPrice', 'sortOrder', 'addedAt'],
  )
  const group = strictObject(
    {
      id: { type: 'integer' },
      name: { type: 'string' },
      description: nullableString(),
      isDefault: { type: 'boolean' },
      sortOrder: { type: 'integer' },
      totalMembers: { type: 'integer' },
      members: { type: 'array', items: member },
    },
    ['id', 'name', 'description', 'isDefault', 'sortOrder', 'totalMembers', 'members'],
  )
  return strictObject(
    {
      requestedWatchlistId: { type: ['integer', 'null'] },
      includeLatestQuote: { type: 'boolean' },
      groups: { type: 'array', items: group },
    },
    ['requestedWatchlistId', 'includeLatestQuote', 'groups'],
  )
}

function strictObject(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, ...(required.length ? { required } : {}), properties }
}

function nullableObject(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: ['object', 'null'], additionalProperties: false, required, properties }
}

function nullableString(): JsonSchema {
  return { type: ['string', 'null'] }
}

function nullableNumber(): JsonSchema {
  return { type: ['number', 'null'] }
}

function nullableDate(): JsonSchema {
  return { type: ['string', 'null'], format: 'date' }
}
