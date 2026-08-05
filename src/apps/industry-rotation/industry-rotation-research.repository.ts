import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'

export interface IndustryResearchBarRow {
  ts_code: string
  name: string
  member_count: number | null
  trade_date: Date
  close: number | null
  open: number | null
  high: number | null
  low: number | null
  pre_close: number | null
  pct_chg: number | null
  vol: number | null
  turnover_rate: number | null
  rn: bigint
}

@Injectable()
export class IndustryRotationResearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findLatestTradeDate(asOfDate?: Date) {
    return this.prisma.thsDaily.findFirst({
      where: asOfDate ? { tradeDate: { lte: asOfDate } } : undefined,
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
  }

  findCatalog(codes?: string[]) {
    return this.prisma.thsIndex.findMany({
      where: { type: 'I', ...(codes?.length ? { tsCode: { in: codes } } : {}) },
      orderBy: { tsCode: 'asc' },
      select: { tsCode: true, name: true, count: true },
    })
  }

  findBars(asOfDate: Date, rowsPerIndustry: number, codes?: string[]) {
    const codeFilter = codes?.length ? Prisma.sql`AND board.ts_code IN (${Prisma.join(codes)})` : Prisma.empty
    return this.prisma.$queryRaw<IndustryResearchBarRow[]>(Prisma.sql`
      SELECT
        board.ts_code,
        board.name,
        board.count AS member_count,
        recent.trade_date,
        recent.close,
        recent.open,
        recent.high,
        recent.low,
        recent.pre_close,
        recent.pct_chg,
        recent.vol,
        recent.turnover_rate,
        ROW_NUMBER() OVER (PARTITION BY board.ts_code ORDER BY recent.trade_date DESC) AS rn
      FROM ths_index_boards board
      CROSS JOIN LATERAL (
        SELECT td.*
        FROM ths_daily td
        WHERE td.ts_code = board.ts_code
          AND td.trade_date <= ${asOfDate}
        ORDER BY td.trade_date DESC
        LIMIT ${rowsPerIndustry}
      ) recent
      WHERE board.type = 'I'
      ${codeFilter}
      ORDER BY board.ts_code ASC, recent.trade_date DESC
    `)
  }

  findFlows(industryNames: string[], asOfDate: Date, days: number) {
    if (!industryNames.length) return Promise.resolve([])
    return this.prisma.$queryRaw<
      Array<{
        name: string
        trade_date: Date
        sample_days: bigint
        cumulative_net: number | null
        average_net: number | null
        latest_net_rate: number | null
      }>
    >(Prisma.sql`
      WITH ranked AS (
        SELECT
          name,
          trade_date,
          net_amount,
          net_amount_rate,
          ROW_NUMBER() OVER (PARTITION BY name ORDER BY trade_date DESC) AS rn
        FROM sector_capital_flows
        WHERE content_type = '行业'
          AND trade_date <= ${asOfDate}
          AND name IN (${Prisma.join(industryNames)})
      )
      SELECT
        name,
        MAX(trade_date) AS trade_date,
        COUNT(*) AS sample_days,
        SUM(net_amount) AS cumulative_net,
        AVG(net_amount) AS average_net,
        MAX(net_amount_rate) FILTER (WHERE rn = 1) AS latest_net_rate
      FROM ranked
      WHERE rn <= ${days}
      GROUP BY name
    `)
  }

  findValuations(industryNames: string[], asOfDate: Date) {
    if (!industryNames.length) return Promise.resolve([])
    return this.prisma.$queryRaw<
      Array<{
        scope: string
        trade_date: Date
        pe_ttm_median: number | null
        pb_median: number | null
        stock_count: number | null
      }>
    >(Prisma.sql`
      WITH ranked AS (
        SELECT
          scope,
          trade_date,
          pe_ttm_median,
          pb_median,
          stock_count,
          ROW_NUMBER() OVER (PARTITION BY scope ORDER BY trade_date DESC) AS rn
        FROM valuation_daily_medians
        WHERE trade_date <= ${asOfDate}
          AND scope IN (${Prisma.join(industryNames)})
      )
      SELECT scope, trade_date, pe_ttm_median, pb_median, stock_count
      FROM ranked
      WHERE rn = 1
    `)
  }
}
