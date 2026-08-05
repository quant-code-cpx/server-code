import { Injectable } from '@nestjs/common'
import { formatDateToCompactTradeDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'

export const STOCK_TECHNICAL_INDICATORS = ['MACD', 'KDJ', 'RSI', 'BOLL'] as const

export type StockTechnicalIndicator = (typeof STOCK_TECHNICAL_INDICATORS)[number]

export interface StockTechnicalIndicatorsInput {
  tsCode: string
  asOfDate?: string
  lookback?: number
  indicators?: StockTechnicalIndicator[]
}

export type StockTechnicalToolErrorCode = 'INVALID_ARGUMENT' | 'DATA_NOT_FOUND' | 'DATA_NOT_READY'

export class StockTechnicalToolError extends Error {
  constructor(
    readonly code: StockTechnicalToolErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message)
    this.name = StockTechnicalToolError.name
  }
}

export interface StockTechnicalWarning {
  code: string
  message: string
  affectedFields?: string[]
}

@Injectable()
export class StockTechnicalToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async getIndicators(input: StockTechnicalIndicatorsInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const requestedAsOfDate = input.asOfDate ?? null
    const asOfDate = requestedAsOfDate ? parseIsoDate(requestedAsOfDate) : null
    const lookback = input.lookback ?? 2
    if (!Number.isInteger(lookback) || lookback < 1 || lookback > 500) {
      throw new StockTechnicalToolError('INVALID_ARGUMENT', 'lookback 必须是 1-500 的整数')
    }
    const indicators = normalizeIndicators(input.indicators)

    const stock = await this.prisma.stockBasic.findUnique({
      where: { tsCode },
      select: { tsCode: true },
    })
    if (!stock) throw new StockTechnicalToolError('DATA_NOT_FOUND', `证券不存在：${tsCode}`)

    const coverage = await this.prisma.stkFactor.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    })
    if (!coverage) {
      throw new StockTechnicalToolError('DATA_NOT_READY', `${tsCode} 的技术因子尚未入库`, true)
    }
    const coverageStart = toIsoDate(coverage.tradeDate)
    if (asOfDate && asOfDate < coverage.tradeDate) {
      throw new StockTechnicalToolError('DATA_NOT_FOUND', '请求日期早于技术因子覆盖起点', false, {
        coverageStart,
      })
    }

    const latest = await this.prisma.stkFactor.findFirst({
      where: { tsCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) {
      throw new StockTechnicalToolError('DATA_NOT_READY', `${tsCode} 在请求日期前没有可用技术因子`, true)
    }

    const rows = await this.prisma.stkFactor.findMany({
      where: { tsCode, tradeDate: { lte: latest.tradeDate } },
      orderBy: { tradeDate: 'desc' },
      take: lookback,
      select: {
        tradeDate: true,
        close: true,
        macdDif: true,
        macdDea: true,
        macd: true,
        kdjK: true,
        kdjD: true,
        kdjJ: true,
        rsi6: true,
        rsi12: true,
        rsi24: true,
        bollUpper: true,
        bollMid: true,
        bollLower: true,
      },
    })
    const requested = new Set(indicators)
    const items = rows.reverse().map((row) => ({
      tradeDate: toIsoDate(row.tradeDate),
      close: finiteOrNull(row.close),
      macd: requested.has('MACD')
        ? { dif: finiteOrNull(row.macdDif), dea: finiteOrNull(row.macdDea), histogram: finiteOrNull(row.macd) }
        : null,
      kdj: requested.has('KDJ')
        ? { k: finiteOrNull(row.kdjK), d: finiteOrNull(row.kdjD), j: finiteOrNull(row.kdjJ) }
        : null,
      rsi: requested.has('RSI')
        ? { rsi6: finiteOrNull(row.rsi6), rsi12: finiteOrNull(row.rsi12), rsi24: finiteOrNull(row.rsi24) }
        : null,
      boll: requested.has('BOLL')
        ? {
            upper: finiteOrNull(row.bollUpper),
            middle: finiteOrNull(row.bollMid),
            lower: finiteOrNull(row.bollLower),
          }
        : null,
    }))

    const dataThrough = toIsoDate(latest.tradeDate)
    const warnings: StockTechnicalWarning[] = []
    if (requestedAsOfDate && requestedAsOfDate !== dataThrough) {
      warnings.push({
        code: 'LATEST_READY_TRADE_DATE_USED',
        message: `请求日期没有完整技术因子，已使用最近可用交易日 ${dataThrough}`,
      })
    }
    const partialGroups = indicators.filter((indicator) =>
      items.some((item) =>
        Object.values(item[indicator.toLowerCase() as 'macd' | 'kdj' | 'rsi' | 'boll'] ?? {}).every(
          (value) => value === null,
        ),
      ),
    )
    if (partialGroups.length) {
      warnings.push({
        code: 'INDICATOR_FIELDS_PARTIAL',
        message: '部分已请求指标字段为空，已按真实空值返回',
        affectedFields: partialGroups,
      })
    }

    return {
      data: {
        tsCode,
        requestedAsOfDate,
        dataThrough,
        coverageStart,
        source: 'TUSHARE_STK_FACTOR' as const,
        adjustment: 'FORWARD_SNAPSHOT' as const,
        requestedIndicators: indicators,
        units: {
          close: 'CNY_PER_SHARE' as const,
          macd: 'PRICE' as const,
          kdj: 'PERCENT' as const,
          rsi: 'PERCENT' as const,
          boll: 'CNY_PER_SHARE' as const,
        },
        items,
      },
      warnings,
    }
  }
}

function normalizeTsCode(value: string): string {
  const tsCode = value?.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
    throw new StockTechnicalToolError('INVALID_ARGUMENT', 'tsCode 必须为 A 股代码，例如 600089.SH')
  }
  return tsCode
}

function normalizeIndicators(values?: readonly StockTechnicalIndicator[]): StockTechnicalIndicator[] {
  const indicators = values?.length ? [...values] : [...STOCK_TECHNICAL_INDICATORS]
  if (indicators.length < 1 || indicators.length > STOCK_TECHNICAL_INDICATORS.length) {
    throw new StockTechnicalToolError('INVALID_ARGUMENT', 'indicators 必须包含 1-4 个指标组')
  }
  const unique = new Set(indicators)
  if (unique.size !== indicators.length || indicators.some((item) => !STOCK_TECHNICAL_INDICATORS.includes(item))) {
    throw new StockTechnicalToolError('INVALID_ARGUMENT', 'indicators 仅支持 MACD、KDJ、RSI、BOLL 且不能重复')
  }
  return [...unique]
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StockTechnicalToolError('INVALID_ARGUMENT', 'asOfDate 必须为 YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) {
    throw new StockTechnicalToolError('INVALID_ARGUMENT', 'asOfDate 不是有效日期')
  }
  return parsed
}

function toIsoDate(value: Date): string {
  const compact = formatDateToCompactTradeDate(value)
  if (!compact) throw new StockTechnicalToolError('DATA_NOT_READY', '技术因子日期无效', true)
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}
