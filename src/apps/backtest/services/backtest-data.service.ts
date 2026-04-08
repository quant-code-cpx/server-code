import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { DailyBar } from '../types/backtest-engine.types'

@Injectable()
export class BacktestDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Load all trading days in a date range (SSE, isOpen='1') */
  async getTradingDays(startDate: Date, endDate: Date): Promise<Date[]> {
    const rows = await this.prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        calDate: { gte: startDate, lte: endDate },
        isOpen: '1',
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    })
    return rows.map((r) => r.calDate)
  }

  /** Load daily bars + adj factors + stk_limit + suspend for given tsCodes and date range */
  async loadDailyBars(tsCodes: string[], startDate: Date, endDate: Date): Promise<Map<string, Map<string, DailyBar>>> {
    if (tsCodes.length === 0) return new Map()

    // Fetch all needed data in parallel
    const [dailyRows, adjRows, limitRows, suspendRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode: { in: tsCodes }, tradeDate: { gte: startDate, lte: endDate } },
        select: {
          tsCode: true,
          tradeDate: true,
          open: true,
          high: true,
          low: true,
          close: true,
          preClose: true,
          vol: true,
        },
      }),
      this.prisma.adjFactor.findMany({
        where: { tsCode: { in: tsCodes }, tradeDate: { gte: startDate, lte: endDate } },
        select: { tsCode: true, tradeDate: true, adjFactor: true },
      }),
      this.prisma.stkLimit.findMany({
        where: {
          tsCode: { in: tsCodes },
          tradeDate: {
            gte: startDate.toISOString().slice(0, 10).replace(/-/g, ''),
            lte: endDate.toISOString().slice(0, 10).replace(/-/g, ''),
          },
        },
        select: { tsCode: true, tradeDate: true, upLimit: true, downLimit: true },
      }),
      this.prisma.suspendD.findMany({
        where: {
          tsCode: { in: tsCodes },
          tradeDate: {
            gte: startDate.toISOString().slice(0, 10).replace(/-/g, ''),
            lte: endDate.toISOString().slice(0, 10).replace(/-/g, ''),
          },
        },
        select: { tsCode: true, tradeDate: true },
      }),
    ])

    // Build lookup maps
    const adjMap = new Map<string, number>()
    for (const r of adjRows) {
      const key = `${r.tsCode}:${r.tradeDate.toISOString().slice(0, 10)}`
      adjMap.set(key, r.adjFactor ?? 1)
    }

    // Find the latest adjFactor per tsCode (the one with the highest tradeDate)
    // adjRows are ordered ascending by tradeDate, so the last entry per tsCode is the latest
    const latestAdjByCode = adjRows.reduceRight<Map<string, number>>((map, r) => {
      if (!map.has(r.tsCode)) {
        map.set(r.tsCode, r.adjFactor ?? 1)
      }
      return map
    }, new Map<string, number>())

    const limitMap = new Map<string, { up: number | null; down: number | null }>()
    for (const r of limitRows) {
      const dateStr = this.formatStkDate(r.tradeDate)
      limitMap.set(`${r.tsCode}:${dateStr}`, {
        up: r.upLimit ? Number(r.upLimit) : null,
        down: r.downLimit ? Number(r.downLimit) : null,
      })
    }

    const suspendSet = new Set<string>()
    for (const r of suspendRows) {
      const dateStr = this.formatStkDate(r.tradeDate)
      suspendSet.add(`${r.tsCode}:${dateStr}`)
    }

    // Build result: Map<tsCode, Map<dateStr, DailyBar>>
    const result = new Map<string, Map<string, DailyBar>>()
    for (const r of dailyRows) {
      const dateStr = r.tradeDate.toISOString().slice(0, 10)
      const key = `${r.tsCode}:${dateStr}`
      const limit = limitMap.get(key)
      const adjFactor = adjMap.get(key) ?? null
      const latestAdj = latestAdjByCode.get(r.tsCode) ?? null

      // Compute forward-adjusted prices (前复权)
      let adjClose: number | null = null
      let adjOpen: number | null = null
      let adjHigh: number | null = null
      let adjLow: number | null = null
      if (adjFactor !== null && latestAdj !== null && latestAdj !== 0) {
        const ratio = adjFactor / latestAdj
        adjClose = r.close !== null ? Number(r.close) * ratio : null
        adjOpen = r.open !== null ? Number(r.open) * ratio : null
        adjHigh = r.high !== null ? Number(r.high) * ratio : null
        adjLow = r.low !== null ? Number(r.low) * ratio : null
      }

      const bar: DailyBar = {
        tsCode: r.tsCode,
        tradeDate: r.tradeDate,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        preClose: r.preClose,
        vol: r.vol,
        adjFactor,
        upLimit: limit?.up ?? null,
        downLimit: limit?.down ?? null,
        isSuspended: suspendSet.has(key),
        adjClose,
        adjOpen,
        adjHigh,
        adjLow,
      }

      if (!result.has(r.tsCode)) result.set(r.tsCode, new Map())
      result.get(r.tsCode)!.set(dateStr, bar)
    }

    return result
  }

  /** Load benchmark index daily prices */
  async loadBenchmarkBars(tsCode: string, startDate: Date, endDate: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.indexDaily.findMany({
      where: { tsCode, tradeDate: { gte: startDate, lte: endDate } },
      select: { tradeDate: true, close: true, open: true },
      orderBy: { tradeDate: 'asc' },
    })
    const result = new Map<string, number>()
    for (const r of rows) {
      const dateStr = r.tradeDate.toISOString().slice(0, 10)
      result.set(dateStr, r.close ?? r.open ?? 0)
    }
    return result
  }

  /** Get index constituents for a given universe and date (latest available) */
  async getIndexConstituents(indexCode: string, date: Date): Promise<string[]> {
    const tradeDateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
    // Find the latest available trade date in index_constituent_weights <= date
    const latest = await this.prisma.$queryRaw<Array<{ trade_date: string }>>`
      SELECT trade_date FROM index_constituent_weights
      WHERE index_code = ${indexCode} AND trade_date <= ${tradeDateStr}
      ORDER BY trade_date DESC LIMIT 1
    `
    if (!latest.length) return []
    const latestDate = latest[0].trade_date

    const rows = await this.prisma.indexWeight.findMany({
      where: { indexCode, tradeDate: latestDate },
      select: { conCode: true },
    })
    return rows.map((r) => r.conCode)
  }

  /** Get all listed stocks (ALL_A universe) for a given date */
  async getAllListedStocks(date: Date, minDaysListed = 60): Promise<string[]> {
    const minListDate = new Date(date.getTime() - minDaysListed * 24 * 60 * 60 * 1000)
    const rows = await this.prisma.stockBasic.findMany({
      where: {
        listStatus: 'L',
        listDate: { lte: minListDate },
      },
      select: { tsCode: true },
    })
    return rows.map((r) => r.tsCode)
  }

  /** Format stk_limit/suspend trade_date (YYYYMMDD or YYYY-MM-DD) to YYYY-MM-DD */
  private formatStkDate(raw: string): string {
    if (raw.length === 8) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    }
    return raw.slice(0, 10)
  }
}
