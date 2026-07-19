import { AgentProtocolError, JsonSchema, assertJsonSchema } from './runtime-schema'

export const SOURCE_TYPES = [
  'DATABASE',
  'PROGRAM_CALCULATION',
  'OFFICIAL',
  'MEDIA',
  'INSTITUTION',
  'MODEL_INFERENCE',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const VALUE_SCALES = ['PERCENT', 'DECIMAL'] as const
export type ValueScale = (typeof VALUE_SCALES)[number]

export const PRICE_ADJUSTMENTS = ['NONE', 'FORWARD', 'BACKWARD'] as const
export type PriceAdjustment = (typeof PRICE_ADJUSTMENTS)[number]

export interface DataProvenance {
  sourceType: SourceType
  citationIds: string[]
  asOf: {
    tradeDate?: string
    reportPeriod?: string
    announcementDate?: string
    availableAt?: string
    retrievedAt: string
  }
  timezone: string
  currency?: string
  unit?: string
  scale?: ValueScale
  adjustment?: PriceAdjustment
  dataVersion?: string
  algorithmVersion?: string
  qualityFlags?: string[]
}

export interface BlockBase {
  blockId: string
  schemaVersion: 1
  title?: string
  provenance?: DataProvenance
}

export interface MarkdownBlock extends BlockBase {
  type: 'MARKDOWN'
  text: string
}

export interface TableColumn {
  key: string
  label: string
  valueType: 'STRING' | 'NUMBER' | 'DATE' | 'DATETIME' | 'BOOLEAN'
  unit?: string
  scale?: ValueScale
  align?: 'LEFT' | 'RIGHT' | 'CENTER'
}

export type TableCell = string | number | boolean | null

export interface TableBlock extends BlockBase {
  type: 'TABLE'
  columns: TableColumn[]
  rows: Array<Record<string, TableCell>>
  rowKey: string
  truncated: boolean
  totalRows?: number
  provenance: DataProvenance
}

export interface ChartPoint {
  x: string | number
  y: number | null
}

export interface ChartSeries {
  key: string
  name: string
  points: ChartPoint[]
  unit?: string
  scale?: ValueScale
}

export interface ChartBlock extends BlockBase {
  type: 'CHART'
  chart: 'LINE' | 'BAR' | 'AREA' | 'HEATMAP'
  xAxisType: 'CATEGORY' | 'DATETIME' | 'NUMBER'
  series: ChartSeries[]
  provenance: DataProvenance
}

export interface KlineBar {
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  amount: number | null
}

export interface KlineBlock extends BlockBase {
  type: 'KLINE'
  tsCode: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  adjustment: PriceAdjustment
  priceUnit: string
  volumeUnit: string
  amountUnit: string
  bars: KlineBar[]
  provenance: DataProvenance
}

export interface FinancialMetricValue {
  key: string
  label: string
  value: number | null
  unit?: string
  scale?: ValueScale
}

export interface FinancialMetricPeriod {
  reportPeriod: string
  announcementDate?: string
  availableAt?: string
  reportType?: string
  metrics: FinancialMetricValue[]
}

export interface FinancialMetricsBlock extends BlockBase {
  type: 'FINANCIAL_METRICS'
  tsCode: string
  periods: FinancialMetricPeriod[]
  provenance: DataProvenance
}

export interface RiskNoticeBlock extends BlockBase {
  type: 'RISK_NOTICE'
  level: 'INFO' | 'WARNING' | 'CRITICAL'
  code: string
  text: string
  relatedBlockIds?: string[]
  provenance: DataProvenance
}

export type MessageBlock =
  | MarkdownBlock
  | TableBlock
  | ChartBlock
  | KlineBlock
  | FinancialMetricsBlock
  | RiskNoticeBlock

export interface Citation {
  citationId: string
  sourceId: string
  sourceType: SourceType
  title: string
  canonicalUrl?: string
  publisher?: string
  publishedAt?: string
  retrievedAt: string
  locator: {
    factId?: string
    section?: string
    paragraph?: number
    startOffset?: number
    endOffset?: number
  }
  contentHash: string
}

const isoDateSchema: JsonSchema = { type: 'string', format: 'date' }
const dateTimeSchema: JsonSchema = { type: 'string', format: 'date-time' }
const nullableNumberSchema: JsonSchema = { type: ['number', 'null'] }
const safeKeySchema: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^(?!(?:__proto__|prototype|constructor)$).+$',
}

export const DATA_PROVENANCE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceType', 'citationIds', 'asOf', 'timezone'],
  properties: {
    sourceType: { enum: [...SOURCE_TYPES] },
    citationIds: { type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 128 } },
    asOf: {
      type: 'object',
      additionalProperties: false,
      required: ['retrievedAt'],
      properties: {
        tradeDate: isoDateSchema,
        reportPeriod: isoDateSchema,
        announcementDate: isoDateSchema,
        availableAt: dateTimeSchema,
        retrievedAt: dateTimeSchema,
      },
    },
    timezone: { type: 'string', minLength: 1, maxLength: 64 },
    currency: { type: 'string', minLength: 1, maxLength: 16 },
    unit: { type: 'string', minLength: 1, maxLength: 32 },
    scale: { enum: [...VALUE_SCALES] },
    adjustment: { enum: [...PRICE_ADJUSTMENTS] },
    dataVersion: { type: 'string', minLength: 1, maxLength: 128 },
    algorithmVersion: { type: 'string', minLength: 1, maxLength: 128 },
    qualityFlags: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 128 } },
  },
}

const blockBaseProperties = {
  blockId: { type: 'string', minLength: 1, maxLength: 128 },
  schemaVersion: { const: 1 },
  title: { type: 'string', minLength: 1, maxLength: 500 },
  provenance: DATA_PROVENANCE_SCHEMA,
}

const markdownBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId', 'schemaVersion', 'type', 'text'],
  properties: {
    ...blockBaseProperties,
    type: { const: 'MARKDOWN' },
    text: { type: 'string', maxLength: 200_000 },
  },
}

const tableBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId', 'schemaVersion', 'type', 'columns', 'rows', 'rowKey', 'truncated', 'provenance'],
  properties: {
    ...blockBaseProperties,
    type: { const: 'TABLE' },
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'valueType'],
        properties: {
          key: safeKeySchema,
          label: { type: 'string', minLength: 1, maxLength: 200 },
          valueType: { enum: ['STRING', 'NUMBER', 'DATE', 'DATETIME', 'BOOLEAN'] },
          unit: { type: 'string', minLength: 1, maxLength: 32 },
          scale: { enum: [...VALUE_SCALES] },
          align: { enum: ['LEFT', 'RIGHT', 'CENTER'] },
        },
      },
    },
    rows: {
      type: 'array',
      maxItems: 500,
      items: { type: 'object' },
    },
    rowKey: safeKeySchema,
    truncated: { type: 'boolean' },
    totalRows: { type: 'integer', minimum: 0 },
  },
}

const chartBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId', 'schemaVersion', 'type', 'chart', 'xAxisType', 'series', 'provenance'],
  properties: {
    ...blockBaseProperties,
    type: { const: 'CHART' },
    chart: { enum: ['LINE', 'BAR', 'AREA', 'HEATMAP'] },
    xAxisType: { enum: ['CATEGORY', 'DATETIME', 'NUMBER'] },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name', 'points'],
        properties: {
          key: safeKeySchema,
          name: { type: 'string', minLength: 1, maxLength: 200 },
          points: {
            type: 'array',
            maxItems: 2000,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['x', 'y'],
              properties: {
                x: { type: ['string', 'number'] },
                y: nullableNumberSchema,
              },
            },
          },
          unit: { type: 'string', minLength: 1, maxLength: 32 },
          scale: { enum: [...VALUE_SCALES] },
        },
      },
    },
  },
}

const klineBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'blockId',
    'schemaVersion',
    'type',
    'tsCode',
    'frequency',
    'adjustment',
    'priceUnit',
    'volumeUnit',
    'amountUnit',
    'bars',
    'provenance',
  ],
  properties: {
    ...blockBaseProperties,
    type: { const: 'KLINE' },
    tsCode: { type: 'string', pattern: '^[0-9A-Z]{5,8}\\.(SH|SZ|BJ|HK)$', maxLength: 12 },
    frequency: { enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
    adjustment: { enum: [...PRICE_ADJUSTMENTS] },
    priceUnit: { type: 'string', minLength: 1, maxLength: 32 },
    volumeUnit: { type: 'string', minLength: 1, maxLength: 32 },
    amountUnit: { type: 'string', minLength: 1, maxLength: 32 },
    bars: {
      type: 'array',
      maxItems: 5000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tradeDate', 'open', 'high', 'low', 'close', 'volume', 'amount'],
        properties: {
          tradeDate: isoDateSchema,
          open: nullableNumberSchema,
          high: nullableNumberSchema,
          low: nullableNumberSchema,
          close: nullableNumberSchema,
          volume: nullableNumberSchema,
          amount: nullableNumberSchema,
        },
      },
    },
  },
}

const financialMetricsBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId', 'schemaVersion', 'type', 'tsCode', 'periods', 'provenance'],
  properties: {
    ...blockBaseProperties,
    type: { const: 'FINANCIAL_METRICS' },
    tsCode: { type: 'string', pattern: '^[0-9A-Z]{5,8}\\.(SH|SZ|BJ|HK)$', maxLength: 12 },
    periods: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reportPeriod', 'metrics'],
        properties: {
          reportPeriod: isoDateSchema,
          announcementDate: isoDateSchema,
          availableAt: dateTimeSchema,
          reportType: { type: 'string', minLength: 1, maxLength: 64 },
          metrics: {
            type: 'array',
            maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'label', 'value'],
              properties: {
                key: safeKeySchema,
                label: { type: 'string', minLength: 1, maxLength: 200 },
                value: nullableNumberSchema,
                unit: { type: 'string', minLength: 1, maxLength: 32 },
                scale: { enum: [...VALUE_SCALES] },
              },
            },
          },
        },
      },
    },
  },
}

const riskNoticeBlockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['blockId', 'schemaVersion', 'type', 'level', 'code', 'text', 'provenance'],
  properties: {
    ...blockBaseProperties,
    type: { const: 'RISK_NOTICE' },
    level: { enum: ['INFO', 'WARNING', 'CRITICAL'] },
    code: { type: 'string', minLength: 1, maxLength: 128 },
    text: { type: 'string', minLength: 1, maxLength: 10_000 },
    relatedBlockIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 128 } },
  },
}

export const MESSAGE_BLOCK_SCHEMA: JsonSchema = {
  oneOf: [
    markdownBlockSchema,
    tableBlockSchema,
    chartBlockSchema,
    klineBlockSchema,
    financialMetricsBlockSchema,
    riskNoticeBlockSchema,
  ],
}

export const CITATION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['citationId', 'sourceId', 'sourceType', 'title', 'retrievedAt', 'locator', 'contentHash'],
  properties: {
    citationId: { type: 'string', minLength: 1, maxLength: 128 },
    sourceId: { type: 'string', minLength: 1, maxLength: 128 },
    sourceType: { enum: [...SOURCE_TYPES] },
    title: { type: 'string', minLength: 1, maxLength: 1000 },
    canonicalUrl: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^https://' },
    publisher: { type: 'string', minLength: 1, maxLength: 500 },
    publishedAt: dateTimeSchema,
    retrievedAt: dateTimeSchema,
    locator: {
      type: 'object',
      additionalProperties: false,
      properties: {
        factId: { type: 'string', minLength: 1, maxLength: 128 },
        section: { type: 'string', minLength: 1, maxLength: 500 },
        paragraph: { type: 'integer', minimum: 0 },
        startOffset: { type: 'integer', minimum: 0 },
        endOffset: { type: 'integer', minimum: 0 },
      },
    },
    contentHash: { type: 'string', minLength: 16, maxLength: 128 },
  },
}

function validateTableRows(block: TableBlock): void {
  const columnKeys = new Set(block.columns.map((column) => column.key))
  if (!columnKeys.has(block.rowKey)) throw new AgentProtocolError(['MessageBlock.rowKey 必须对应列 key'])

  for (const [rowIndex, row] of block.rows.entries()) {
    if (!Object.prototype.hasOwnProperty.call(row, block.rowKey)) {
      throw new AgentProtocolError([`MessageBlock.rows[${rowIndex}] 缺少 rowKey`])
    }
    for (const [key, value] of Object.entries(row)) {
      if (!columnKeys.has(key)) throw new AgentProtocolError([`MessageBlock.rows[${rowIndex}].${key} 未声明列`])
      if (typeof value === 'string' && value.length > 2000) {
        throw new AgentProtocolError([`MessageBlock.rows[${rowIndex}].${key} 字符串超过 2000`])
      }
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new AgentProtocolError([`MessageBlock.rows[${rowIndex}].${key} 单元格类型不合法`])
      }
    }
  }
}

function validateKline(block: KlineBlock): void {
  let previousTradeDate = ''
  for (const [index, bar] of block.bars.entries()) {
    if (bar.tradeDate < previousTradeDate) throw new AgentProtocolError(['MessageBlock.bars 必须按 tradeDate 升序'])
    previousTradeDate = bar.tradeDate

    const prices = [bar.open, bar.close].filter((value): value is number => value !== null)
    if (bar.high !== null && prices.length > 0 && bar.high < Math.max(...prices)) {
      throw new AgentProtocolError([`MessageBlock.bars[${index}].high 小于 open/close`])
    }
    if (bar.low !== null && prices.length > 0 && bar.low > Math.min(...prices)) {
      throw new AgentProtocolError([`MessageBlock.bars[${index}].low 大于 open/close`])
    }
  }
}

export function parseMessageBlock(input: unknown): MessageBlock {
  const block = assertJsonSchema<MessageBlock>(MESSAGE_BLOCK_SCHEMA, input, 'MessageBlock')
  if (block.type === 'MARKDOWN' && /<\/?[A-Za-z][^>]*>/.test(block.text)) {
    throw new AgentProtocolError(['MessageBlock.text 禁止 raw HTML'])
  }
  if (block.type === 'TABLE') validateTableRows(block)
  if (block.type === 'KLINE') validateKline(block)
  return block
}

export function isSupportedMessageBlock(input: unknown): input is MessageBlock {
  try {
    parseMessageBlock(input)
    return true
  } catch {
    return false
  }
}

export function parseDataProvenance(input: unknown): DataProvenance {
  return assertJsonSchema<DataProvenance>(DATA_PROVENANCE_SCHEMA, input, 'DataProvenance')
}

export function parseCitation(input: unknown): Citation {
  return assertJsonSchema<Citation>(CITATION_SCHEMA, input, 'Citation')
}

const fixtureProvenance: DataProvenance = {
  sourceType: 'DATABASE',
  citationIds: ['citation_fixture'],
  asOf: { tradeDate: '2026-07-17', retrievedAt: '2026-07-19T02:11:31.102Z' },
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  unit: '元',
}

export const MESSAGE_BLOCK_FIXTURES: MessageBlock[] = [
  { blockId: 'markdown_fixture', schemaVersion: 1, type: 'MARKDOWN', text: '研究结论' },
  {
    blockId: 'table_fixture',
    schemaVersion: 1,
    type: 'TABLE',
    columns: [{ key: 'tsCode', label: '证券代码', valueType: 'STRING' }],
    rows: [{ tsCode: '600519.SH' }],
    rowKey: 'tsCode',
    truncated: false,
    totalRows: 1,
    provenance: fixtureProvenance,
  },
  {
    blockId: 'chart_fixture',
    schemaVersion: 1,
    type: 'CHART',
    chart: 'LINE',
    xAxisType: 'DATETIME',
    series: [{ key: 'close', name: '收盘价', points: [{ x: '2026-07-17', y: 1500 }] }],
    provenance: fixtureProvenance,
  },
  {
    blockId: 'kline_fixture',
    schemaVersion: 1,
    type: 'KLINE',
    tsCode: '600519.SH',
    frequency: 'DAILY',
    adjustment: 'FORWARD',
    priceUnit: '元',
    volumeUnit: '手',
    amountUnit: '千元',
    bars: [{ tradeDate: '2026-07-17', open: 1490, high: 1510, low: 1480, close: 1500, volume: 1000, amount: 1500000 }],
    provenance: fixtureProvenance,
  },
  {
    blockId: 'financial_fixture',
    schemaVersion: 1,
    type: 'FINANCIAL_METRICS',
    tsCode: '600519.SH',
    periods: [
      {
        reportPeriod: '2025-12-31',
        announcementDate: '2026-03-30',
        metrics: [{ key: 'roe', label: 'ROE', value: 32.5, scale: 'PERCENT' }],
      },
    ],
    provenance: fixtureProvenance,
  },
  {
    blockId: 'risk_fixture',
    schemaVersion: 1,
    type: 'RISK_NOTICE',
    level: 'WARNING',
    code: 'NOT_INVESTMENT_ADVICE',
    text: '内容仅供研究，不构成投资建议。',
    relatedBlockIds: ['markdown_fixture'],
    provenance: fixtureProvenance,
  },
]
