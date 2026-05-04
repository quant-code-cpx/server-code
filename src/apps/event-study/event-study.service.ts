import { Injectable } from '@nestjs/common'
import { StockExchange } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { EVENT_TYPE_CONFIGS, EventType, EventTypeConfig } from './event-type.registry'
import { EventStudyAnalyzeDto } from './dto/event-study-analyze.dto'
import { EventStudyEventsQueryDto } from './dto/event-study-events-query.dto'
import { EventSampleDto, EventStudyResultDto } from './dto/event-study-response.dto'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** DateTime → 'YYYY-MM-DD' string */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 'YYYYMMDD' → Date */
function parseYMD(s: string): Date {
  return parseCompactTradeDateToUtcDate(s)
}

/** Calendar date + n days */
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

/** Round to n decimal places */
function round(v: number, n: number): number {
  const f = 10 ** n
  return Math.round(v * f) / f
}

/** Standard normal CDF (Abramowitz & Stegun) */
function normalCDF(x: number): number {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x) / Math.SQRT2
  const t = 1.0 / (1.0 + p * ax)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return 0.5 * (1 + sign * y)
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface EventRecord {
  tsCode: string
  /** 'YYYY-MM-DD' */
  eventDate: string
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class EventStudyService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  getEventTypes(): EventTypeConfig[] {
    return Object.values(EVENT_TYPE_CONFIGS)
  }

  getEventSchema(eventType: EventType) {
    const config = EVENT_TYPE_CONFIGS[eventType]
    const fieldMap: Record<EventType, Array<{ name: string; label: string; type: string; operators: string[] }>> = {
      [EventType.FORECAST]: [
        { name: 'annDate', label: '公告日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'type', label: '预告类型', type: 'string', operators: ['eq', 'in'] },
        { name: 'pChangeMin', label: '净利润变动下限(%)', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
        { name: 'pChangeMax', label: '净利润变动上限(%)', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.DIVIDEND_EX]: [
        { name: 'exDate', label: '除权除息日', type: 'date', operators: ['gte', 'lte'] },
        { name: 'stkDiv', label: '送转股比例', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
        { name: 'cashDivTax', label: '税前现金分红', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.HOLDER_INCREASE]: [
        { name: 'annDate', label: '公告日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'changeVol', label: '变动数量', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
        { name: 'changeRatio', label: '变动比例', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.HOLDER_DECREASE]: [
        { name: 'annDate', label: '公告日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'changeVol', label: '变动数量', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
        { name: 'changeRatio', label: '变动比例', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.SHARE_FLOAT]: [
        { name: 'floatDate', label: '解禁日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'floatRatio', label: '解禁比例', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.REPURCHASE]: [
        { name: 'annDate', label: '公告日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'amount', label: '回购金额', type: 'number', operators: ['gte', 'lte', 'gt', 'lt'] },
      ],
      [EventType.AUDIT_QUALIFIED]: [
        { name: 'annDate', label: '公告日期', type: 'date', operators: ['gte', 'lte'] },
        { name: 'auditResult', label: '审计意见', type: 'string', operators: ['eq', 'in'] },
      ],
      [EventType.DISCLOSURE]: [
        { name: 'actualDate', label: '实际披露日', type: 'date', operators: ['gte', 'lte'] },
        { name: 'period', label: '报告期', type: 'string', operators: ['eq', 'in'] },
      ],
    }

    return {
      eventType,
      label: config.label,
      description: config.description,
      dateField: this.getEventDateField(eventType),
      stockField: 'tsCode',
      fields: fieldMap[eventType],
    }
  }

  async queryEvents(dto: EventStudyEventsQueryDto): Promise<{ total: number; items: unknown[] }> {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const skip = (page - 1) * pageSize

    const startDate = dto.startDate ? parseYMD(dto.startDate) : new Date('2015-01-01')
    const endDate = dto.endDate ? parseYMD(dto.endDate) : new Date()
    const tsCodeFilter = dto.tsCode ? { tsCode: dto.tsCode } : {}

    switch (dto.eventType) {
      case EventType.FORECAST: {
        const [total, items] = await Promise.all([
          this.prisma.forecast.count({ where: { annDate: { gte: startDate, lte: endDate }, ...tsCodeFilter } }),
          this.prisma.forecast.findMany({
            where: { annDate: { gte: startDate, lte: endDate }, ...tsCodeFilter },
            orderBy: { annDate: 'desc' },
            skip,
            take: pageSize,
          }),
        ])
        return { total, items }
      }
      case EventType.DIVIDEND_EX: {
        const where = { exDate: { gte: startDate, lte: endDate }, divProc: '实施', ...tsCodeFilter }
        const [total, items] = await Promise.all([
          this.prisma.dividend.count({ where }),
          this.prisma.dividend.findMany({ where, orderBy: { exDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.HOLDER_INCREASE: {
        const where = { annDate: { gte: startDate, lte: endDate }, inDe: 'IN', ...tsCodeFilter }
        const [total, items] = await Promise.all([
          this.prisma.stkHolderTrade.count({ where }),
          this.prisma.stkHolderTrade.findMany({ where, orderBy: { annDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.HOLDER_DECREASE: {
        const where = { annDate: { gte: startDate, lte: endDate }, inDe: 'DE', ...tsCodeFilter }
        const [total, items] = await Promise.all([
          this.prisma.stkHolderTrade.count({ where }),
          this.prisma.stkHolderTrade.findMany({ where, orderBy: { annDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.SHARE_FLOAT: {
        const startStr = dto.startDate ?? '20150101'
        const endStr = dto.endDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const where = { floatDate: { gte: startStr, lte: endStr }, ...(dto.tsCode ? { tsCode: dto.tsCode } : {}) }
        const [total, items] = await Promise.all([
          this.prisma.shareFloat.count({ where }),
          this.prisma.shareFloat.findMany({ where, orderBy: { floatDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.REPURCHASE: {
        const where = { annDate: { gte: startDate, lte: endDate }, ...tsCodeFilter }
        const [total, items] = await Promise.all([
          this.prisma.repurchase.count({ where }),
          this.prisma.repurchase.findMany({ where, orderBy: { annDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.AUDIT_QUALIFIED: {
        const where = {
          annDate: { gte: startDate, lte: endDate },
          auditResult: { not: '标准无保留意见' },
          ...tsCodeFilter,
        }
        const [total, items] = await Promise.all([
          this.prisma.finaAudit.count({ where }),
          this.prisma.finaAudit.findMany({ where, orderBy: { annDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
      case EventType.DISCLOSURE: {
        const where = { actualDate: { gte: startDate, lte: endDate }, ...tsCodeFilter }
        const [total, items] = await Promise.all([
          this.prisma.disclosureDate.count({ where }),
          this.prisma.disclosureDate.findMany({ where, orderBy: { actualDate: 'desc' }, skip, take: pageSize }),
        ])
        return { total, items }
      }
    }
  }

  async analyze(dto: EventStudyAnalyzeDto): Promise<EventStudyResultDto> {
    const config = EVENT_TYPE_CONFIGS[dto.eventType]
    const preDays = dto.preDays ?? 5
    const postDays = dto.postDays ?? 20
    const benchmarkCode = dto.benchmarkCode ?? '000300.SH'
    const windowSize = preDays + 1 + postDays

    // Step 1: Extract event samples (max 2000)
    const events = await this.extractEventSamples(dto)

    if (events.length === 0) {
      return this.buildEmptyResult(dto, config, preDays, postDays, benchmarkCode)
    }

    // Step 2: Compute date range for batch loading
    const dates = events.map((e) => e.eventDate)
    const minDate = dates.reduce((a, b) => (a < b ? a : b))
    const maxDate = dates.reduce((a, b) => (a > b ? a : b))
    const bufferDays = Math.ceil((preDays + postDays) * 2.5) + 30
    const rangeStart = addDays(new Date(minDate), -bufferDays)
    const rangeEnd = addDays(new Date(maxDate), bufferDays)

    // Step 3: Load trade calendar (SSE open days)
    const tradeDays = await this.loadTradeDays(rangeStart, rangeEnd)

    // Step 4: Batch load benchmark returns
    const benchMap = await this.loadIndexReturns(benchmarkCode, rangeStart, rangeEnd)

    // Step 5: Batch load stock returns
    const uniqueTsCodes = [...new Set(events.map((e) => e.tsCode))]
    const stockMap = await this.loadStockReturns(uniqueTsCodes, rangeStart, rangeEnd)

    // Step 6: Load stock names
    const nameMap = await this.loadStockNames(uniqueTsCodes)

    // Step 7: Compute AR series per event
    const validSamples: EventSampleDto[] = []
    for (const event of events) {
      const sample = this.computeEventAR(
        event.tsCode,
        event.eventDate,
        preDays,
        postDays,
        tradeDays,
        stockMap,
        benchMap,
        nameMap.get(event.tsCode) ?? null,
      )
      if (sample) validSamples.push(sample)
    }

    // Step 8: Aggregate AAR / CAAR
    const { aarSeries, caarSeries } = this.aggregateAAR(validSamples, windowSize)

    // Step 9: t-test on final CAR
    const { tStatistic, pValue } = this.tTest(validSamples)

    // Step 10: Sort for top/bottom
    const sorted = [...validSamples].sort((a, b) => b.car - a.car)

    return {
      eventType: dto.eventType,
      eventLabel: config.label,
      sampleCount: validSamples.length,
      window: `[-${preDays}, +${postDays}]`,
      benchmark: benchmarkCode,
      aarSeries,
      caarSeries,
      caar: caarSeries.at(-1) ?? 0,
      tStatistic,
      pValue,
      topSamples: sorted.slice(0, 10),
      bottomSamples: sorted.slice(-10).reverse(),
    }
  }

  // ── Private: Event extraction ─────────────────────────────────────────────

  async extractEventSamples(dto: EventStudyAnalyzeDto): Promise<EventRecord[]> {
    const startDate = dto.startDate ? parseYMD(dto.startDate) : new Date('2015-01-01')
    const endDate = dto.endDate ? parseYMD(dto.endDate) : new Date()
    const tsCodeFilter = dto.tsCode ? { tsCode: dto.tsCode } : {}
    const limit = 2000

    switch (dto.eventType) {
      case EventType.FORECAST: {
        const rows = await this.prisma.forecast.findMany({
          where: { annDate: { gte: startDate, lte: endDate }, ...tsCodeFilter },
          select: { tsCode: true, annDate: true },
          orderBy: { annDate: 'desc' },
          distinct: ['tsCode', 'annDate'],
          take: limit,
        })
        return rows.map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.annDate) }))
      }
      case EventType.DIVIDEND_EX: {
        const rows = await this.prisma.dividend.findMany({
          where: { exDate: { gte: startDate, lte: endDate }, divProc: '实施', ...tsCodeFilter },
          select: { tsCode: true, exDate: true },
          orderBy: { exDate: 'desc' },
          distinct: ['tsCode', 'exDate'],
          take: limit,
        })
        return rows.filter((r) => r.exDate != null).map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.exDate!) }))
      }
      case EventType.HOLDER_INCREASE: {
        const rows = await this.prisma.stkHolderTrade.findMany({
          where: { annDate: { gte: startDate, lte: endDate }, inDe: 'IN', ...tsCodeFilter },
          select: { tsCode: true, annDate: true },
          orderBy: { annDate: 'desc' },
          distinct: ['tsCode', 'annDate'],
          take: limit,
        })
        return rows.map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.annDate) }))
      }
      case EventType.HOLDER_DECREASE: {
        const rows = await this.prisma.stkHolderTrade.findMany({
          where: { annDate: { gte: startDate, lte: endDate }, inDe: 'DE', ...tsCodeFilter },
          select: { tsCode: true, annDate: true },
          orderBy: { annDate: 'desc' },
          distinct: ['tsCode', 'annDate'],
          take: limit,
        })
        return rows.map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.annDate) }))
      }
      case EventType.SHARE_FLOAT: {
        // floatDate is String in YYYYMMDD format
        const startStr = dto.startDate ?? '20150101'
        const endStr = dto.endDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const rows = await this.prisma.shareFloat.findMany({
          where: { floatDate: { gte: startStr, lte: endStr }, ...(dto.tsCode ? { tsCode: dto.tsCode } : {}) },
          select: { tsCode: true, floatDate: true },
          orderBy: { floatDate: 'desc' },
          distinct: ['tsCode', 'floatDate'],
          take: limit,
        })
        // Convert YYYYMMDD → YYYY-MM-DD
        return rows.map((r) => ({
          tsCode: r.tsCode,
          eventDate: `${r.floatDate.slice(0, 4)}-${r.floatDate.slice(4, 6)}-${r.floatDate.slice(6, 8)}`,
        }))
      }
      case EventType.REPURCHASE: {
        const rows = await this.prisma.repurchase.findMany({
          where: { annDate: { gte: startDate, lte: endDate }, ...tsCodeFilter },
          select: { tsCode: true, annDate: true },
          orderBy: { annDate: 'desc' },
          distinct: ['tsCode', 'annDate'],
          take: limit,
        })
        return rows.map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.annDate) }))
      }
      case EventType.AUDIT_QUALIFIED: {
        const rows = await this.prisma.finaAudit.findMany({
          where: {
            annDate: { gte: startDate, lte: endDate },
            auditResult: { not: '标准无保留意见' },
            ...tsCodeFilter,
          },
          select: { tsCode: true, annDate: true },
          orderBy: { annDate: 'desc' },
          distinct: ['tsCode', 'annDate'],
          take: limit,
        })
        return rows.map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.annDate) }))
      }
      case EventType.DISCLOSURE: {
        const rows = await this.prisma.disclosureDate.findMany({
          where: { actualDate: { gte: startDate, lte: endDate }, ...tsCodeFilter },
          select: { tsCode: true, actualDate: true },
          orderBy: { actualDate: 'desc' },
          distinct: ['tsCode', 'actualDate'],
          take: limit,
        })
        return rows
          .filter((r) => r.actualDate != null)
          .map((r) => ({ tsCode: r.tsCode, eventDate: toDateStr(r.actualDate!) }))
      }
    }
  }

  getEventDateField(eventType: EventType): string {
    switch (eventType) {
      case EventType.DIVIDEND_EX:
        return 'exDate'
      case EventType.SHARE_FLOAT:
        return 'floatDate'
      case EventType.DISCLOSURE:
        return 'actualDate'
      default:
        return 'annDate'
    }
  }

  formatEventDateValue(value: unknown): string | null {
    if (value instanceof Date) return formatDateToCompactTradeDate(value)
    if (typeof value === 'string') return value.replace(/-/g, '').slice(0, 8)
    return null
  }

  // ── Private: Data loading ─────────────────────────────────────────────────

  private async loadTradeDays(start: Date, end: Date): Promise<string[]> {
    const rows = await this.prisma.tradeCal.findMany({
      where: { exchange: StockExchange.SSE, calDate: { gte: start, lte: end }, isOpen: '1' },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    })
    return rows.map((r) => toDateStr(r.calDate))
  }

  private async loadIndexReturns(tsCode: string, start: Date, end: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.indexDaily.findMany({
      where: { tsCode, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, pctChg: true },
    })
    const map = new Map<string, number>()
    for (const r of rows) map.set(toDateStr(r.tradeDate), r.pctChg ?? 0)
    return map
  }

  private async loadStockReturns(tsCodes: string[], start: Date, end: Date): Promise<Map<string, number>> {
    if (tsCodes.length === 0) return new Map()
    const rows = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: { gte: start, lte: end } },
      select: { tsCode: true, tradeDate: true, pctChg: true },
    })
    const map = new Map<string, number>()
    for (const r of rows) map.set(`${r.tsCode}:${toDateStr(r.tradeDate)}`, r.pctChg ?? 0)
    return map
  }

  private async loadStockNames(tsCodes: string[]): Promise<Map<string, string>> {
    if (tsCodes.length === 0) return new Map()
    const rows = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const map = new Map<string, string>()
    for (const r of rows) {
      if (r.name) map.set(r.tsCode, r.name)
    }
    return map
  }

  // ── Private: Computation ──────────────────────────────────────────────────

  private computeEventAR(
    tsCode: string,
    eventDate: string,
    preDays: number,
    postDays: number,
    tradeDays: string[],
    stockMap: Map<string, number>,
    benchMap: Map<string, number>,
    stockName: string | null,
  ): EventSampleDto | null {
    // Find first trade day >= eventDate (T=0)
    const eventIdx = tradeDays.findIndex((d) => d >= eventDate)
    // Require sufficient pre-window and post-window data
    if (eventIdx === -1 || eventIdx < preDays || eventIdx + postDays >= tradeDays.length) {
      return null
    }

    const arSeries: number[] = []
    for (let i = eventIdx - preDays; i <= eventIdx + postDays; i++) {
      const date = tradeDays[i]
      const stockRet = stockMap.get(`${tsCode}:${date}`) ?? 0
      const benchRet = benchMap.get(date) ?? 0
      arSeries.push(round(stockRet - benchRet, 4))
    }

    const car = round(
      arSeries.reduce((sum, ar) => sum + ar, 0),
      4,
    )

    return { tsCode, name: stockName, eventDate, car, arSeries }
  }

  private aggregateAAR(samples: EventSampleDto[], windowSize: number): { aarSeries: number[]; caarSeries: number[] } {
    const n = samples.length
    if (n === 0) return { aarSeries: [], caarSeries: [] }

    const aarRaw = new Array(windowSize).fill(0) as number[]
    for (const sample of samples) {
      for (let t = 0; t < windowSize && t < sample.arSeries.length; t++) {
        aarRaw[t] += sample.arSeries[t] / n
      }
    }

    const aarSeries = aarRaw.map((v) => round(v, 4))
    const caarSeries: number[] = []
    let cumSum = 0
    for (const aar of aarSeries) {
      cumSum += aar
      caarSeries.push(round(cumSum, 4))
    }

    return { aarSeries, caarSeries }
  }

  private tTest(samples: EventSampleDto[]): { tStatistic: number; pValue: number } {
    const n = samples.length
    if (n < 2) return { tStatistic: 0, pValue: 1 }

    const cars = samples.map((s) => s.car)
    const mean = cars.reduce((a, b) => a + b, 0) / n
    const variance = cars.reduce((sum, c) => sum + (c - mean) ** 2, 0) / (n - 1)
    const se = Math.sqrt(variance / n)
    const tStat = se > 0 ? mean / se : 0
    const pValue = 2 * (1 - normalCDF(Math.abs(tStat)))

    return { tStatistic: round(tStat, 4), pValue: round(pValue, 6) }
  }

  private buildEmptyResult(
    dto: EventStudyAnalyzeDto,
    config: EventTypeConfig,
    preDays: number,
    postDays: number,
    benchmark: string,
  ): EventStudyResultDto {
    return {
      eventType: dto.eventType,
      eventLabel: config.label,
      sampleCount: 0,
      window: `[-${preDays}, +${postDays}]`,
      benchmark,
      aarSeries: [],
      caarSeries: [],
      caar: 0,
      tStatistic: 0,
      pValue: 1,
      topSamples: [],
      bottomSamples: [],
    }
  }
}
