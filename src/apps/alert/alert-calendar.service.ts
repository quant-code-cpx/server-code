import { BadRequestException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { CalendarEventDto, CalendarResultDto } from './dto/calendar-response.dto'
import { CalendarEventType, CalendarQueryDto } from './dto/calendar-query.dto'

/** 最大查询跨度（天） */
const MAX_RANGE_DAYS = 90

@Injectable()
export class AlertCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async getCalendar(query: CalendarQueryDto): Promise<CalendarResultDto> {
    const start = dayjs(query.startDate, 'YYYYMMDD')
    const end = dayjs(query.endDate, 'YYYYMMDD')

    if (!start.isValid() || !end.isValid()) {
      throw new BadRequestException('日期格式无效')
    }
    if (end.diff(start, 'day') > MAX_RANGE_DAYS) {
      throw new BadRequestException(`查询跨度不能超过 ${MAX_RANGE_DAYS} 天`)
    }
    if (end.isBefore(start)) {
      throw new BadRequestException('endDate 不能早于 startDate')
    }

    const startDate = start.toDate()
    const endDate = end.toDate()
    const types = query.types ?? Object.values(CalendarEventType)
    const tsCode = query.tsCode

    const [disclosureEvents, floatEvents, dividendEvents, forecastEvents] = await Promise.all([
      types.includes(CalendarEventType.DISCLOSURE) ? this.fetchDisclosure(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.FLOAT) ? this.fetchFloat(start, end, tsCode) : [],
      types.includes(CalendarEventType.DIVIDEND) ? this.fetchDividend(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.FORECAST) ? this.fetchForecast(startDate, endDate, tsCode) : [],
    ])

    const allEvents: CalendarEventDto[] = [
      ...disclosureEvents,
      ...floatEvents,
      ...dividendEvents,
      ...forecastEvents,
    ].sort((a, b) => a.date.localeCompare(b.date))

    return {
      startDate: query.startDate,
      endDate: query.endDate,
      totalCount: allEvents.length,
      events: allEvents,
    }
  }

  private async fetchDisclosure(
    startDate: Date,
    endDate: Date,
    tsCode?: string,
  ): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.disclosureDate.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        OR: [
          { actualDate: { gte: startDate, lte: endDate } },
          { preDate: { gte: startDate, lte: endDate } },
        ],
      },
      select: {
        tsCode: true,
        endDate: true,
        actualDate: true,
        preDate: true,
      },
    })

    const tsCodes = [...new Set(rows.map((r) => r.tsCode))]
    const nameMap = await this.fetchStockNames(tsCodes)

    return rows.map((r) => {
      const isActual = r.actualDate !== null
      const date = isActual
        ? dayjs(r.actualDate!).format('YYYYMMDD')
        : dayjs(r.preDate!).format('YYYYMMDD')
      const detail: Record<string, unknown> = {
        endDate: r.endDate ? dayjs(r.endDate).format('YYYYMMDD') : null,
        actualDate: r.actualDate ? dayjs(r.actualDate).format('YYYYMMDD') : null,
        preDate: r.preDate ? dayjs(r.preDate).format('YYYYMMDD') : null,
      }
      return {
        date,
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.DISCLOSURE,
        title: `财报披露${isActual ? '（实际）' : '（预计）'}`,
        detail,
      }
    })
  }

  private async fetchFloat(
    start: dayjs.Dayjs,
    end: dayjs.Dayjs,
    tsCode?: string,
  ): Promise<CalendarEventDto[]> {
    const startStr = start.format('YYYYMMDD')
    const endStr = end.format('YYYYMMDD')

    const rows = await this.prisma.shareFloat.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        floatDate: { gte: startStr, lte: endStr },
      },
      select: {
        tsCode: true,
        floatDate: true,
        floatRatio: true,
        floatShare: true,
      },
    })

    const tsCodes = [...new Set(rows.map((r) => r.tsCode))]
    const nameMap = await this.fetchStockNames(tsCodes)

    return rows.map((r) => {
      const floatRatio = r.floatRatio != null ? Number(r.floatRatio) : null
      const detail: Record<string, unknown> = {
        floatRatio,
        floatShare: r.floatShare != null ? Number(r.floatShare) : null,
      }
      return {
        date: r.floatDate!,
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.FLOAT,
        title: `限售解禁${floatRatio != null ? ` ${(floatRatio * 100).toFixed(2)}%` : ''}`,
        detail,
      }
    })
  }

  private async fetchDividend(
    startDate: Date,
    endDate: Date,
    tsCode?: string,
  ): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.dividend.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        exDate: { gte: startDate, lte: endDate },
        divProc: '实施',
      },
      select: {
        tsCode: true,
        exDate: true,
        cashDiv: true,
        stkDiv: true,
        stkBoRate: true,
      },
    })

    const tsCodes = [...new Set(rows.map((r) => r.tsCode))]
    const nameMap = await this.fetchStockNames(tsCodes)

    return rows.map((r) => {
      const cashDiv = r.cashDiv != null ? Number(r.cashDiv) : null
      const stkDiv = r.stkDiv != null ? Number(r.stkDiv) : null
      const detail: Record<string, unknown> = {
        cashDiv,
        stkDiv,
        stkBoRate: r.stkBoRate != null ? Number(r.stkBoRate) : null,
      }
      let title = '除权除息'
      if (cashDiv) title += ` 现金 ${cashDiv}元`
      if (stkDiv) title += ` 送股 ${stkDiv}股`
      return {
        date: dayjs(r.exDate!).format('YYYYMMDD'),
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.DIVIDEND,
        title,
        detail,
      }
    })
  }

  private async fetchForecast(
    startDate: Date,
    endDate: Date,
    tsCode?: string,
  ): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.forecast.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        annDate: { gte: startDate, lte: endDate },
      },
      select: {
        tsCode: true,
        annDate: true,
        type: true,
        pChangeMin: true,
        pChangeMax: true,
      },
    })

    const tsCodes = [...new Set(rows.map((r) => r.tsCode))]
    const nameMap = await this.fetchStockNames(tsCodes)

    return rows.map((r) => {
      const pChangeMin = r.pChangeMin != null ? Number(r.pChangeMin) : null
      const pChangeMax = r.pChangeMax != null ? Number(r.pChangeMax) : null
      const detail: Record<string, unknown> = { type: r.type, pChangeMin, pChangeMax }
      let title = `业绩预告（${r.type ?? ''}）`
      if (pChangeMin != null) title += ` 净利润变动 ${pChangeMin}%~${pChangeMax}%`
      return {
        date: dayjs(r.annDate!).format('YYYYMMDD'),
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.FORECAST,
        title,
        detail,
      }
    })
  }

  private async fetchStockNames(tsCodes: string[]): Promise<Map<string, string>> {
    if (tsCodes.length === 0) return new Map()
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    return new Map(stocks.map((s) => [s.tsCode, s.name]))
  }
}
