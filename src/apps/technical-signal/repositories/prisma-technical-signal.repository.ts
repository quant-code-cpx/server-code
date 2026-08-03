import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { StockExchange } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'

const MAX_HISTORY_ROWS = Number(process.env.TECHNICAL_SIGNAL_MAX_HISTORY_ROWS) || 12_000

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

type CalendarExchange = 'SSE' | 'SZSE'

export interface TechnicalSignalTimelineSnapshot {
  stock: TechnicalSignalStockSnapshot
  dataAsOf: string
  calendarExchange: CalendarExchange
  /** 股票上市至日历未来覆盖末端的交易所开市日，升序。 */
  openDates: string[]
  bars: TechnicalSignalRawBar[]
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
}

/**
 * 技术信号事实数据读取层。这里不计算指标、事件或收益，只提供同一只股票的一致时间线。
 */
@Injectable()
export class PrismaTechnicalSignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadTimeline(input: LoadTechnicalSignalTimelineInput): Promise<TechnicalSignalTimelineSnapshot> {
    if (input.includeBenchmark) {
      // 现有 000300.SH 只有约两年数据；在全历史回补和完整性门禁落地前，绝不返回伪超额收益。
      throw new ConflictException('TECHNICAL_SIGNAL_BENCHMARK_NOT_READY: 000300.SH 全历史基座尚未就绪')
    }

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
    const [dailyWatermark, adjFactorWatermark, dailyVersion, adjFactorVersion, tradeCalVersion, suspendVersion] =
      await Promise.all([
        this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
        this.prisma.adjFactor.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
        this.prisma.daily.findFirst({
          where: { tsCode: input.tsCode },
          orderBy: { syncedAt: 'desc' },
          select: { syncedAt: true },
        }),
        this.prisma.adjFactor.findFirst({
          where: { tsCode: input.tsCode },
          orderBy: { syncedAt: 'desc' },
          select: { syncedAt: true },
        }),
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
    const calendarRows = await this.prisma.tradeCal.findMany({
      where: { exchange: calendarExchange, calDate: { gte: stock.listDate }, isOpen: '1' },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    })
    const openDates = calendarRows
      .map((row) => formatDateToCompactTradeDate(row.calDate))
      .filter((date): date is string => date !== null)
    const asOfIndex = openDates.indexOf(dataAsOf)
    if (asOfIndex < 0) {
      throw new ConflictException(`TECHNICAL_SIGNAL_AS_OF_NOT_OPEN: ${dataAsOf} 不是 ${calendarExchange} 开市日`)
    }
    if (openDates.length - asOfIndex - 1 < input.maxHorizon) {
      throw new ConflictException('TECHNICAL_SIGNAL_DATA_NOT_READY: 交易日历未来 horizon 覆盖不足')
    }

    const [dailyRows, adjFactorRows, suspendRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: stock.listDate, lte: asOfDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, open: true, high: true, low: true, close: true, vol: true },
      }),
      this.prisma.adjFactor.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: stock.listDate, lte: asOfDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, adjFactor: true },
      }),
      this.prisma.suspendD.findMany({
        where: { tsCode: input.tsCode, tradeDate: { gte: listDate, lte: dataAsOf } },
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
    for (const date of openDates.slice(0, asOfIndex + 1)) {
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
      calendarExchange,
      openDates,
      bars,
      suspendedDates,
      dataVersions: {
        tradeCal: `${calendarExchange}:through:${openDates[openDates.length - 1] ?? dataAsOf}:updated:${formatVersionTimestamp(tradeCalVersion?.syncedAt)}`,
        daily: `watermark:${latestDaily}:stockUpdated:${formatVersionTimestamp(dailyVersion?.syncedAt)}`,
        adjFactor: `watermark:${latestAdjFactor}:stockUpdated:${formatVersionTimestamp(adjFactorVersion?.syncedAt)}`,
        suspendD: `rows:${suspendRows.length}:through:${dataAsOf}:stockUpdated:${formatVersionTimestamp(suspendVersion?.syncedAt)}`,
        indexDaily: null,
      },
    }
  }
}

function isAShareExchange(exchange: string): exchange is 'SSE' | 'SZSE' | 'BSE' {
  return exchange === 'SSE' || exchange === 'SZSE' || exchange === 'BSE'
}

function formatVersionTimestamp(value: Date | null | undefined): string {
  return value?.toISOString() ?? 'none'
}
