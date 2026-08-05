import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { StockExchange } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'

const MAX_HISTORY_ROWS = Number(process.env.TECHNICAL_SIGNAL_MAX_HISTORY_ROWS) || 12_000
const HS300_TS_CODE = '000300.SH'
const HS300_FIRST_TRADE_DATE = '20050104'
const HS300_HISTORY_YEARS = 5

export interface TechnicalSignalRawBar {
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  vol: number
  adjFactor: number
}

export interface TechnicalSignalStockSnapshot {
  tsCode: string
  name: string | null
  exchange: StockExchange
  listDate: string
  delistDate: string | null
}

export interface TechnicalSignalBenchmarkBar {
  tradeDate: string
  open: number
  close: number
}

export interface TechnicalSignalBenchmarkSnapshot {
  tsCode: string
  bars: TechnicalSignalBenchmarkBar[]
  version: string
}

type CalendarExchange = 'SSE' | 'SZSE'

export interface TechnicalSignalTimelineSnapshot {
  stock: TechnicalSignalStockSnapshot
  dataAsOf: string
  historyStart: string
  calendarExchange: CalendarExchange
  /** 股票上市至日历未来覆盖末端的交易所开市日，升序。 */
  openDates: string[]
  bars: TechnicalSignalRawBar[]
  benchmark: TechnicalSignalBenchmarkSnapshot | null
  suspendedDates: Set<string>
  dataVersions: {
    tradeCal: string
    daily: string
    adjFactor: string
    suspendD: string
    indexDaily: string | null
  }
}

export interface LoadTechnicalSignalTimelineInput {
  tsCode: string
  requestedAsOf?: string
  maxHorizon: number
  includeBenchmark: boolean
  benchmarkTsCode: string | null
  /** 仅用于当前/近期事件计算；统计接口省略后仍执行上市以来的严格完整性校验。 */
  historyTradeDays?: number
}

/**
 * 技术信号事实数据读取层。这里不计算指标、事件或收益，只提供同一只股票的一致时间线。
 */
@Injectable()
export class PrismaTechnicalSignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolveReadyAsOf(tsCode: string, requestedAsOf?: string): Promise<string> {
    const stock = await this.prisma.stockBasic.findUnique({
      where: { tsCode },
      select: { exchange: true, listDate: true },
    })
    if (!stock?.exchange || !stock.listDate || !isAShareExchange(stock.exchange)) {
      throw new NotFoundException(`STOCK_NOT_FOUND: ${tsCode}`)
    }
    const [dailyWatermark, adjFactorWatermark] = await Promise.all([
      this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
      this.prisma.adjFactor.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
    ])
    const latestDaily = formatDateToCompactTradeDate(dailyWatermark?.tradeDate)
    const latestAdjFactor = formatDateToCompactTradeDate(adjFactorWatermark?.tradeDate)
    if (!latestDaily || !latestAdjFactor) {
      throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 日线或复权因子水位为空')
    }
    const commonWatermark = latestDaily < latestAdjFactor ? latestDaily : latestAdjFactor
    const upperBound = requestedAsOf && requestedAsOf < commonWatermark ? requestedAsOf : commonWatermark
    const listDate = formatDateToCompactTradeDate(stock.listDate)
    if (!listDate || upperBound < listDate) {
      throw new NotFoundException(`STOCK_NOT_FOUND_AT_AS_OF: ${tsCode}@${upperBound}`)
    }
    const calendarExchange: CalendarExchange = stock.exchange === 'SZSE' ? 'SZSE' : 'SSE'
    const ready = await this.prisma.tradeCal.findFirst({
      where: {
        exchange: calendarExchange,
        isOpen: '1',
        calDate: { gte: stock.listDate, lte: parseCompactTradeDateToUtcDate(upperBound) },
      },
      orderBy: { calDate: 'desc' },
      select: { calDate: true },
    })
    const resolved = formatDateToCompactTradeDate(ready?.calDate)
    if (!resolved) throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 没有可用交易日')
    return resolved
  }

  async loadTimeline(input: LoadTechnicalSignalTimelineInput): Promise<TechnicalSignalTimelineSnapshot> {
    const stock = await this.prisma.stockBasic.findUnique({
      where: { tsCode: input.tsCode },
      select: { tsCode: true, name: true, exchange: true, listDate: true, delistDate: true },
    })
    if (!stock || !stock.exchange || !stock.listDate) {
      throw new NotFoundException(`STOCK_NOT_FOUND: ${input.tsCode}`)
    }
    if (!isAShareExchange(stock.exchange)) {
      throw new NotFoundException(`STOCK_NOT_FOUND: ${input.tsCode}`)
    }

    const calendarExchange: CalendarExchange = stock.exchange === 'SZSE' ? 'SZSE' : 'SSE'
    const [dailyWatermark, adjFactorWatermark, tradeCalVersion, suspendVersion] = await Promise.all([
      this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
      this.prisma.adjFactor.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
      this.prisma.tradeCal.findFirst({
        where: { exchange: calendarExchange },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
      this.prisma.suspendD.findFirst({
        where: { tsCode: input.tsCode },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
    ])
    const latestDaily = formatDateToCompactTradeDate(dailyWatermark?.tradeDate)
    const latestAdjFactor = formatDateToCompactTradeDate(adjFactorWatermark?.tradeDate)
    if (!latestDaily || !latestAdjFactor) {
      throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 日线或复权因子水位为空')
    }

    const commonWatermark = latestDaily < latestAdjFactor ? latestDaily : latestAdjFactor
    const dataAsOf = input.requestedAsOf ?? commonWatermark
    if (dataAsOf > commonWatermark) {
      throw new ConflictException(`TECHNICAL_SIGNAL_DATA_NOT_READY: 请求日期超过共同水位 ${commonWatermark}`)
    }

    const listDate = formatDateToCompactTradeDate(stock.listDate)
    if (!listDate) throw new NotFoundException(`STOCK_NOT_FOUND: ${input.tsCode}`)
    const asOfDate = parseCompactTradeDateToUtcDate(dataAsOf)
    const calendarRows = input.historyTradeDays
      ? (
          await Promise.all([
            this.prisma.tradeCal.findMany({
              where: { exchange: calendarExchange, calDate: { gte: stock.listDate, lte: asOfDate }, isOpen: '1' },
              orderBy: { calDate: 'desc' },
              take: Math.max(1, Math.floor(input.historyTradeDays)),
              select: { calDate: true },
            }),
            input.maxHorizon > 0
              ? this.prisma.tradeCal.findMany({
                  where: { exchange: calendarExchange, calDate: { gt: asOfDate }, isOpen: '1' },
                  orderBy: { calDate: 'asc' },
                  take: input.maxHorizon,
                  select: { calDate: true },
                })
              : Promise.resolve([]),
          ])
        ).flat()
      : await this.prisma.tradeCal.findMany({
          where: { exchange: calendarExchange, calDate: { gte: stock.listDate }, isOpen: '1' },
          orderBy: { calDate: 'asc' },
          select: { calDate: true },
        })
    const openDates = calendarRows
      .map((row) => formatDateToCompactTradeDate(row.calDate))
      .filter((date): date is string => date !== null)
      .sort()
    const asOfIndex = openDates.indexOf(dataAsOf)
    if (asOfIndex < 0) {
      throw new ConflictException(`TECHNICAL_SIGNAL_AS_OF_NOT_OPEN: ${dataAsOf} 不是 ${calendarExchange} 开市日`)
    }
    if (openDates.length - asOfIndex - 1 < input.maxHorizon) {
      throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 交易日历未来 horizon 覆盖不足')
    }
    const historyStartIndex = input.historyTradeDays
      ? Math.max(0, asOfIndex - Math.max(1, Math.floor(input.historyTradeDays)) + 1)
      : 0
    const historyStart = openDates[historyStartIndex]
    if (!historyStart) throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 计算窗口没有可用交易日')
    const historyStartDate = parseCompactTradeDateToUtcDate(historyStart)

    const benchmark = input.includeBenchmark
      ? await this.loadBenchmark(input.benchmarkTsCode ?? HS300_TS_CODE, dataAsOf)
      : null

    const [dailyRows, adjFactorRows, suspendRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: historyStartDate, lte: asOfDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true, syncedAt: true },
      }),
      this.prisma.adjFactor.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: historyStartDate, lte: asOfDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, adjFactor: true, syncedAt: true },
      }),
      this.prisma.suspendD.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: historyStart, lte: dataAsOf } },
        select: { tradeDate: true },
      }),
    ])
    if (dailyRows.length > MAX_HISTORY_ROWS) {
      throw new UnprocessableEntityException(
        `TECHNICAL_SIGNAL_HISTORY_LIMIT_EXCEEDED: ${dailyRows.length} > ${MAX_HISTORY_ROWS}`,
      )
    }

    const suspendedDates = new Set(suspendRows.map((row) => row.tradeDate))
    const adjFactorByDate = new Map(
      adjFactorRows
        .map((row) => [formatDateToCompactTradeDate(row.tradeDate), row.adjFactor] as const)
        .filter((row): row is [string, number | null] => row[0] !== null),
    )
    const bars = dailyRows.map((row) => {
      const tradeDate = formatDateToCompactTradeDate(row.tradeDate)
      if (!tradeDate) throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 日线日期无效')
      const adjFactor = adjFactorByDate.get(tradeDate)
      const values = [row.open, row.high, row.low, row.close, row.vol, adjFactor]
      if (values.some((value) => value === null || value === undefined || !Number.isFinite(value))) {
        throw new ConflictException(`TECHNICAL_SIGNAL_DATA_NOT_READY: ${tradeDate} 存在空或非法行情/复权值`)
      }
      const open = row.open as number
      const high = row.high as number
      const low = row.low as number
      const close = row.close as number
      const vol = row.vol as number
      const factor = adjFactor as number
      if (
        open <= 0 ||
        high <= 0 ||
        low <= 0 ||
        close <= 0 ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high) ||
        vol < 0 ||
        factor <= 0
      ) {
        throw new ConflictException(`TECHNICAL_SIGNAL_DATA_NOT_READY: ${tradeDate} 行情/复权值不满足有效性约束`)
      }
      return { tradeDate, open, high, low, close, vol, adjFactor: factor }
    })

    const dailyDates = new Set(bars.map((bar) => bar.tradeDate))
    const delistDate = formatDateToCompactTradeDate(stock.delistDate)
    for (const date of openDates.slice(historyStartIndex, asOfIndex + 1)) {
      if (delistDate && date >= delistDate) break
      if (!dailyDates.has(date) && !suspendedDates.has(date)) {
        throw new ConflictException(`TECHNICAL_SIGNAL_DATA_NOT_READY: ${date} 缺日线且无停牌事实`)
      }
    }

    return {
      stock: {
        tsCode: stock.tsCode,
        name: stock.name,
        exchange: stock.exchange,
        listDate,
        delistDate,
      },
      dataAsOf,
      historyStart,
      calendarExchange,
      openDates,
      bars,
      benchmark,
      suspendedDates,
      dataVersions: {
        tradeCal: `${calendarExchange}:through:${openDates[openDates.length - 1] ?? dataAsOf}:updated:${formatVersionTimestamp(tradeCalVersion?.syncedAt)}`,
        daily: `watermark:${latestDaily}:stockUpdated:${latestSyncTimestamp(dailyRows)}`,
        adjFactor: `watermark:${latestAdjFactor}:stockUpdated:${latestSyncTimestamp(adjFactorRows)}`,
        suspendD: `rows:${suspendRows.length}:through:${dataAsOf}:stockUpdated:${formatVersionTimestamp(suspendVersion?.syncedAt)}`,
        indexDaily: benchmark?.version ?? null,
      },
    }
  }

  private async loadBenchmark(benchmarkTsCode: string, dataAsOf: string): Promise<TechnicalSignalBenchmarkSnapshot> {
    if (benchmarkTsCode !== HS300_TS_CODE) {
      throw new ConflictException(`TECHNICAL_SIGNAL_BENCHMARK_NOT_READY: 不支持基准 ${benchmarkTsCode}`)
    }

    const coverageStartDate = maxTradeDate(HS300_FIRST_TRADE_DATE, subtractCalendarYears(dataAsOf, HS300_HISTORY_YEARS))
    const startDate = parseCompactTradeDateToUtcDate(coverageStartDate)
    const endDate = parseCompactTradeDateToUtcDate(dataAsOf)
    const benchmarkRows =
      dataAsOf < HS300_FIRST_TRADE_DATE
        ? []
        : await this.prisma.indexDaily.findMany({
            where: { tsCode: HS300_TS_CODE, tradeDate: { gte: startDate, lte: endDate } },
            orderBy: { tradeDate: 'asc' },
            select: { tradeDate: true, open: true, close: true, syncedAt: true },
          })
    if (dataAsOf >= HS300_FIRST_TRADE_DATE) {
      const openDays = await this.prisma.tradeCal.findMany({
        where: { exchange: 'SSE', calDate: { gte: startDate, lte: endDate }, isOpen: '1' },
        select: { calDate: true },
      })
      const actualDates = new Set(
        benchmarkRows
          .map((row) => formatDateToCompactTradeDate(row.tradeDate))
          .filter((date): date is string => date !== null),
      )
      if (actualDates.size !== openDays.length) {
        throw new ConflictException('TECHNICAL_SIGNAL_BENCHMARK_NOT_READY: 000300.SH 最近五年覆盖存在缺口')
      }
    }

    const bars = benchmarkRows.map((row) => {
      const tradeDate = formatDateToCompactTradeDate(row.tradeDate)
      if (!tradeDate || !isPositiveFinite(row.open) || !isPositiveFinite(row.close)) {
        throw new ConflictException('TECHNICAL_SIGNAL_BENCHMARK_NOT_READY: 000300.SH 存在非法行情')
      }
      return { tradeDate, open: row.open, close: row.close }
    })
    const latestSyncedAt = benchmarkRows.reduce<Date | null>(
      (latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest),
      null,
    )
    return {
      tsCode: HS300_TS_CODE,
      bars,
      version: `000300.SH:through:${dataAsOf}:updated:${formatVersionTimestamp(latestSyncedAt)}`,
    }
  }
}

function isAShareExchange(exchange: string): exchange is 'SSE' | 'SZSE' | 'BSE' {
  return exchange === 'SSE' || exchange === 'SZSE' || exchange === 'BSE'
}

function formatVersionTimestamp(value: Date | null | undefined): string {
  return value?.toISOString() ?? 'none'
}

function latestSyncTimestamp(rows: readonly { syncedAt?: Date | null }[]): string {
  let latest: Date | null = null
  for (const row of rows) {
    if (row.syncedAt && (!latest || row.syncedAt > latest)) latest = row.syncedAt
  }
  return formatVersionTimestamp(latest)
}

function isPositiveFinite(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function maxTradeDate(left: string, right: string): string {
  return left > right ? left : right
}

function subtractCalendarYears(tradeDate: string, years: number): string {
  const year = Number(tradeDate.slice(0, 4)) - years
  const month = Number(tradeDate.slice(4, 6))
  const day = Number(tradeDate.slice(6, 8))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}${String(month).padStart(2, '0')}${String(Math.min(day, lastDay)).padStart(2, '0')}`
}
