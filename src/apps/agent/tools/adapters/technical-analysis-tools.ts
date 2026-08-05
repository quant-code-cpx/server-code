import { UserRole } from '@prisma/client'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'
import {
  STOCK_TECHNICAL_INDICATORS,
  StockTechnicalToolError,
  StockTechnicalToolFacade,
  type StockTechnicalIndicatorsInput,
} from 'src/apps/stock/stock-technical-tool.facade'
import { TECHNICAL_SIGNAL_DEFINITIONS } from 'src/apps/technical-signal/domain'
import {
  TECHNICAL_SIGNAL_TOOL_SECTIONS,
  TechnicalSignalToolError,
  TechnicalSignalToolFacade,
  type TechnicalSignalToolInput,
} from 'src/apps/technical-signal/technical-signal-tool.facade'

const PUBLIC_POLICY: ToolPolicyDefinition = {
  requiredRole: UserRole.USER,
  sideEffect: 'READ',
  requiresConfirmation: false,
  idempotent: true,
  timeoutMs: 15_000,
  maxAttempts: 2,
  maxRows: 500,
  costClass: 'MEDIUM',
  allowedDataScopes: ['PUBLIC_MARKET_DATA'],
}

export function createTechnicalAnalysisToolDefinitions(dependencies: {
  stockTechnical: StockTechnicalToolFacade
  technicalSignal: TechnicalSignalToolFacade
}): readonly ToolDefinition[] {
  return Object.freeze([
    stockTechnicalIndicatorsDefinition(dependencies.stockTechnical),
    stockTechnicalSignalsDefinition(dependencies.technicalSignal),
  ])
}

function stockTechnicalIndicatorsDefinition(facade: StockTechnicalToolFacade): ToolDefinition {
  return {
    key: 'get_stock_technical_indicators',
    version: 1,
    description:
      '精确读取单只 A 股已入库的 MACD、KDJ、RSI、BOLL 指标快照或最多 500 个交易日短序列。只读本地 PostgreSQL，不计算买卖信号，也不在线请求 Tushare。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode'],
      properties: {
        tsCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
        asOfDate: { type: 'string', format: 'date' },
        lookback: { type: 'integer', minimum: 1, maximum: 500, default: 2 },
        indicators: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { enum: [...STOCK_TECHNICAL_INDICATORS] },
          default: [...STOCK_TECHNICAL_INDICATORS],
        },
      },
    },
    outputSchema: stockTechnicalIndicatorsOutputSchema(),
    policy: PUBLIC_POLICY,
    execute: async (input, context) => {
      try {
        const result = await facade.getIndicators(input as unknown as StockTechnicalIndicatorsInput)
        return adapterToolResult(context, input, 'get_stock_technical_indicators', result.data, {
          version: 1,
          sourceType: 'DATABASE',
          sourceServices: ['StockTechnicalToolFacade'],
          sourceModels: ['StkFactor'],
          tradeDate: result.data.dataThrough,
          unit: '指标单位见 data.units',
          currency: 'CNY',
          adjustment: 'FORWARD',
          dataVersion: `stk-factor.v1:${result.data.dataThrough}`,
          warnings: result.warnings,
        })
      } catch (error) {
        if (error instanceof StockTechnicalToolError) {
          throw new ToolAdapterError(error.code, error.message, error.retryable, undefined, error.details)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', '技术指标查询暂时不可用', true)
      }
    },
    countRows: (data) => (data as { items: unknown[] }).items.length,
  }
}

function stockTechnicalSignalsDefinition(facade: TechnicalSignalToolFacade): ToolDefinition {
  const signalKeys = TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => definition.signalKey)
  return {
    key: 'get_stock_technical_signals',
    version: 1,
    description:
      '精确计算单只 A 股的版本化标准技术信号、最近触发和历史统计。标准事件与 screen_stocks 的筛选启发式不同；回答指定股票有没有当日信号时使用本 Tool。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode'],
      properties: {
        tsCode: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
        asOfDate: { type: 'string', format: 'date' },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { enum: [...TECHNICAL_SIGNAL_TOOL_SECTIONS] },
          default: ['CURRENT'],
        },
        signalKeys: {
          type: 'array',
          minItems: 1,
          maxItems: 14,
          uniqueItems: true,
          items: { enum: signalKeys },
        },
        lookbackTradeDays: { type: 'integer', minimum: 20, maximum: 1250, default: 60 },
        occurrenceLimit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        horizons: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: { type: 'integer', minimum: 1, maximum: 60 },
          default: [1, 3, 5, 10, 20],
        },
        statisticsPeriod: { enum: ['ONE_YEAR', 'THREE_YEARS'], default: 'ONE_YEAR' },
        includeBenchmark: { type: 'boolean', default: false },
      },
    },
    outputSchema: stockTechnicalSignalsOutputSchema(),
    policy: { ...PUBLIC_POLICY, timeoutMs: 30_000, maxRows: 1_500, costClass: 'HIGH' },
    execute: async (input, context) => {
      try {
        const result = await facade.getSignals(input as unknown as TechnicalSignalToolInput)
        return adapterToolResult(context, input, 'get_stock_technical_signals', result.data, {
          version: 1,
          sourceType: 'PROGRAM_CALCULATION',
          sourceServices: ['TechnicalSignalToolFacade', 'TechnicalSignalEvaluationService'],
          sourceModels: ['Daily', 'AdjFactor', 'TradeCal', 'SuspendD'],
          tradeDate: result.data.meta.dataThrough,
          unit: '价格为元/股，收益和比率为小数或百分比，详见分区字段',
          currency: 'CNY',
          adjustment: 'FORWARD',
          dataVersion: `${result.data.meta.catalogVersion}:${result.data.meta.dataThrough}`,
          algorithmVersion: result.data.meta.algorithmVersion,
          warnings: result.warnings,
        })
      } catch (error) {
        if (error instanceof TechnicalSignalToolError) {
          throw new ToolAdapterError(error.code, error.message, error.retryable)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', '技术信号查询暂时不可用', true)
      }
    },
    countRows: (data) => {
      const value = data as {
        current: { data: unknown[] | null }
        occurrences: { data: unknown[] | null }
        statistics: { data: unknown[] | null }
      }
      return (
        (value.current.data?.length ?? 0) + (value.occurrences.data?.length ?? 0) + (value.statistics.data?.length ?? 0)
      )
    },
  }
}

function stockTechnicalIndicatorsOutputSchema(): JsonSchema {
  const nullableNumber: JsonSchema = { type: ['number', 'null'] }
  const nullableGroup = (properties: Record<string, JsonSchema>): JsonSchema => ({
    anyOf: [
      { type: 'null' },
      { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
    ],
  })
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'tsCode',
      'requestedAsOfDate',
      'dataThrough',
      'coverageStart',
      'source',
      'adjustment',
      'requestedIndicators',
      'units',
      'items',
    ],
    properties: {
      tsCode: { type: 'string' },
      requestedAsOfDate: { type: ['string', 'null'], format: 'date' },
      dataThrough: { type: 'string', format: 'date' },
      coverageStart: { type: 'string', format: 'date' },
      source: { const: 'TUSHARE_STK_FACTOR' },
      adjustment: { const: 'FORWARD_SNAPSHOT' },
      requestedIndicators: { type: 'array', items: { enum: [...STOCK_TECHNICAL_INDICATORS] } },
      units: {
        type: 'object',
        additionalProperties: false,
        required: ['close', 'macd', 'kdj', 'rsi', 'boll'],
        properties: {
          close: { const: 'CNY_PER_SHARE' },
          macd: { const: 'PRICE' },
          kdj: { const: 'PERCENT' },
          rsi: { const: 'PERCENT' },
          boll: { const: 'CNY_PER_SHARE' },
        },
      },
      items: {
        type: 'array',
        maxItems: 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['tradeDate', 'close', 'macd', 'kdj', 'rsi', 'boll'],
          properties: {
            tradeDate: { type: 'string', format: 'date' },
            close: nullableNumber,
            macd: nullableGroup({ dif: nullableNumber, dea: nullableNumber, histogram: nullableNumber }),
            kdj: nullableGroup({ k: nullableNumber, d: nullableNumber, j: nullableNumber }),
            rsi: nullableGroup({ rsi6: nullableNumber, rsi12: nullableNumber, rsi24: nullableNumber }),
            boll: nullableGroup({ upper: nullableNumber, middle: nullableNumber, lower: nullableNumber }),
          },
        },
      },
    },
  }
}

function stockTechnicalSignalsOutputSchema(): JsonSchema {
  const section = (data: JsonSchema): JsonSchema => ({
    type: 'object',
    additionalProperties: false,
    required: ['status', 'data', 'error'],
    properties: {
      status: { enum: ['OK', 'NOT_REQUESTED', 'ERROR'] },
      data,
      error: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
        ],
      },
    },
  })
  const currentItem: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'signalKey',
      'displayName',
      'direction',
      'semanticsVersion',
      'definitionHash',
      'evaluable',
      'notEvaluableReason',
      'triggeredOnDataThrough',
      'latestOccurrenceDate',
      'evidence',
    ],
    properties: {
      signalKey: { type: 'string' },
      displayName: { type: 'string' },
      direction: { enum: ['BULLISH', 'BEARISH', 'CONTEXTUAL'] },
      semanticsVersion: { type: 'string' },
      definitionHash: { type: 'string' },
      evaluable: { type: 'boolean' },
      notEvaluableReason: { type: ['string', 'null'] },
      triggeredOnDataThrough: { type: 'boolean' },
      latestOccurrenceDate: { type: ['string', 'null'], format: 'date' },
      evidence: {},
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['meta', 'current', 'occurrences', 'statistics', 'buySignalTriggered', 'sellSignalTriggered'],
    properties: {
      meta: {
        type: 'object',
        additionalProperties: false,
        required: [
          'tsCode',
          'name',
          'requestedAsOfDate',
          'dataThrough',
          'calculationHistoryStart',
          'source',
          'adjustment',
          'algorithmVersion',
          'catalogVersion',
        ],
        properties: {
          tsCode: { type: 'string' },
          name: { type: ['string', 'null'] },
          requestedAsOfDate: { type: ['string', 'null'], format: 'date' },
          dataThrough: { type: 'string', format: 'date' },
          calculationHistoryStart: { type: 'string', format: 'date' },
          source: { const: 'LOCAL_QFQ_OHLCV' },
          adjustment: { const: 'ADJ_FACTOR_RATIO' },
          algorithmVersion: { const: 'technical-indicator.v2' },
          catalogVersion: { type: 'string' },
        },
      },
      current: section({ anyOf: [{ type: 'null' }, { type: 'array', maxItems: 14, items: currentItem }] }),
      occurrences: section({ anyOf: [{ type: 'null' }, { type: 'array', maxItems: 100, items: {} }] }),
      statistics: section({ anyOf: [{ type: 'null' }, { type: 'array', items: {} }] }),
      buySignalTriggered: { type: 'boolean' },
      sellSignalTriggered: { type: 'boolean' },
    },
  }
}
