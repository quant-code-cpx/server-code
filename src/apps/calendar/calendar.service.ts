import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

export interface CalendarEvent {
  date: string // YYYYMMDD
  type: 'DIVIDEND' | 'SHARE_FLOAT' | 'DISCLOSURE'
  tsCode: string
  name?: string
  summary: string
  impactLevel: 'HIGH' | 'MEDIUM' | 'LOW'
  impactScore: number
  isInWatchlist?: boolean
  payload: Record<string, unknown>
}

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async getEventsByDateRange(
    startDate: string,
    endDate: string,
    types?: string[],
    tsCodes?: string[],
    userId?: number,
    keyword?: string,
  ): Promise<CalendarEvent[]> {
    const enabledTypes = new Set(types?.length ? types : ['DIVIDEND', 'SHARE_FLOAT', 'DISCLOSURE'])

    const tasks: Promise<CalendarEvent[]>[] = []

    if (enabledTypes.has('DIVIDEND')) tasks.push(this.queryDividends(startDate, endDate, tsCodes))
    if (enabledTypes.has('SHARE_FLOAT')) tasks.push(this.queryShareFloats(startDate, endDate, tsCodes))
    if (enabledTypes.has('DISCLOSURE')) tasks.push(this.queryDisclosures(startDate, endDate, tsCodes))

    const results = await Promise.all(tasks)
    let events = results.flat()

    // Batch-fill stock names
    await this.fillStockNames(events)

    // keyword filter (by stock name or tsCode)
    if (keyword?.trim()) {
      const kw = keyword.trim().toLowerCase()
      events = events.filter((e) => e.tsCode.toLowerCase().includes(kw) || (e.name ?? '').toLowerCase().includes(kw))
    }

    // Fill isInWatchlist
    if (userId != null) {
      const tscodes = [...new Set(events.map((e) => e.tsCode))]
      const watchlists = await this.prisma.watchlist.findMany({
        where: { userId },
        select: { stocks: { select: { tsCode: true } } },
      })
      const watchlistSet = new Set(watchlists.flatMap((w) => w.stocks.map((s) => s.tsCode)))
      for (const event of events) {
        event.isInWatchlist = watchlistSet.has(event.tsCode)
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date))
    return events
  }

  async getUpcomingEvents(days: number = 30): Promise<CalendarEvent[]> {
    const today = new Date()
    const future = new Date(today)
    future.setDate(future.getDate() + days)

    const startDate = formatDateToYYYYMMDD(today)
    const endDate = formatDateToYYYYMMDD(future)

    return this.getEventsByDateRange(startDate, endDate)
  }

  // ── Dividend query ──

  private async queryDividends(startDate: string, endDate: string, tsCodes?: string[]): Promise<CalendarEvent[]> {
    const startDt = parseYYYYMMDD(startDate)
    const endDt = parseYYYYMMDD(endDate)

    const rows = await this.prisma.dividend.findMany({
      where: {
        exDate: { gte: startDt, lte: endDt },
        ...(tsCodes?.length ? { tsCode: { in: tsCodes } } : {}),
      },
    })

    return rows.map((row) => {
      const cashDiv = row.cashDiv != null ? Number(row.cashDiv) : 0
      const stkDiv = row.stkDiv != null ? Number(row.stkDiv) : 0
      const parts: string[] = []
      if (cashDiv > 0) parts.push(`每10股派${(cashDiv * 10).toFixed(2)}元`)
      if (stkDiv > 0) parts.push(`每10股送转${(stkDiv * 10).toFixed(2)}股`)
      const detail = parts.length ? ` ${parts.join(' ')}` : ''

      const impactScore = Math.min(100, cashDiv * 100 + stkDiv * 50)
      const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' = impactScore >= 3 ? 'HIGH' : impactScore >= 0.5 ? 'MEDIUM' : 'LOW'

      return {
        date: formatDateToYYYYMMDD(row.exDate!),
        type: 'DIVIDEND' as const,
        tsCode: row.tsCode,
        summary: `除权除息${detail}`,
        impactLevel,
        impactScore: Math.round(impactScore * 10000) / 10000,
        payload: {
          divProc: row.divProc,
          cashDiv: row.cashDiv,
          stkDiv: row.stkDiv,
          recordDate: row.recordDate ? formatDateToYYYYMMDD(row.recordDate) : null,
          payDate: row.payDate ? formatDateToYYYYMMDD(row.payDate) : null,
        },
      }
    })
  }

  // ── Share float query ──

  private async queryShareFloats(startDate: string, endDate: string, tsCodes?: string[]): Promise<CalendarEvent[]> {
    // floatDate is String in the schema
    const rows = await this.prisma.shareFloat.findMany({
      where: {
        floatDate: { gte: startDate, lte: endDate },
        ...(tsCodes?.length ? { tsCode: { in: tsCodes } } : {}),
      },
    })

    // 同一股票同一解禁日可能有多条股东记录，按 (tsCode, floatDate) 聚合为一条事件
    type GroupEntry = { tsCode: string; floatDate: string; floatShare: number; floatRatio: number; holderCount: number }
    const grouped = new Map<string, GroupEntry>()
    for (const row of rows) {
      const key = `${row.tsCode}__${row.floatDate}`
      const share = row.floatShare != null ? Number(row.floatShare) : 0
      // Tushare float_ratio 单位为 %（如 8.21 表示 8.21%），聚合后除以 100 转换为小数
      const ratio = row.floatRatio != null ? Number(row.floatRatio) : 0
      const existing = grouped.get(key)
      if (existing) {
        existing.floatShare += share
        existing.floatRatio += ratio
        existing.holderCount++
      } else {
        grouped.set(key, {
          tsCode: row.tsCode,
          floatDate: row.floatDate,
          floatShare: share,
          floatRatio: ratio,
          holderCount: 1,
        })
      }
    }

    return [...grouped.values()].map((g) => {
      const shareDisplay = g.floatShare ? `${g.floatShare.toFixed(0)}万股` : ''
      // floatRatio 已是百分比单位（如 8.21），转为小数返回
      const floatRatioDecimal = g.floatRatio / 100

      const impactScore = Math.min(100, g.floatRatio) // already in % scale 0-100
      const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' = g.floatRatio >= 10 ? 'HIGH' : g.floatRatio >= 3 ? 'MEDIUM' : 'LOW'

      return {
        date: g.floatDate,
        type: 'SHARE_FLOAT' as const,
        tsCode: g.tsCode,
        summary: `限售解禁${shareDisplay ? ` ${shareDisplay}` : ''}`,
        impactLevel,
        impactScore: Math.round(impactScore * 10000) / 10000,
        payload: {
          floatShare: g.floatShare || null,
          floatRatio: floatRatioDecimal || null,
          holderCount: g.holderCount,
        },
      }
    })
  }

  // ── Disclosure date query ──

  private async queryDisclosures(startDate: string, endDate: string, tsCodes?: string[]): Promise<CalendarEvent[]> {
    const startDt = parseYYYYMMDD(startDate)
    const endDt = parseYYYYMMDD(endDate)

    const rows = await this.prisma.disclosureDate.findMany({
      where: {
        actualDate: { gte: startDt, lte: endDt },
        ...(tsCodes?.length ? { tsCode: { in: tsCodes } } : {}),
      },
    })

    return rows.map((row) => ({
      date: formatDateToYYYYMMDD(row.actualDate!),
      type: 'DISCLOSURE' as const,
      tsCode: row.tsCode,
      summary: `财报披露`,
      impactLevel: 'LOW' as const,
      impactScore: 0,
      payload: {
        endDate: formatDateToYYYYMMDD(row.endDate),
        preDate: row.preDate ? formatDateToYYYYMMDD(row.preDate) : null,
        modifyDate: row.modifyDate,
      },
    }))
  }

  // ── Batch fill stock names ──

  private async fillStockNames(events: CalendarEvent[]): Promise<void> {
    const uniqueCodes = [...new Set(events.map((e) => e.tsCode))]
    if (uniqueCodes.length === 0) return

    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: uniqueCodes } },
      select: { tsCode: true, name: true },
    })

    const nameMap = new Map(stocks.map((s) => [s.tsCode, s.name ?? undefined]))

    for (const event of events) {
      const name = nameMap.get(event.tsCode)
      if (name) {
        event.name = name
        event.summary = `${name} ${event.summary}`
      }
    }
  }
}

// ── Helpers ──

function parseYYYYMMDD(dateStr: string): Date {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(4, 6)) - 1
  const day = Number(dateStr.slice(6, 8))
  return new Date(year, month, day)
}

function formatDateToYYYYMMDD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}
