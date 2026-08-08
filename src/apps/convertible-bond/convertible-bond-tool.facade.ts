import { Injectable } from '@nestjs/common'
import { deterministicEvenSample } from 'src/apps/market-multi-asset/market-multi-asset.calculation'
import {
  MarketMultiAssetToolError,
  type MarketMultiAssetWarning,
  finiteOrNull,
  parseIsoDate,
  requireInteger,
  toIsoDate,
  validateDateRange,
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import { ConvertibleBondRepository } from './convertible-bond.repository'

export const CONVERTIBLE_BOND_OPERATIONS = ['SEARCH', 'BASIC', 'HISTORY'] as const
export const CONVERTIBLE_BOND_STATUSES = ['LISTED', 'DELISTED', 'ALL'] as const
export type ConvertibleBondOperation = (typeof CONVERTIBLE_BOND_OPERATIONS)[number]

export interface ConvertibleBondMarketInput {
  operation: ConvertibleBondOperation
  bondCode?: string
  stockCode?: string
  status?: (typeof CONVERTIBLE_BOND_STATUSES)[number]
  rating?: string[]
  asOfDate?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  maxSeriesPoints?: number
}

@Injectable()
export class ConvertibleBondToolFacade {
  constructor(private readonly repository: ConvertibleBondRepository) {}

  async getMarket(input: ConvertibleBondMarketInput) {
    if (!CONVERTIBLE_BOND_OPERATIONS.includes(input.operation)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'operation 仅支持 SEARCH、BASIC、HISTORY')
    }
    if (input.operation === 'SEARCH') return this.search(input)
    if (input.operation === 'BASIC') return this.basic(input)
    return this.history(input)
  }

  private async search(input: ConvertibleBondMarketInput) {
    rejectFields(input, ['startDate', 'endDate', 'maxSeriesPoints'], 'SEARCH')
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 50
    requireInteger(page, 'page', 1, 10_000)
    requireInteger(pageSize, 'pageSize', 1, 100)
    const stockCode = input.stockCode?.trim().toUpperCase()
    if (stockCode && !/^\d{6}\.(SH|SZ|BJ)$/.test(stockCode)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'stockCode 必须是带交易所后缀的正股代码')
    }
    const ratings = normalizeRatings(input.rating)
    const asOfDate = await this.resolveAsOfDate(input.asOfDate)
    const result = await this.repository.search({
      stockCode,
      status: input.status ?? 'LISTED',
      ratings,
      asOfDate,
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const warnings: MarketMultiAssetWarning[] = []
    const items = result.items.map((row) => mapBasic(row, warnings, false))
    return {
      data: {
        operation: 'SEARCH' as const,
        asOfDate: toIsoDate(asOfDate),
        total: result.total,
        page,
        pageSize,
        items,
      },
      warnings,
      truncated: page * pageSize < result.total,
    }
  }

  private async basic(input: ConvertibleBondMarketInput) {
    rejectFields(
      input,
      ['stockCode', 'status', 'rating', 'startDate', 'endDate', 'page', 'pageSize', 'maxSeriesPoints'],
      'BASIC',
    )
    const bondCode = normalizeBondCode(input.bondCode)
    const row = await this.repository.findBasic(bondCode)
    if (!row) throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `可转债不存在：${bondCode}`)
    const warnings: MarketMultiAssetWarning[] = []
    return {
      data: { operation: 'BASIC' as const, bond: mapBasic(row, warnings) },
      warnings,
      truncated: warnings.length > 0,
    }
  }

  private async history(input: ConvertibleBondMarketInput) {
    rejectFields(input, ['stockCode', 'status', 'rating', 'page', 'pageSize'], 'HISTORY')
    const bondCode = normalizeBondCode(input.bondCode)
    const basic = await this.repository.findBasic(bondCode)
    if (!basic) throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `可转债不存在：${bondCode}`)
    const maxSeriesPoints = input.maxSeriesPoints ?? 500
    requireInteger(maxSeriesPoints, 'maxSeriesPoints', 20, 1_000)
    const asOfDate = await this.resolveAsOfDate(input.asOfDate)
    const endDate = parseIsoDate(input.endDate, 'endDate') ?? asOfDate
    if (endDate > asOfDate) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'endDate 不能晚于 asOfDate')
    const defaultStart = new Date(endDate)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 1)
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? defaultStart
    validateDateRange(startDate, endDate, 3_653)
    const [rows, bounds] = await Promise.all([
      this.repository.findHistory(bondCode, startDate, endDate),
      this.repository.findHistoryBounds(bondCode),
    ])
    if (!rows.length) throw new MarketMultiAssetToolError('DATA_NOT_READY', `可转债 ${bondCode} 在请求区间没有日线数据`)
    const points = rows.map((row) => ({
      tradeDate: toIsoDate(row.tradeDate),
      open: finiteOrNull(row.open),
      high: finiteOrNull(row.high),
      low: finiteOrNull(row.low),
      close: finiteOrNull(row.close),
      pctChange: finiteOrNull(row.pctChg),
      volume: finiteOrNull(row.vol),
      amount: finiteOrNull(row.amount),
      pureBondValue: finiteOrNull(row.bondValue),
      pureBondPremiumRate: finiteOrNull(row.bondOverRate),
      conversionValue: finiteOrNull(row.cbValue),
      conversionPremiumRate: finiteOrNull(row.cbOverRate),
    }))
    const sampled = deterministicEvenSample(points, maxSeriesPoints)
    const warnings: MarketMultiAssetWarning[] = []
    const firstPoint = points[0].tradeDate
    const lastPoint = points[points.length - 1].tradeDate
    if (firstPoint > toIsoDate(startDate) || lastPoint < toIsoDate(endDate)) {
      warnings.push({
        code: 'PARTIAL_COVERAGE',
        message: `本地可转债日线仅覆盖 ${firstPoint} 至 ${lastPoint}，短于请求区间`,
        affectedFields: ['points', 'coverageStart', 'dataThrough'],
      })
    }
    return {
      data: {
        operation: 'HISTORY' as const,
        bondCode,
        requestedRange: { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) },
        coverageStart: bounds.first ? toIsoDate(bounds.first) : null,
        dataThrough: bounds.last ? toIsoDate(bounds.last) : null,
        totalPoints: points.length,
        returnedPoints: sampled.length,
        sampling: sampled.length < points.length ? ('EVEN_WITH_ENDPOINTS' as const) : ('NONE' as const),
        points: sampled,
      },
      warnings,
      truncated: sampled.length < points.length,
    }
  }

  private async resolveAsOfDate(value: string | undefined): Promise<Date> {
    const requested = parseIsoDate(value, 'asOfDate')
    if (requested) return requested
    const dataThrough = await this.repository.findDataThrough()
    if (!dataThrough) throw new MarketMultiAssetToolError('DATA_NOT_READY', '本地可转债日线尚未就绪')
    return dataThrough
  }
}

function normalizeBondCode(value: string | undefined): string {
  const bondCode = value?.trim().toUpperCase()
  if (!bondCode || !/^\d{6}\.(SH|SZ)$/.test(bondCode)) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'bondCode 必须为可转债代码，例如 110059.SH')
  }
  return bondCode
}

function normalizeRatings(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined
  if (!values.length || values.length > 10 || new Set(values).size !== values.length) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'rating 必须包含 1-10 个不重复评级')
  }
  return values.map((value) => {
    const rating = value.trim().toUpperCase()
    if (!/^[A-Z+-]{1,8}$/.test(rating)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `非法评级：${value}`)
    }
    return rating
  })
}

function rejectFields(
  input: ConvertibleBondMarketInput,
  fields: Array<keyof ConvertibleBondMarketInput>,
  operation: string,
): void {
  const present = fields.filter((field) => input[field] !== undefined)
  if (present.length)
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${operation} 不接受字段：${present.join('、')}`)
}

function mapBasic(
  row: Awaited<ReturnType<ConvertibleBondRepository['findBasic']>> & {},
  warnings: MarketMultiAssetWarning[],
  includeClauses = true,
) {
  const basic = {
    bondCode: row.tsCode,
    bondName: row.bondShortName,
    fullName: row.bondFullName,
    stockCode: row.stkCode,
    stockName: row.stkShortName,
    exchange: row.exchange,
    parValue: finiteOrNull(row.par),
    issueSize: finiteOrNull(row.issueSize),
    remainingSize: finiteOrNull(row.remainSize),
    listDate: row.listDate ? toIsoDate(row.listDate) : null,
    delistDate: row.delistDate ? toIsoDate(row.delistDate) : null,
    maturityDate: row.maturityDate ? toIsoDate(row.maturityDate) : null,
    conversionStartDate: row.convStartDate ? toIsoDate(row.convStartDate) : null,
    conversionEndDate: row.convEndDate ? toIsoDate(row.convEndDate) : null,
    currentConversionPrice: finiteOrNull(row.convPrice),
    couponRate: finiteOrNull(row.couponRate),
    newestRating: row.newestRating,
  }
  if (!includeClauses) return basic
  return {
    ...basic,
    clauses: {
      redemption: truncateClause(row.callClause, 'clauses.redemption', warnings),
      put: truncateClause(row.putClause, 'clauses.put', warnings),
      reset: truncateClause(row.resetClause, 'clauses.reset', warnings),
      conversion: truncateClause(row.convClause, 'clauses.conversion', warnings),
    },
  }
}

function truncateClause(value: string | null, field: string, warnings: MarketMultiAssetWarning[]): string | null {
  if (!value || value.length <= 4_000) return value
  warnings.push({ code: 'CLAUSE_TRUNCATED', message: `${field} 超过 4000 字，已截断`, affectedFields: [field] })
  return value.slice(0, 4_000)
}
