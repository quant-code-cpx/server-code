import { Injectable } from '@nestjs/common'
import {
  assertStockExists,
  compactToIsoDate,
  finiteOrNull,
  normalizeSections,
  normalizeTsCode,
  normalizeUnexpectedError,
  parseIsoDate,
  requireInteger,
  sanitizeExternalText,
  StockDeepResearchToolError,
  type StockDeepResearchWarning,
  toIsoDate,
} from '../stock-deep-research.types'
import { StockEventRepository, type StockEventQuery } from './stock-event.repository'

export const STOCK_EVENT_SECTIONS = [
  'EARNINGS_FORECAST',
  'DISCLOSURE',
  'DIVIDEND',
  'REPURCHASE',
  'SHARE_FLOAT',
  'SUSPEND',
  'TOP_LIST',
  'BLOCK_TRADE',
] as const
export type StockEventSection = (typeof STOCK_EVENT_SECTIONS)[number]

export interface StockEventsInput {
  tsCode: string
  sections?: StockEventSection[]
  startDate?: string
  endDate?: string
  asOfDate?: string
  page?: number
  pageSize?: number
}

export interface StockEventItem {
  id: string
  type: StockEventSection
  eventDate: string
  knownAt: string | null
  tsCode: string
  title: string
  status: string | null
  reportPeriod: string | null
  values: Record<string, string | number | boolean | null>
  sourceModel: string
  pointInTimeVerified: boolean
}

@Injectable()
export class StockEventToolFacade {
  constructor(private readonly repository: StockEventRepository) {}

  async getEvents(input: StockEventsInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const sections = normalizeSections(input.sections, STOCK_EVENT_SECTIONS, STOCK_EVENT_SECTIONS)
    const endDate = parseIsoDate(input.endDate, 'endDate') ?? todayUtc()
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? addDays(endDate, -90)
    const asOfDate = parseIsoDate(input.asOfDate, 'asOfDate') ?? todayUtc()
    if (startDate > endDate) throw new StockDeepResearchToolError('INVALID_ARGUMENT', 'startDate 不得晚于 endDate')
    if (differenceInDays(startDate, endDate) > 366) {
      throw new StockDeepResearchToolError('INVALID_ARGUMENT', '事件查询日期跨度不得超过 366 天')
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 50
    requireInteger(page, 'page', 1, 100)
    requireInteger(pageSize, 'pageSize', 1, 100)

    try {
      await assertStockExists((code) => this.repository.findStock(code), tsCode)
      const query: StockEventQuery = { tsCode, startDate, endDate, asOfDate }
      const requested = new Set(sections)
      const warnings: StockDeepResearchWarning[] = []
      const results = await Promise.all([
        requested.has('EARNINGS_FORECAST') ? this.repository.findForecasts(query) : Promise.resolve([]),
        requested.has('DISCLOSURE') ? this.repository.findDisclosures(query) : Promise.resolve([]),
        requested.has('DIVIDEND') ? this.repository.findDividends(query) : Promise.resolve([]),
        requested.has('REPURCHASE') ? this.repository.findRepurchases(query) : Promise.resolve([]),
        requested.has('SHARE_FLOAT') ? this.repository.findShareFloats(query) : Promise.resolve([]),
        requested.has('SUSPEND') ? this.repository.findSuspensions(query) : Promise.resolve([]),
        requested.has('TOP_LIST') ? this.repository.findTopList(query) : Promise.resolve([]),
        requested.has('BLOCK_TRADE') ? this.repository.findBlockTrades(query) : Promise.resolve([]),
      ])
      const [forecasts, disclosures, dividends, repurchases, floats, suspensions, topList, blockTrades] = results
      const items: StockEventItem[] = [
        ...forecasts.map((row) => {
          warnIfTruncated(warnings, row.summary, 'summary')
          warnIfTruncated(warnings, row.changeReason, 'changeReason')
          return event({
            id: `forecast:${row.annDate.toISOString()}:${row.endDate.toISOString()}`,
            type: 'EARNINGS_FORECAST',
            eventDate: toIsoDate(row.annDate),
            knownAt: toIsoDate(row.annDate),
            tsCode,
            title: `业绩预告${row.type ? `：${sanitizeExternalText(row.type, 80)}` : ''}`,
            status: row.type,
            reportPeriod: toIsoDate(row.endDate),
            values: {
              pChangeMin: finiteOrNull(row.pChangeMin),
              pChangeMax: finiteOrNull(row.pChangeMax),
              netProfitMin: finiteOrNull(row.netProfitMin),
              netProfitMax: finiteOrNull(row.netProfitMax),
              summary: sanitizeExternalText(row.summary),
              changeReason: sanitizeExternalText(row.changeReason),
            },
            sourceModel: 'Forecast',
          })
        }),
        ...disclosures.flatMap((row) => {
          const actualVisible = row.actualDate && row.actualDate <= asOfDate
          const eventDate = actualVisible ? row.actualDate : row.preDate
          const knownAt = actualVisible ? row.actualDate : row.annDate
          if (!eventDate || !knownAt || eventDate < startDate || eventDate > endDate || knownAt > asOfDate) return []
          return [
            event({
              id: `disclosure:${row.endDate.toISOString()}:${toIsoDate(eventDate)}`,
              type: 'DISCLOSURE',
              eventDate: toIsoDate(eventDate),
              knownAt: toIsoDate(knownAt),
              tsCode,
              title: actualVisible ? '财报实际披露' : '财报计划披露',
              status: actualVisible ? 'ACTUAL' : 'PLANNED',
              reportPeriod: toIsoDate(row.endDate),
              values: {
                plannedDate: row.preDate ? toIsoDate(row.preDate) : null,
                actualDate: row.actualDate ? toIsoDate(row.actualDate) : null,
              },
              sourceModel: 'DisclosureDate',
            }),
          ]
        }),
        ...dividends.flatMap((row) => {
          if (!row.annDate) return []
          const eventDate = row.exDate ?? row.recordDate ?? row.annDate
          if (eventDate < startDate || eventDate > endDate) return []
          return [
            event({
              id: `dividend:${row.id.toString()}`,
              type: 'DIVIDEND',
              eventDate: toIsoDate(eventDate),
              knownAt: toIsoDate(row.annDate),
              tsCode,
              title: row.exDate ? '除权除息' : row.recordDate ? '股权登记' : '分红公告',
              status: sanitizeExternalText(row.divProc, 80),
              reportPeriod: row.endDate ? toIsoDate(row.endDate) : null,
              values: {
                cashDividendAfterTax: finiteOrNull(row.cashDiv),
                cashDividendBeforeTax: finiteOrNull(row.cashDivTax),
                stockDividend: finiteOrNull(row.stkDiv),
                recordDate: row.recordDate ? toIsoDate(row.recordDate) : null,
                exDate: row.exDate ? toIsoDate(row.exDate) : null,
                payDate: row.payDate ? toIsoDate(row.payDate) : null,
              },
              sourceModel: 'Dividend',
            }),
          ]
        }),
        ...repurchases.map((row) =>
          event({
            id: `repurchase:${row.id}`,
            type: 'REPURCHASE',
            eventDate: toIsoDate(row.endDate ?? row.annDate),
            knownAt: toIsoDate(row.annDate),
            tsCode,
            title: '股份回购',
            status: sanitizeExternalText(row.proc, 80),
            reportPeriod: row.endDate ? toIsoDate(row.endDate) : null,
            values: {
              volume: finiteOrNull(row.vol),
              amount: finiteOrNull(row.amount),
              highLimit: finiteOrNull(row.highLimit),
              lowLimit: finiteOrNull(row.lowLimit),
              expiryDate: row.expDate ? toIsoDate(row.expDate) : null,
            },
            sourceModel: 'Repurchase',
          }),
        ),
        ...floats.flatMap((row) => {
          const eventDate = compactToIsoDate(row.floatDate)
          const knownAt = row.annDate ? compactToIsoDate(row.annDate) : null
          if (!eventDate || !knownAt) return []
          return [
            event({
              id: `share-float:${row.id}`,
              type: 'SHARE_FLOAT',
              eventDate,
              knownAt,
              tsCode,
              title: '限售股解禁',
              status: sanitizeExternalText(row.shareType, 80),
              reportPeriod: null,
              values: {
                floatShares: finiteOrNull(row.floatShare),
                floatRatio: finiteOrNull(row.floatRatio),
                holderName: sanitizeExternalText(row.holderName, 256),
              },
              sourceModel: 'ShareFloat',
            }),
          ]
        }),
        ...suspensions.flatMap((row) => {
          const date = compactToIsoDate(row.tradeDate)
          return date
            ? [
                event({
                  id: `suspend:${row.tradeDate}`,
                  type: 'SUSPEND',
                  eventDate: date,
                  knownAt: date,
                  tsCode,
                  title: '停复牌事件',
                  status: sanitizeExternalText(row.suspendType, 80),
                  reportPeriod: null,
                  values: { timing: sanitizeExternalText(row.suspendTiming, 120) },
                  sourceModel: 'SuspendD',
                }),
              ]
            : []
        }),
        ...topList.flatMap((row) => {
          const date = compactToIsoDate(row.tradeDate)
          return date
            ? [
                event({
                  id: `top-list:${row.tradeDate}`,
                  type: 'TOP_LIST',
                  eventDate: date,
                  knownAt: date,
                  tsCode,
                  title: '龙虎榜上榜',
                  status: null,
                  reportPeriod: null,
                  values: {
                    close: finiteOrNull(row.close),
                    pctChange: finiteOrNull(row.pctChange),
                    netAmount: finiteOrNull(row.netAmount),
                    netRate: finiteOrNull(row.netRate),
                    reason: sanitizeExternalText(row.reason),
                  },
                  sourceModel: 'TopList',
                }),
              ]
            : []
        }),
        ...blockTrades.flatMap((row) => {
          const date = compactToIsoDate(row.tradeDate)
          return date
            ? [
                event({
                  id: `block-trade:${row.id}`,
                  type: 'BLOCK_TRADE',
                  eventDate: date,
                  knownAt: date,
                  tsCode,
                  title: '大宗交易',
                  status: null,
                  reportPeriod: null,
                  values: {
                    price: finiteOrNull(row.price),
                    volume: finiteOrNull(row.vol),
                    amount: finiteOrNull(row.amount),
                    buyer: sanitizeExternalText(row.buyer, 256),
                    seller: sanitizeExternalText(row.seller, 256),
                  },
                  sourceModel: 'BlockTrade',
                }),
              ]
            : []
        }),
      ].sort(compareEvents)
      const offset = (page - 1) * pageSize
      const paged = items.slice(offset, offset + pageSize)
      return {
        data: {
          meta: {
            tsCode,
            requestedAsOfDate: input.asOfDate ?? toIsoDate(asOfDate),
            dataThrough: items[0]?.eventDate ?? null,
            coverageStart: items.at(-1)?.eventDate ?? null,
            timezone: 'Asia/Shanghai' as const,
          },
          sections,
          total: items.length,
          page,
          pageSize,
          items: paged,
        },
        warnings,
        truncated: offset + paged.length < items.length,
      }
    } catch (error) {
      throw normalizeUnexpectedError(error, '结构化事件查询暂时失败')
    }
  }
}

function event(input: Omit<StockEventItem, 'pointInTimeVerified'>): StockEventItem {
  return { ...input, title: sanitizeExternalText(input.title, 200) ?? input.type, pointInTimeVerified: true }
}

function compareEvents(left: StockEventItem, right: StockEventItem): number {
  return (
    right.eventDate.localeCompare(left.eventDate) ||
    left.type.localeCompare(right.type) ||
    right.id.localeCompare(left.id)
  )
}

function warnIfTruncated(warnings: StockDeepResearchWarning[], value: string | null, field: string): void {
  if (value && value.length > 2_000 && !warnings.some((warning) => warning.affectedFields?.includes(field))) {
    warnings.push({
      code: 'TEXT_TRUNCATED',
      message: `外部文本字段 ${field} 已截断到 2000 字符`,
      affectedFields: [field],
    })
  }
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000)
}

function differenceInDays(left: Date, right: Date): number {
  return Math.floor((right.getTime() - left.getTime()) / 86_400_000)
}
