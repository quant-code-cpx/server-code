import { UserRole } from '@prisma/client'
import {
  FINANCIAL_INDICATOR_KEYS,
  FinancialToolDataQualityError,
  FinancialToolFacade,
  FinancialToolInvalidArgumentError,
  type FinancialIndicatorsInput,
  type FinancialStatementsInput,
} from 'src/apps/stock/financial-tool.facade'
import { MoneyflowToolFacade, type MoneyflowToolInput } from 'src/apps/stock/moneyflow-tool.facade'
import type { IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition, ToolPolicyDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import type { ToolResult, ToolWarning } from '../contracts/tool-result'
import type { ToolAccessContext } from '../tool-access-context'
import { hashStableJson } from '../tool-json'

export interface FinancialToolDependencies {
  financial: FinancialToolFacade
  moneyflow: MoneyflowToolFacade
  config: IAgentToolsConfig
}

const PUBLIC_POLICY: ToolPolicyDefinition = {
  requiredRole: UserRole.USER,
  sideEffect: 'READ',
  requiresConfirmation: false,
  idempotent: true,
  timeoutMs: 30_000,
  maxAttempts: 2,
  maxRows: 250,
  costClass: 'HIGH',
  allowedDataScopes: ['PUBLIC_MARKET_DATA'],
}

export function createFinancialToolDefinitions(dependencies: FinancialToolDependencies): readonly ToolDefinition[] {
  return Object.freeze([
    financialStatementsDefinition(dependencies.financial, dependencies.config),
    financialIndicatorsDefinition(dependencies.financial, dependencies.config),
    stockMoneyflowDefinition(dependencies.moneyflow, dependencies.config),
  ])
}

function financialStatementsDefinition(financial: FinancialToolFacade, config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'get_financial_statements',
    version: 1,
    description: '按公告可得日读取利润表、资产负债表和现金流量表，区分累计、单季派生与期末时点口径。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode', 'statementTypes', 'periodType', 'limit'],
      properties: {
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        statementTypes: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: { enum: ['INCOME', 'BALANCE_SHEET', 'CASH_FLOW'] },
        },
        periodType: { enum: ['QUARTERLY', 'ANNUAL'] },
        startReportPeriod: { type: 'string', format: 'date' },
        endReportPeriod: { type: 'string', format: 'date' },
        availableAt: { type: 'string', format: 'date-time' },
        limit: { type: 'integer', minimum: 1, maximum: 12 },
      },
    },
    outputSchema: financialStatementsOutputSchema(),
    policy: { ...PUBLIC_POLICY, maxRows: Math.min(12, config.financialMaxPeriods) * 3 },
    execute: async (input, context) =>
      executeSafely(async () => {
        const command = input as unknown as FinancialStatementsInput
        assertRange(command.startReportPeriod, command.endReportPeriod, '报告期')
        if (command.limit > Math.min(12, config.financialMaxPeriods)) {
          throw invalidArgument('limit 超过服务端财务报表上限')
        }
        const value = await financial.getStatements(command)
        const rows = value.data.statements.reduce((total, statement) => total + statement.periods.length, 0)
        if (rows === 0) throw new ToolAdapterError('DATA_NOT_FOUND', '请求范围无财务报表数据')
        return toolResult(context, input, 'get_financial_statements', value.data, {
          sourceServices: ['FinancialToolFacade'],
          sourceModels: value.sourceModels,
          reportPeriod: value.asOf,
          announcementDate: value.availableAsOf,
          availableAt: command.availableAt ?? value.availableAsOf,
          unit: '字段单位见 data.statements[].periods[].values[].unit',
          currency: 'CNY',
          dataVersion: 'financial-statements-pit-v1',
          warnings: value.warnings,
        })
      }),
    countRows: (data) =>
      (data as { statements: Array<{ periods: unknown[] }> }).statements.reduce(
        (total, statement) => total + statement.periods.length,
        0,
      ),
  }
}

function financialIndicatorsDefinition(financial: FinancialToolFacade, config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'get_financial_indicators',
    version: 1,
    description: '按服务端指标白名单和公告可得日读取财务指标，返回上游字段、单位和历史修订能力告警。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode', 'indicators', 'limit'],
      properties: {
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        indicators: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          uniqueItems: true,
          items: { enum: [...FINANCIAL_INDICATOR_KEYS] },
        },
        startReportPeriod: { type: 'string', format: 'date' },
        endReportPeriod: { type: 'string', format: 'date' },
        availableAt: { type: 'string', format: 'date-time' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
    outputSchema: financialIndicatorsOutputSchema(config.financialMaxPeriods),
    policy: { ...PUBLIC_POLICY, maxRows: config.financialMaxPeriods, costClass: 'MEDIUM' },
    execute: async (input, context) =>
      executeSafely(async () => {
        const command = input as unknown as FinancialIndicatorsInput
        assertRange(command.startReportPeriod, command.endReportPeriod, '报告期')
        if (command.limit > config.financialMaxPeriods) throw invalidArgument('limit 超过服务端财务指标上限')
        const value = await financial.getIndicators(command)
        if (value.data.periods.length === 0) throw new ToolAdapterError('DATA_NOT_FOUND', '请求范围无财务指标数据')
        return toolResult(context, input, 'get_financial_indicators', value.data, {
          sourceServices: ['FinancialToolFacade'],
          sourceModels: value.sourceModels,
          reportPeriod: value.asOf,
          announcementDate: value.availableAsOf,
          availableAt: command.availableAt ?? value.availableAsOf,
          unit: '字段单位见 data.periods[].values[].unit',
          currency: 'CNY',
          dataVersion: 'financial-indicators-pit-limited-v1',
          warnings: value.warnings,
          truncated: value.truncated,
        })
      }),
    countRows: (data) => (data as { periods: unknown[] }).periods.length,
  }
}

function stockMoneyflowDefinition(moneyflow: MoneyflowToolFacade, config: IAgentToolsConfig): ToolDefinition {
  return {
    key: 'get_stock_moneyflow',
    version: 1,
    description: '按交易日范围读取个股 L2 资金净流入和可选四档买卖明细；官方净流入不由分单金额重算。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tsCode', 'startDate', 'endDate'],
      properties: {
        tsCode: { type: 'string', minLength: 1, maxLength: 12 },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        includeOrderBuckets: { type: 'boolean', default: true },
        limit: { type: 'integer', minimum: 1, maximum: 250, default: 60 },
      },
    },
    outputSchema: moneyflowOutputSchema(config.moneyflowMaxDays),
    policy: { ...PUBLIC_POLICY, maxRows: config.moneyflowMaxDays, costClass: 'MEDIUM' },
    execute: async (input, context) =>
      executeSafely(async () => {
        const raw = input as Omit<MoneyflowToolInput, 'includeOrderBuckets' | 'limit'> & {
          includeOrderBuckets?: boolean
          limit?: number
        }
        if (raw.startDate > raw.endDate) throw invalidArgument('startDate 不能晚于 endDate')
        const command: MoneyflowToolInput = {
          ...raw,
          includeOrderBuckets: raw.includeOrderBuckets ?? true,
          limit: raw.limit ?? Math.min(60, config.moneyflowMaxDays),
        }
        if (command.limit > config.moneyflowMaxDays) throw invalidArgument('limit 超过服务端资金流上限')
        const value = await moneyflow.getDaily(command)
        if (value.data.days.length === 0) throw new ToolAdapterError('DATA_NOT_FOUND', '请求区间无个股资金流数据')
        return toolResult(context, input, 'get_stock_moneyflow', value.data, {
          sourceServices: ['MoneyflowToolFacade'],
          sourceModels: value.sourceModels,
          tradeDate: value.asOf,
          unit: '金额万元，成交量手；正数表示净流入',
          currency: 'CNY',
          dataVersion: 'tushare-moneyflow-l2-v1',
          truncated: value.truncated,
        })
      }),
    countRows: (data) => (data as { days: unknown[] }).days.length,
  }
}

interface ToolResultOptions {
  sourceServices: string[]
  sourceModels: string[]
  tradeDate?: string | null
  reportPeriod?: string | null
  announcementDate?: string | null
  availableAt?: string | null
  unit?: string
  currency?: string
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
        ...(options.reportPeriod ? { reportPeriod: options.reportPeriod } : {}),
        ...(options.announcementDate ? { announcementDate: options.announcementDate } : {}),
        ...(options.availableAt ? { availableAt: options.availableAt } : {}),
        retrievedAt: new Date().toISOString(),
      },
      timezone: 'Asia/Shanghai',
      ...(options.unit ? { unit: options.unit } : {}),
      ...(options.currency ? { currency: options.currency } : {}),
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
    if (error instanceof FinancialToolInvalidArgumentError) {
      throw new ToolAdapterError('INVALID_ARGUMENT', error.message)
    }
    if (error instanceof FinancialToolDataQualityError) {
      throw new ToolAdapterError('DATA_QUALITY_FAILED', error.message)
    }
    throw new ToolAdapterError('UPSTREAM_FAILED', '财务或个股资金流查询暂时不可用', true)
  }
}

function assertRange(start: string | undefined, end: string | undefined, label: string): void {
  if (start && end && start > end) throw invalidArgument(`${label}开始日期不能晚于结束日期`)
}

function invalidArgument(message: string): ToolAdapterError {
  return new ToolAdapterError('INVALID_ARGUMENT', message)
}

function financialStatementsOutputSchema(): JsonSchema {
  const value = strictObject(
    {
      key: { type: 'string' },
      sourceField: { type: 'string' },
      unit: financialUnitSchema(),
      valueBasis: { enum: ['CUMULATIVE', 'POINT_IN_TIME'] },
      reportedValue: nullableNumber(),
      singleQuarterValue: nullableNumber(),
      singleQuarterDerived: { type: 'boolean' },
    },
    ['key', 'sourceField', 'unit', 'valueBasis', 'reportedValue', 'singleQuarterValue', 'singleQuarterDerived'],
  )
  const period = strictObject(
    {
      reportPeriod: { type: 'string', format: 'date' },
      announcementDate: nullableDate(),
      availableAt: nullableDate(),
      reportType: nullableString(),
      updateFlag: nullableString(),
      revisionCount: { type: 'integer', minimum: 1 },
      values: { type: 'array', maxItems: 30, items: value },
    },
    ['reportPeriod', 'announcementDate', 'availableAt', 'reportType', 'updateFlag', 'revisionCount', 'values'],
  )
  return strictObject(
    {
      tsCode: { type: 'string' },
      periodType: { enum: ['QUARTERLY', 'ANNUAL'] },
      requestedAvailableAt: { type: ['string', 'null'], format: 'date-time' },
      statements: {
        type: 'array',
        maxItems: 3,
        items: strictObject(
          {
            statementType: { enum: ['INCOME', 'BALANCE_SHEET', 'CASH_FLOW'] },
            periods: { type: 'array', maxItems: 12, items: period },
          },
          ['statementType', 'periods'],
        ),
      },
    },
    ['tsCode', 'periodType', 'requestedAvailableAt', 'statements'],
  )
}

function financialIndicatorsOutputSchema(maxPeriods: number): JsonSchema {
  const value = strictObject(
    {
      key: { enum: [...FINANCIAL_INDICATOR_KEYS] },
      sourceField: { type: 'string' },
      value: nullableNumber(),
      unit: financialUnitSchema(),
    },
    ['key', 'sourceField', 'value', 'unit'],
  )
  return strictObject(
    {
      tsCode: { type: 'string' },
      requestedAvailableAt: { type: ['string', 'null'], format: 'date-time' },
      indicators: { type: 'array', maxItems: 30, uniqueItems: true, items: { enum: [...FINANCIAL_INDICATOR_KEYS] } },
      periods: {
        type: 'array',
        maxItems: maxPeriods,
        items: strictObject(
          {
            reportPeriod: { type: 'string', format: 'date' },
            announcementDate: nullableDate(),
            values: { type: 'array', maxItems: 30, items: value },
          },
          ['reportPeriod', 'announcementDate', 'values'],
        ),
      },
    },
    ['tsCode', 'requestedAvailableAt', 'indicators', 'periods'],
  )
}

function moneyflowOutputSchema(maxDays: number): JsonSchema {
  const bucket = strictObject(
    {
      buyVolume: nullableNumber(),
      buyAmount: nullableNumber(),
      sellVolume: nullableNumber(),
      sellAmount: nullableNumber(),
      netVolume: nullableNumber(),
      netAmount: nullableNumber(),
    },
    ['buyVolume', 'buyAmount', 'sellVolume', 'sellAmount', 'netVolume', 'netAmount'],
  )
  const orderBuckets = strictObject({ small: bucket, medium: bucket, large: bucket, extraLarge: bucket }, [
    'small',
    'medium',
    'large',
    'extraLarge',
  ])
  return strictObject(
    {
      tsCode: { type: 'string' },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      includeOrderBuckets: { type: 'boolean' },
      units: strictObject(
        {
          amount: { const: 'CNY_10K' },
          volume: { const: 'LOT' },
          netSign: { const: 'POSITIVE_INFLOW' },
        },
        ['amount', 'volume', 'netSign'],
      ),
      days: {
        type: 'array',
        maxItems: maxDays,
        items: strictObject(
          {
            tradeDate: { type: 'string', format: 'date' },
            netAmount: nullableNumber(),
            netVolume: nullableNumber(),
            orderBuckets,
          },
          ['tradeDate', 'netAmount', 'netVolume'],
        ),
      },
    },
    ['tsCode', 'startDate', 'endDate', 'includeOrderBuckets', 'units', 'days'],
  )
}

function financialUnitSchema(): JsonSchema {
  return { enum: ['CNY', 'CNY_PER_SHARE', 'PERCENT', 'RATIO', 'SHARE_10K'] }
}

function strictObject(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, ...(required.length ? { required } : {}), properties }
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
