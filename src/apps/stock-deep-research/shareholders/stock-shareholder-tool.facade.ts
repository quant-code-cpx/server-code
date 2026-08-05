import { Injectable } from '@nestjs/common'
import {
  assertStockExists,
  finiteOrNull,
  normalizeSections,
  normalizeTsCode,
  normalizeUnexpectedError,
  notReady,
  notRequested,
  ok,
  parseIsoDate,
  requireInteger,
  sanitizeExternalText,
  StockDeepResearchToolError,
  type SectionResult,
  type StockDeepResearchWarning,
  toIsoDate,
} from '../stock-deep-research.types'
import { StockShareholderRepository } from './stock-shareholder.repository'

export const STOCK_SHAREHOLDER_SECTIONS = ['HOLDER_COUNT', 'TOP10', 'TOP10_FLOAT', 'TRADES', 'PLEDGE'] as const
export type StockShareholderSection = (typeof STOCK_SHAREHOLDER_SECTIONS)[number]

export interface StockShareholderProfileInput {
  tsCode: string
  asOfDate?: string
  sections?: StockShareholderSection[]
  periods?: number
  tradeLimit?: number
}

interface ShareholderPeriod {
  reportPeriod: string
  latestAnnouncementAt: string
  holders: Array<{
    holderName: string
    holdAmount: number | null
    holdRatio: number | null
    holdFloatRatio: number | null
    holdChange: number | null
    holderType: string | null
  }>
}

@Injectable()
export class StockShareholderToolFacade {
  constructor(private readonly repository: StockShareholderRepository) {}

  async getProfile(input: StockShareholderProfileInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const asOfDate = parseIsoDate(input.asOfDate) ?? todayUtc()
    const sections = normalizeSections(input.sections, STOCK_SHAREHOLDER_SECTIONS, STOCK_SHAREHOLDER_SECTIONS)
    const periods = input.periods ?? 4
    const tradeLimit = input.tradeLimit ?? 50
    requireInteger(periods, 'periods', 1, 12)
    requireInteger(tradeLimit, 'tradeLimit', 1, 100)

    try {
      await assertStockExists((code) => this.repository.findStock(code), tsCode)
      const requested = new Set(sections)
      const [holderRows, top10Rows, top10FloatRows, tradeRows, pledgeRows] = await Promise.all([
        requested.has('HOLDER_COUNT')
          ? this.repository.findHolderCounts(tsCode, asOfDate, periods + 1)
          : Promise.resolve([]),
        requested.has('TOP10') ? this.repository.findTop10(tsCode, asOfDate, periods * 20) : Promise.resolve([]),
        requested.has('TOP10_FLOAT')
          ? this.repository.findTop10Float(tsCode, asOfDate, periods * 20)
          : Promise.resolve([]),
        requested.has('TRADES') ? this.repository.findTrades(tsCode, asOfDate, tradeLimit) : Promise.resolve([]),
        requested.has('PLEDGE') ? this.repository.findPledges(tsCode, asOfDate, periods) : Promise.resolve([]),
      ])

      const holderCountData = holderRows.slice(0, periods).map((row, index) => {
        const previous = holderRows[index + 1]
        const change = previous ? row.holderNum - previous.holderNum : null
        return {
          reportPeriod: toIsoDate(row.endDate),
          announcedAt: toIsoDate(row.annDate),
          holderCount: row.holderNum,
          changeFromPrevious: change,
          changePctFromPrevious:
            change !== null && previous.holderNum !== 0 ? (change / previous.holderNum) * 100 : null,
        }
      })
      const top10Data = groupHolderPeriods(top10Rows, periods)
      const top10FloatData = groupHolderPeriods(top10FloatRows, periods)
      const tradesData = tradeRows.map((row) => ({
        announcedAt: toIsoDate(row.annDate),
        holderName: sanitizeExternalText(row.holderName, 256) ?? '未知股东',
        holderType: sanitizeExternalText(row.holderType, 32) ?? 'UNKNOWN',
        direction: row.inDe === 'IN' ? ('INCREASE' as const) : ('DECREASE' as const),
        changeVolume: finiteOrNull(row.changeVol),
        changeRatio: finiteOrNull(row.changeRatio),
        averagePrice: finiteOrNull(row.avgPrice),
        beginDate: row.beginDate ? toIsoDate(row.beginDate) : null,
        endDate: row.closeDate ? toIsoDate(row.closeDate) : null,
      }))
      const pledgeData = pledgeRows.map((row) => {
        const unrest = finiteOrNull(row.unrestPledge)
        const rest = finiteOrNull(row.restPledge)
        return {
          reportPeriod: toIsoDate(row.endDate),
          pledgeCount: row.pledgeCount,
          pledgedShares: unrest !== null || rest !== null ? (unrest ?? 0) + (rest ?? 0) : null,
          totalShares: finiteOrNull(row.totalShare),
          pledgeRatio: finiteOrNull(row.pledgeRatio),
          announcedAt: null,
          pointInTimeVerified: false,
        }
      })

      const holderCount = section(requested.has('HOLDER_COUNT'), holderCountData, '股东人数数据尚未就绪')
      const top10 = section(requested.has('TOP10'), top10Data, '前十大股东数据尚未就绪')
      const top10Float = section(requested.has('TOP10_FLOAT'), top10FloatData, '前十大流通股东数据尚未就绪')
      const trades = section(requested.has('TRADES'), tradesData, '股东增减持数据尚未就绪')
      const pledge = section(requested.has('PLEDGE'), pledgeData, '质押统计数据尚未就绪')
      const requestedResults = [holderCount, top10, top10Float, trades, pledge].filter((_, index) =>
        requested.has(STOCK_SHAREHOLDER_SECTIONS[index]),
      )
      if (!requestedResults.some((result) => result.status === 'OK')) {
        throw new StockDeepResearchToolError('DATA_NOT_READY', '请求的股东分区均未就绪', true)
      }
      const warnings: StockDeepResearchWarning[] = []
      if (requested.has('PLEDGE') && pledgeData.length) {
        warnings.push({
          code: 'ANNOUNCEMENT_DATE_UNAVAILABLE',
          message: '质押统计缺少公告日期，不能用于历史时点因果判断',
          affectedFields: ['pledge'],
        })
      }
      const visibleDates = [
        ...holderRows.map((row) => row.annDate),
        ...top10Rows.flatMap((row) => (row.annDate ? [row.annDate] : [])),
        ...top10FloatRows.flatMap((row) => (row.annDate ? [row.annDate] : [])),
        ...tradeRows.map((row) => row.annDate),
        ...pledgeRows.map((row) => row.endDate),
      ].sort((left, right) => left.getTime() - right.getTime())
      return {
        data: {
          meta: {
            tsCode,
            requestedAsOfDate: input.asOfDate ?? toIsoDate(asOfDate),
            dataThrough: visibleDates.length ? toIsoDate(visibleDates.at(-1)!) : null,
            coverageStart: visibleDates.length ? toIsoDate(visibleDates[0]) : null,
            timezone: 'Asia/Shanghai' as const,
          },
          holderCount,
          top10,
          top10Float,
          trades,
          pledge,
        },
        warnings,
      }
    } catch (error) {
      throw normalizeUnexpectedError(error, '股东数据查询暂时失败')
    }
  }
}

function section<T>(requested: boolean, rows: T[], message: string): SectionResult<T[]> {
  if (!requested) return notRequested()
  return rows.length ? ok(rows) : notReady(message)
}

type HolderRow = Awaited<ReturnType<StockShareholderRepository['findTop10']>>[number]

function groupHolderPeriods(rows: readonly HolderRow[], periods: number): ShareholderPeriod[] {
  const grouped = new Map<string, HolderRow[]>()
  for (const row of rows) {
    const key = toIsoDate(row.endDate)
    if (!grouped.has(key) && grouped.size >= periods) continue
    const values = grouped.get(key) ?? []
    values.push(row)
    grouped.set(key, values)
  }
  return [...grouped.entries()].map(([reportPeriod, periodRows]) => {
    const announcement = periodRows
      .flatMap((row) => (row.annDate ? [row.annDate] : []))
      .sort((left, right) => right.getTime() - left.getTime())[0]
    const latestRows = announcement
      ? periodRows.filter((row) => row.annDate?.getTime() === announcement.getTime())
      : periodRows
    return {
      reportPeriod,
      latestAnnouncementAt: toIsoDate(announcement),
      holders: latestRows.slice(0, 10).map((row) => ({
        holderName: sanitizeExternalText(row.holderName, 256) ?? '未知股东',
        holdAmount: finiteOrNull(row.holdAmount),
        holdRatio: finiteOrNull(row.holdRatio),
        holdFloatRatio: finiteOrNull(row.holdFloatRatio),
        holdChange: finiteOrNull(row.holdChange),
        holderType: sanitizeExternalText(row.holderType, 64),
      })),
    }
  })
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
}
