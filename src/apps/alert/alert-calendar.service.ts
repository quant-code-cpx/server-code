import { BadRequestException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { EventStudyService } from 'src/apps/event-study/event-study.service'
import { EventType, EVENT_TYPE_CONFIGS } from 'src/apps/event-study/event-type.registry'
import {
  CalendarEventDto,
  CalendarHistoryTrendDto,
  CalendarResultDto,
} from './dto/calendar-response.dto'
import { CalendarEventType, CalendarQueryDto, MarketCapBucket } from './dto/calendar-query.dto'

/** 最大查询跨度（天） */
const MAX_RANGE_DAYS = 90

const CALENDAR_TO_EVENT_TYPE: Record<CalendarEventType, EventType> = {
  [CalendarEventType.DISCLOSURE]: EventType.DISCLOSURE,
  [CalendarEventType.FLOAT]: EventType.SHARE_FLOAT,
  [CalendarEventType.DIVIDEND]: EventType.DIVIDEND_EX,
  [CalendarEventType.FORECAST]: EventType.FORECAST,
}

@Injectable()
export class AlertCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventStudyService: EventStudyService,
  ) {}

  async getCalendar(query: CalendarQueryDto, userId?: number): Promise<CalendarResultDto> {
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

    let allEvents: CalendarEventDto[] = [
      ...disclosureEvents,
      ...floatEvents,
      ...dividendEvents,
      ...forecastEvents,
    ].sort((a, b) => a.date.localeCompare(b.date))

    // keyword 过滤（股票代码 / 股票名称）
    if (query.keyword) {
      const kw = query.keyword.toLowerCase()
      allEvents = allEvents.filter(
        (e) => e.tsCode.toLowerCase().includes(kw) || (e.stockName ?? '').toLowerCase().includes(kw),
      )
    }

    // impactLevels 过滤
    if (query.impactLevels?.length) {
      allEvents = allEvents.filter((e) => e.impactLevel && query.impactLevels!.includes(e.impactLevel as never))
    }

    // isInWatchlist 填充
    if (userId != null && allEvents.length > 0) {
      const tsCodes = [...new Set(allEvents.map((e) => e.tsCode))]
      const watchlists = await this.prisma.watchlist.findMany({
        where: { userId },
        select: { stocks: { select: { tsCode: true } } },
      })
      const watchlistSet = new Set(watchlists.flatMap((w) => w.stocks.map((s) => s.tsCode)))
      for (const e of allEvents) {
        e.isInWatchlist = watchlistSet.has(e.tsCode)
      }
    }

    // marketCapBuckets 过滤：查最新交易日 totalMv（万元）分桶
    if (query.marketCapBuckets?.length && allEvents.length > 0) {
      const tsCodes = [...new Set(allEvents.map((e) => e.tsCode))]
      // 取每个股票最新一天的 totalMv
      const latestRows = await this.prisma.dailyBasic.findMany({
        where: { tsCode: { in: tsCodes }, totalMv: { not: null } },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'desc' }],
        distinct: ['tsCode'],
        select: { tsCode: true, totalMv: true },
      })
      const mvMap = new Map(latestRows.map((r) => [r.tsCode, r.totalMv ?? 0]))

      const bucketFn = (mv: number): MarketCapBucket => {
        // totalMv 单位：万元；分桶界限单位：亿元（1亿=10000万）
        if (mv < 200_000) return MarketCapBucket.SMALL // <20亿
        if (mv < 1_000_000) return MarketCapBucket.MID // 20-100亿
        if (mv < 5_000_000) return MarketCapBucket.LARGE // 100-500亿
        return MarketCapBucket.MEGA // >500亿
      }

      const bucketSet = new Set(query.marketCapBuckets)
      allEvents = allEvents.filter((e) => {
        const mv = mvMap.get(e.tsCode)
        if (mv == null) return false // 无市值数据则屏蔽
        return bucketSet.has(bucketFn(mv))
      })
    }

    return {
      startDate: query.startDate,
      endDate: query.endDate,
      totalCount: allEvents.length,
      events: allEvents,
    }
  }

  async getHistoryTrend(dto: {
    tsCode: string
    type: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarHistoryTrendDto> {
    const eventType = CALENDAR_TO_EVENT_TYPE[dto.type as CalendarEventType]
    if (!eventType) {
      throw new BadRequestException(`不支持的事件类型: ${dto.type}`)
    }

    const preDays = 5
    const postDays = 10

    const result = await this.eventStudyService.analyze({
      eventType,
      tsCode: dto.tsCode,
      startDate: dto.startDate,
      endDate: dto.endDate,
      preDays,
      postDays,
    })

    if (!result.topSamples?.length) {
      return { samples: [], average: {} }
    }

    const eventLabel = EVENT_TYPE_CONFIGS[eventType]?.label ?? dto.type
    const windows = ['d1', 'd5', 'd10']

    const samples = result.topSamples.map((s) => {
      const returns: Record<string, number | null> = {}
      for (const w of windows) {
        const days = parseInt(w.slice(1), 10)
        const startIdx = preDays + 1
        const endIdx = preDays + days
        if (endIdx >= s.arSeries.length) {
          returns[w] = null
          continue
        }
        let cum = 0
        for (let i = startIdx; i <= endIdx; i++) cum += s.arSeries[i]
        returns[w] = Math.round(cum * 10000) / 10000
      }
      return {
        eventDate: s.eventDate.replace(/-/g, ''),
        eventTitle: `${s.name ?? s.tsCode} ${eventLabel}`,
        returns,
      }
    })

    const average: Record<string, number | null> = {}
    for (const w of windows) {
      const valid = samples.map((s) => s.returns[w]).filter((v): v is number => v !== null)
      average[w] = valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10000) / 10000 : null
    }

    return { samples, average }
  }

  private async fetchDisclosure(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.disclosureDate.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        OR: [{ actualDate: { gte: startDate, lte: endDate } }, { preDate: { gte: startDate, lte: endDate } }],
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
      const date = isActual ? dayjs(r.actualDate!).format('YYYYMMDD') : dayjs(r.preDate!).format('YYYYMMDD')
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
        impactScore: 0,
        impactLevel: 'LOW' as const,
        isInWatchlist: null,
      }
    })
  }

  private async fetchFloat(start: dayjs.Dayjs, end: dayjs.Dayjs, tsCode?: string): Promise<CalendarEventDto[]> {
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

    // 同一股票同一解禁日可能有多条股东记录，按 (tsCode, floatDate) 聚合为一条事件
    type GroupEntry = { tsCode: string; floatDate: string; floatShare: number; floatRatio: number; holderCount: number }
    const grouped = new Map<string, GroupEntry>()
    for (const r of rows) {
      const key = `${r.tsCode}__${r.floatDate}`
      const share = r.floatShare != null ? Number(r.floatShare) : 0
      const ratio = r.floatRatio != null ? Number(r.floatRatio) : 0
      const existing = grouped.get(key)
      if (existing) {
        existing.floatShare += share
        existing.floatRatio += ratio
        existing.holderCount++
      } else {
        grouped.set(key, {
          tsCode: r.tsCode,
          floatDate: r.floatDate!,
          floatShare: share,
          floatRatio: ratio,
          holderCount: 1,
        })
      }
    }

    const tsCodes = [...new Set(rows.map((r) => r.tsCode))]
    const nameMap = await this.fetchStockNames(tsCodes)

    return [...grouped.values()].map((g) => {
      const floatRatioPct = g.floatRatio ? g.floatRatio / 100 : 0 // 转为小数（百分比 → 比例）
      const impactScore = Math.min(100, floatRatioPct * 100)
      const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' =
        floatRatioPct >= 0.1 ? 'HIGH' : floatRatioPct >= 0.03 ? 'MEDIUM' : 'LOW'
      const detail: Record<string, unknown> = {
        floatRatio: g.floatRatio ? g.floatRatio / 100 : null,
        floatShare: g.floatShare || null,
        holderCount: g.holderCount,
      }
      return {
        date: g.floatDate,
        tsCode: g.tsCode,
        stockName: nameMap.get(g.tsCode) ?? null,
        type: CalendarEventType.FLOAT,
        title: `限售解禁${g.floatRatio ? ` ${Number(((g.floatRatio / 100) * 100).toFixed(4))}%` : ''}`,
        detail,
        impactScore: Math.round(impactScore * 100) / 100,
        impactLevel,
        isInWatchlist: null,
      }
    })
  }

  private async fetchDividend(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
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
      // impactScore: cashDiv*100 + stkDiv*50；level: ≥3→HIGH, ≥0.5→MEDIUM, LOW
      const impactScore = (cashDiv ?? 0) * 100 + (stkDiv ?? 0) * 50
      const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' = impactScore >= 3 ? 'HIGH' : impactScore >= 0.5 ? 'MEDIUM' : 'LOW'
      return {
        date: dayjs(r.exDate!).format('YYYYMMDD'),
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.DIVIDEND,
        title,
        detail,
        impactScore: Math.round(impactScore * 100) / 100,
        impactLevel,
        isInWatchlist: null,
      }
    })
  }

  private async fetchForecast(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
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
      // impactScore: 取净利润变动幅度绝对值；level: ≥50→HIGH, ≥0→MEDIUM（有变动）, LOW
      const maxAbs = Math.max(Math.abs(pChangeMin ?? 0), Math.abs(pChangeMax ?? 0))
      const impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' = maxAbs >= 50 ? 'HIGH' : maxAbs > 0 ? 'MEDIUM' : 'LOW'
      return {
        date: dayjs(r.annDate!).format('YYYYMMDD'),
        tsCode: r.tsCode,
        stockName: nameMap.get(r.tsCode) ?? null,
        type: CalendarEventType.FORECAST,
        title,
        detail,
        impactScore: Math.round(maxAbs * 100) / 100,
        impactLevel,
        isInWatchlist: null,
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
