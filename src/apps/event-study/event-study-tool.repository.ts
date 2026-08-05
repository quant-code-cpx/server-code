import { Injectable } from '@nestjs/common'
import { Prisma, StockExchange } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'

export interface EventStudyPriceWindow {
  eventKey: string
  tsCode: string
  startDate: Date
  endDate: Date
}

@Injectable()
export class EventStudyToolRepository {
  constructor(private readonly prisma: PrismaService) {}

  findTradeDays(startDate: Date, endDate: Date) {
    return this.prisma.tradeCal.findMany({
      where: { exchange: StockExchange.SSE, calDate: { gte: startDate, lte: endDate }, isOpen: '1' },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    })
  }

  findBenchmarkReturns(benchmarkCode: string, startDate: Date, endDate: Date) {
    return this.prisma.indexDaily.findMany({
      where: { tsCode: benchmarkCode, tradeDate: { gte: startDate, lte: endDate }, pctChg: { not: null } },
      select: { tradeDate: true, pctChg: true },
      orderBy: { tradeDate: 'asc' },
    })
  }

  async findBenchmarkDataThrough(benchmarkCode: string) {
    const row = await this.prisma.indexDaily.findFirst({
      where: { tsCode: benchmarkCode, pctChg: { not: null } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return row?.tradeDate ?? null
  }

  async findWindowReturns(windows: EventStudyPriceWindow[]) {
    if (!windows.length) return []
    const result: Array<{ eventKey: string; tradeDate: Date; pctChg: number | null }> = []
    for (let offset = 0; offset < windows.length; offset += 200) {
      const chunk = windows.slice(offset, offset + 200)
      const values = Prisma.join(
        chunk.map(
          (window) =>
            Prisma.sql`(${window.eventKey}, ${window.tsCode}, ${window.startDate}::date, ${window.endDate}::date)`,
        ),
      )
      const rows = await this.prisma.$queryRaw<Array<{ eventKey: string; tradeDate: Date; pctChg: number | null }>>(
        Prisma.sql`
          SELECT w.event_key AS "eventKey", d.trade_date AS "tradeDate", d.pct_chg AS "pctChg"
          FROM (VALUES ${values}) AS w(event_key, ts_code, start_date, end_date)
          JOIN stock_daily_prices d
            ON d.ts_code = w.ts_code
           AND d.trade_date BETWEEN w.start_date AND w.end_date
          WHERE d.pct_chg IS NOT NULL
          ORDER BY w.event_key ASC, d.trade_date ASC
        `,
      )
      result.push(...rows)
    }
    return result
  }

  findStockNames(tsCodes: string[]) {
    return this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
  }
}
