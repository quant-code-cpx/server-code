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
import { OptionMarketRepository } from './option-market.repository'

export const OPTION_MARKET_OPERATIONS = ['SEARCH', 'CONTRACT', 'HISTORY'] as const
export const OPTION_EXCHANGES = ['SSE', 'SZSE', 'CFFEX', 'DCE', 'SHFE', 'CZCE'] as const
export type OptionMarketOperation = (typeof OPTION_MARKET_OPERATIONS)[number]

export interface OptionMarketInput {
  operation: OptionMarketOperation
  optionCode?: string
  nameQuery?: string
  exchange?: (typeof OPTION_EXCHANGES)[number]
  callPut?: 'CALL' | 'PUT'
  maturityFrom?: string
  maturityTo?: string
  listedOnly?: boolean
  asOfDate?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  maxSeriesPoints?: number
}

@Injectable()
export class OptionMarketToolFacade {
  constructor(private readonly repository: OptionMarketRepository) {}

  async getMarket(input: OptionMarketInput) {
    if (!OPTION_MARKET_OPERATIONS.includes(input.operation)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'operation 仅支持 SEARCH、CONTRACT、HISTORY')
    }
    if (input.operation === 'SEARCH') return this.search(input)
    if (input.operation === 'CONTRACT') return this.contract(input)
    return this.history(input)
  }

  private async search(input: OptionMarketInput) {
    rejectFields(input, ['startDate', 'endDate', 'maxSeriesPoints'], 'SEARCH')
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 50
    requireInteger(page, 'page', 1, 10_000)
    requireInteger(pageSize, 'pageSize', 1, 100)
    const nameQuery = input.nameQuery?.trim()
    if (nameQuery && (nameQuery.length < 2 || nameQuery.length > 64)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'nameQuery 长度必须为 2-64')
    }
    const asOfDate = await this.resolveAsOfDate(input.asOfDate)
    const maturityFrom = parseIsoDate(input.maturityFrom, 'maturityFrom') ?? undefined
    const maturityTo = parseIsoDate(input.maturityTo, 'maturityTo') ?? undefined
    if (maturityFrom && maturityTo) validateDateRange(maturityFrom, maturityTo, 1_827, 'maturityFrom', 'maturityTo')
    const result = await this.repository.search({
      nameQuery,
      exchange: input.exchange,
      callPut: input.callPut === 'CALL' ? 'C' : input.callPut === 'PUT' ? 'P' : undefined,
      maturityFrom,
      maturityTo,
      listedOnly: input.listedOnly ?? true,
      asOfDate,
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const warnings: MarketMultiAssetWarning[] = []
    const items = result.items.map((row) => mapContract(row, warnings))
    addBoundaryWarning(warnings)
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

  private async contract(input: OptionMarketInput) {
    rejectFields(
      input,
      [
        'nameQuery',
        'exchange',
        'callPut',
        'maturityFrom',
        'maturityTo',
        'listedOnly',
        'startDate',
        'endDate',
        'page',
        'pageSize',
        'maxSeriesPoints',
      ],
      'CONTRACT',
    )
    const optionCode = normalizeOptionCode(input.optionCode)
    const row = await this.repository.findContract(optionCode)
    if (!row) throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `期权合约不存在：${optionCode}`)
    const warnings: MarketMultiAssetWarning[] = []
    const contract = mapContract(row, warnings)
    addBoundaryWarning(warnings)
    return { data: { operation: 'CONTRACT' as const, contract }, warnings, truncated: false }
  }

  private async history(input: OptionMarketInput) {
    rejectFields(
      input,
      ['nameQuery', 'exchange', 'callPut', 'maturityFrom', 'maturityTo', 'listedOnly', 'page', 'pageSize'],
      'HISTORY',
    )
    const optionCode = normalizeOptionCode(input.optionCode)
    const contract = await this.repository.findContract(optionCode)
    if (!contract) throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `期权合约不存在：${optionCode}`)
    const maxSeriesPoints = input.maxSeriesPoints ?? 500
    requireInteger(maxSeriesPoints, 'maxSeriesPoints', 20, 1_000)
    const asOfDate = await this.resolveAsOfDate(input.asOfDate)
    const endDate = parseIsoDate(input.endDate, 'endDate') ?? asOfDate
    if (endDate > asOfDate) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'endDate 不能晚于 asOfDate')
    const defaultStart = new Date(endDate)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 1)
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? defaultStart
    validateDateRange(startDate, endDate, 1_827)
    const [rows, bounds] = await Promise.all([
      this.repository.findHistory(optionCode, startDate, endDate),
      this.repository.findHistoryBounds(optionCode),
    ])
    if (!rows.length) throw new MarketMultiAssetToolError('DATA_NOT_READY', `期权 ${optionCode} 在请求区间没有日线数据`)
    const points = rows.map((row) => ({
      tradeDate: toIsoDate(row.tradeDate),
      preSettle: finiteOrNull(row.preSettle),
      preClose: finiteOrNull(row.preClose),
      open: finiteOrNull(row.open),
      high: finiteOrNull(row.high),
      low: finiteOrNull(row.low),
      close: finiteOrNull(row.close),
      settle: finiteOrNull(row.settle),
      volume: finiteOrNull(row.vol),
      amount: finiteOrNull(row.amount),
      openInterest: finiteOrNull(row.oi),
    }))
    const sampled = deterministicEvenSample(points, maxSeriesPoints)
    const warnings: MarketMultiAssetWarning[] = [
      {
        code: 'SOURCE_UNIT_UNVERIFIED',
        message: '成交量、成交额和持仓量保留上游源单位，未自行换算',
        affectedFields: ['points.volume', 'points.amount', 'points.openInterest'],
      },
    ]
    addBoundaryWarning(warnings)
    return {
      data: {
        operation: 'HISTORY' as const,
        optionCode,
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
    if (!dataThrough) throw new MarketMultiAssetToolError('DATA_NOT_READY', '本地期权日线尚未就绪')
    return dataThrough
  }
}

function normalizeOptionCode(value: string | undefined): string {
  const optionCode = value?.trim().toUpperCase()
  if (!optionCode || optionCode.length > 30 || !/^[A-Z0-9._-]+$/.test(optionCode)) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'optionCode 必须是最长 30 位的合法期权代码')
  }
  return optionCode
}

function rejectFields(input: OptionMarketInput, fields: Array<keyof OptionMarketInput>, operation: string): void {
  const present = fields.filter((field) => input[field] !== undefined)
  if (present.length) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${operation} 不接受字段：${present.join('、')}`)
  }
}

function mapContract(
  row: Awaited<ReturnType<OptionMarketRepository['findContract']>> & {},
  warnings: MarketMultiAssetWarning[],
) {
  let callPut: 'CALL' | 'PUT' | null = null
  if (row.callPut === 'C') callPut = 'CALL'
  else if (row.callPut === 'P') callPut = 'PUT'
  else if (row.callPut) {
    warnings.push({
      code: 'UNKNOWN_CALL_PUT_SOURCE_VALUE',
      message: `未知期权方向源值 ${row.callPut}，已返回 null`,
      affectedFields: ['callPut'],
    })
  }
  return {
    optionCode: row.tsCode,
    name: row.name,
    exchange: row.exchange,
    seriesCode: row.optCode,
    optionType: row.optType,
    callPut,
    exerciseType: row.exerciseType,
    exercisePrice: finiteOrNull(row.exercisePrice),
    contractMultiplier: row.perUnit,
    settlementMonth: row.sMonth,
    listDate: row.listDate ? toIsoDate(row.listDate) : null,
    maturityDate: row.maturityDate ? toIsoDate(row.maturityDate) : null,
    delistDate: row.delistDate ? toIsoDate(row.delistDate) : null,
    quoteUnit: row.quoteUnit,
    minPriceChange: row.minPriceChg,
    underlyingCode: null,
    underlyingMappingVerified: false as const,
  }
}

function addBoundaryWarning(warnings: MarketMultiAssetWarning[]): void {
  warnings.push({
    code: 'OPTION_UNDERLYING_MAPPING_UNAVAILABLE',
    message: '当前数据未验证标的证券映射，因此不提供标的维度期权链、隐含波动率或 Greeks',
    affectedFields: ['underlyingCode'],
  })
}
