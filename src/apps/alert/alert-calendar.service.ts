import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { EventStudyService } from 'src/apps/event-study/event-study.service'
import { EventType, EVENT_TYPE_CONFIGS } from 'src/apps/event-study/event-type.registry'
import { CalendarEventDto, CalendarHistoryTrendDto, CalendarResultDto } from './dto/calendar-response.dto'
import { CalendarEventType, CalendarQueryDto, CalendarScope, MarketCapBucket } from './dto/calendar-query.dto'

/** 最大查询跨度（天） */
const MAX_RANGE_DAYS = 90

function toUtcCalendarDate(value: string): Date {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
}

const CALENDAR_TO_EVENT_TYPE: Partial<Record<CalendarEventType, EventType>> = {
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

    // Prisma @db.Date must receive the same civil date carried by YYYYMMDD.
    // A local-midnight Date serialises to the previous UTC day in Asia/Shanghai.
    const startDate = toUtcCalendarDate(query.startDate)
    const endDate = toUtcCalendarDate(query.endDate)
    const types = query.types ?? Object.values(CalendarEventType)
    const tsCode = query.tsCode

    const [
      disclosureEvents,
      floatEvents,
      dividendEvents,
      forecastEvents,
      ipoEvents,
      convertibleEvents,
      shareholderEvents,
    ] = await Promise.all([
      types.includes(CalendarEventType.DISCLOSURE) ? this.fetchDisclosure(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.FLOAT) ? this.fetchFloat(start, end, tsCode) : [],
      types.includes(CalendarEventType.DIVIDEND) ? this.fetchDividend(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.FORECAST) ? this.fetchForecast(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.IPO) ? this.fetchIpo(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.CONVERTIBLE) ? this.fetchConvertible(startDate, endDate, tsCode) : [],
      types.includes(CalendarEventType.SHAREHOLDER) ? this.fetchShareholder(startDate, endDate, tsCode) : [],
    ])

    let allEvents: CalendarEventDto[] = [
      ...disclosureEvents,
      ...floatEvents,
      ...dividendEvents,
      ...forecastEvents,
      ...ipoEvents,
      ...convertibleEvents,
      ...shareholderEvents,
    ]
      // Keep the response contract exact even when a source row matched on an
      // alternate date field or a database date was normalised in another TZ.
      .filter((event) => event.date >= query.startDate && event.date <= query.endDate)
      .sort((a, b) => a.date.localeCompare(b.date))

    const scopeTsCodes = await this.resolveScopeTsCodes(query, userId)
    if (scopeTsCodes) {
      allEvents = allEvents.filter((event) => scopeTsCodes.has(event.tsCode))
    }

    // keyword 过滤（股票代码 / 股票名称 / 事件标题）
    if (query.keyword) {
      const kw = query.keyword.toLowerCase()
      allEvents = allEvents.filter(
        (e) =>
          e.tsCode.toLowerCase().includes(kw) ||
          (e.stockName ?? '').toLowerCase().includes(kw) ||
          e.title.toLowerCase().includes(kw),
      )
    }

    // impactLevels 过滤
    if (query.impactLevels?.length) {
      allEvents = allEvents.filter((e) => e.impactLevel && query.impactLevels!.includes(e.impactLevel as never))
    }

    // isInWatchlist 填充
    if (userId != null && allEvents.length > 0) {
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
    subType?: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarHistoryTrendDto> {
    const calendarType = dto.type as CalendarEventType
    const eventType =
      calendarType === CalendarEventType.SHAREHOLDER
        ? dto.subType === 'IN'
          ? EventType.HOLDER_INCREASE
          : dto.subType === 'DE'
            ? EventType.HOLDER_DECREASE
            : undefined
        : CALENDAR_TO_EVENT_TYPE[calendarType]
    if (!eventType) {
      return { samples: [], average: {} }
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
      average[w] =
        valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10000) / 10000 : null
    }

    return { samples, average }
  }

  private async fetchDisclosure(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
    const startKey = dayjs(startDate).format('YYYYMMDD')
    const endKey = dayjs(endDate).format('YYYYMMDD')
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
      const actualDate = r.actualDate ? dayjs(r.actualDate).format('YYYYMMDD') : null
      const preDate = r.preDate ? dayjs(r.preDate).format('YYYYMMDD') : null
      // A row can match by preDate while actualDate has already moved outside the
      // requested range. Emit the date that satisfied this query, otherwise the
      // client receives an event before startDate (CAL-B07).
      const isActual = actualDate !== null && actualDate >= startKey && actualDate <= endKey
      const date = isActual ? actualDate : preDate!
      const detail: Record<string, unknown> = {
        endDate: r.endDate ? dayjs(r.endDate).format('YYYYMMDD') : null,
        actualDate,
        preDate,
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

  private async fetchIpo(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.stockBasic.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        listDate: { gte: startDate, lte: endDate },
      },
      select: { tsCode: true, name: true, listDate: true, market: true, exchange: true },
    })

    return rows.map((row) => ({
      date: dayjs(row.listDate!).format('YYYYMMDD'),
      tsCode: row.tsCode,
      stockName: row.name ?? null,
      type: CalendarEventType.IPO,
      title: '新股上市',
      detail: { market: row.market, exchange: row.exchange },
      impactScore: 50,
      impactLevel: 'MEDIUM' as const,
      isInWatchlist: null,
    }))
  }

  private async fetchConvertible(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.cbBasic.findMany({
      where: {
        ...(tsCode ? { OR: [{ stkCode: tsCode }, { tsCode }] } : {}),
        listDate: { gte: startDate, lte: endDate },
      },
      select: {
        tsCode: true,
        stkCode: true,
        stkShortName: true,
        bondShortName: true,
        listDate: true,
        issueSize: true,
        issueRating: true,
      },
    })

    return rows.map((row) => ({
      date: dayjs(row.listDate!).format('YYYYMMDD'),
      tsCode: row.stkCode ?? row.tsCode,
      stockName: row.stkShortName ?? row.bondShortName ?? null,
      type: CalendarEventType.CONVERTIBLE,
      title: `${row.bondShortName ?? row.tsCode} 上市`,
      detail: {
        bondCode: row.tsCode,
        bondName: row.bondShortName,
        issueSize: row.issueSize,
        issueRating: row.issueRating,
      },
      impactScore: 40,
      impactLevel: 'MEDIUM' as const,
      isInWatchlist: null,
    }))
  }

  private async fetchShareholder(startDate: Date, endDate: Date, tsCode?: string): Promise<CalendarEventDto[]> {
    const rows = await this.prisma.stkHolderTrade.findMany({
      where: {
        ...(tsCode ? { tsCode } : {}),
        annDate: { gte: startDate, lte: endDate },
      },
      select: {
        tsCode: true,
        annDate: true,
        holderName: true,
        holderType: true,
        inDe: true,
        changeVol: true,
        changeRatio: true,
        avgPrice: true,
      },
    })

    const nameMap = await this.fetchStockNames([...new Set(rows.map((row) => row.tsCode))])

    return rows.map((row) => {
      const changeRatio = row.changeRatio == null ? null : Number(row.changeRatio)
      const impactScore = Math.min(100, Math.abs(changeRatio ?? 0))
      return {
        date: dayjs(row.annDate).format('YYYYMMDD'),
        tsCode: row.tsCode,
        stockName: nameMap.get(row.tsCode) ?? null,
        type: CalendarEventType.SHAREHOLDER,
        subType: row.inDe,
        title: `股东${row.inDe === 'IN' ? '增持' : '减持'} · ${row.holderName}`,
        detail: {
          holderName: row.holderName,
          holderType: row.holderType,
          changeVol: row.changeVol,
          changeRatio,
          avgPrice: row.avgPrice,
        },
        impactScore,
        impactLevel: impactScore >= 5 ? ('HIGH' as const) : impactScore >= 1 ? ('MEDIUM' as const) : ('LOW' as const),
        isInWatchlist: null,
      }
    })
  }

  private async resolveScopeTsCodes(query: CalendarQueryDto, userId?: number): Promise<Set<string> | null> {
    const scope = query.scope ?? CalendarScope.ALL
    if (scope === CalendarScope.ALL) return null
    if (userId == null) throw new BadRequestException('范围筛选需要登录用户')

    if (scope === CalendarScope.WATCHLIST) {
      if (query.watchlistId != null) {
        const watchlist = await this.prisma.watchlist.findFirst({
          where: { id: query.watchlistId, userId },
          select: { stocks: { select: { tsCode: true } } },
        })
        if (!watchlist) throw new NotFoundException('自选股组不存在或无权访问')
        return new Set(watchlist.stocks.map((stock) => stock.tsCode))
      }

      const watchlists = await this.prisma.watchlist.findMany({
        where: { userId },
        select: { stocks: { select: { tsCode: true } } },
      })
      return new Set(watchlists.flatMap((watchlist) => watchlist.stocks.map((stock) => stock.tsCode)))
    }

    if (query.portfolioId) {
      const portfolio = await this.prisma.portfolio.findFirst({
        where: { id: query.portfolioId, userId },
        select: { holdings: { select: { tsCode: true } } },
      })
      if (!portfolio) throw new NotFoundException('投资组合不存在或无权访问')
      return new Set(portfolio.holdings.map((holding) => holding.tsCode))
    }

    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      select: { holdings: { select: { tsCode: true } } },
    })
    return new Set(portfolios.flatMap((portfolio) => portfolio.holdings.map((holding) => holding.tsCode)))
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
