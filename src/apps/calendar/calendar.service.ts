import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

export interface CalendarEvent {
  date: string // YYYYMMDD
  type: 'DIVIDEND' | 'SHARE_FLOAT' | 'DISCLOSURE'
  tsCode: string
  name?: string
  summary: string
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
  ): Promise<CalendarEvent[]> {
    const enabledTypes = new Set(types?.length ? types : ['DIVIDEND', 'SHARE_FLOAT', 'DISCLOSURE'])

    const tasks: Promise<CalendarEvent[]>[] = []

    if (enabledTypes.has('DIVIDEND')) tasks.push(this.queryDividends(startDate, endDate, tsCodes))
    if (enabledTypes.has('SHARE_FLOAT')) tasks.push(this.queryShareFloats(startDate, endDate, tsCodes))
    if (enabledTypes.has('DISCLOSURE')) tasks.push(this.queryDisclosures(startDate, endDate, tsCodes))

    const results = await Promise.all(tasks)
    const events = results.flat()

    // Batch-fill stock names
    await this.fillStockNames(events)

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
      const parts: string[] = []
      if (row.cashDiv != null && row.cashDiv > 0) parts.push(`每10股派${(row.cashDiv * 10).toFixed(2)}元`)
      if (row.stkDiv != null && row.stkDiv > 0) parts.push(`每10股送转${(row.stkDiv * 10).toFixed(2)}股`)
      const detail = parts.length ? ` ${parts.join(' ')}` : ''

      return {
        date: formatDateToYYYYMMDD(row.exDate!),
        type: 'DIVIDEND' as const,
        tsCode: row.tsCode,
        summary: `除权除息${detail}`,
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

    return rows.map((row) => {
      const shareDisplay = row.floatShare != null ? `${Number(row.floatShare).toFixed(2)}万股` : ''
      return {
        date: row.floatDate,
        type: 'SHARE_FLOAT' as const,
        tsCode: row.tsCode,
        summary: `限售解禁${shareDisplay ? ` ${shareDisplay}` : ''}`,
        payload: {
          floatShare: row.floatShare != null ? Number(row.floatShare) : null,
          floatRatio: row.floatRatio != null ? Number(row.floatRatio) : null,
          holderName: row.holderName,
          shareType: row.shareType,
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
