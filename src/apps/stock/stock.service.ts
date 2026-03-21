import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { StockListQueryDto, StockSortBy } from './dto/stock-list-query.dto'
import { StockSearchDto } from './dto/stock-search.dto'

// 排序字段到 SQL 列名的安全映射（value 来自受控枚举，不直接来自用户输入）
const SORT_COLUMN_MAP: Record<StockSortBy, string> = {
  [StockSortBy.TOTAL_MV]: 'db.total_mv',
  [StockSortBy.PCT_CHG]: 'd.pct_chg',
  [StockSortBy.TURNOVER_RATE]: 'db.turnover_rate',
  [StockSortBy.AMOUNT]: 'd.amount',
  [StockSortBy.PE_TTM]: 'db.pe_ttm',
  [StockSortBy.PB]: 'db.pb',
  [StockSortBy.DV_TTM]: 'db.dv_ttm',
  [StockSortBy.LIST_DATE]: 'sb.list_date',
}

export interface StockListRow {
  tsCode: string
  symbol: string | null
  name: string | null
  exchange: string | null
  market: string | null
  industry: string | null
  area: string | null
  listStatus: string | null
  listDate: Date | null
  isHs: string | null
  cnspell: string | null
  peTtm: number | null
  pb: number | null
  dvTtm: number | null
  totalMv: number | null
  circMv: number | null
  turnoverRate: number | null
  pctChg: number | null
  amount: number | null
  close: number | null
  vol: number | null
}

/**
 * StockService
 *
 * 股票查询服务：列表支持分页、关键词搜索、多维筛选和按估值/行情字段排序；
 * 详情返回基础信息 + 公司信息 + 最新日线 / 每日指标 / 复权因子。
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: StockListQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? StockSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

    // 动态 WHERE 条件（基于 stock_basic 字段 + LATERAL join 后的 daily/daily_basic 字段）
    const conditions: Prisma.Sql[] = []

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      conditions.push(
        Prisma.sql`(sb.ts_code ILIKE ${kw} OR sb.name ILIKE ${kw} OR sb.symbol ILIKE ${kw} OR sb.cnspell ILIKE ${kw})`,
      )
    }

    if (query.exchange) {
      conditions.push(Prisma.sql`sb.exchange = ${query.exchange}::"StockExchange"`)
    }

    if (query.listStatus) {
      conditions.push(Prisma.sql`sb.list_status = ${query.listStatus}::"StockListStatus"`)
    }

    if (query.industry) {
      conditions.push(Prisma.sql`sb.industry ILIKE ${'%' + query.industry + '%'}`)
    }

    if (query.area) {
      conditions.push(Prisma.sql`sb.area ILIKE ${'%' + query.area + '%'}`)
    }

    if (query.market) {
      conditions.push(Prisma.sql`sb.market ILIKE ${'%' + query.market + '%'}`)
    }

    if (query.minTotalMv !== undefined) {
      conditions.push(Prisma.sql`db.total_mv >= ${query.minTotalMv}`)
    }

    if (query.maxTotalMv !== undefined) {
      conditions.push(Prisma.sql`db.total_mv <= ${query.maxTotalMv}`)
    }

    if (query.maxPeTtm !== undefined) {
      conditions.push(Prisma.sql`db.pe_ttm <= ${query.maxPeTtm}`)
    }

    if (query.minDvTtm !== undefined) {
      conditions.push(Prisma.sql`db.dv_ttm >= ${query.minDvTtm}`)
    }

    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty

    // 排序列来自受控枚举映射，使用 Prisma.raw 安全注入
    const sortCol = Prisma.raw(SORT_COLUMN_MAP[sortBy])
    const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

    // LATERAL JOIN: 每只股票取最新一条 daily_basic 和 daily
    const [countResult, items] = await Promise.all([
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM stock_basic sb
        LEFT JOIN LATERAL (
          SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
          FROM daily_basic
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC
          LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
          SELECT pct_chg, amount, close, vol
          FROM daily
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC
          LIMIT 1
        ) d ON true
        ${whereClause}
      `,
      this.prisma.$queryRaw<StockListRow[]>`
        SELECT
          sb.ts_code        AS "tsCode",
          sb.symbol,
          sb.name,
          sb.exchange::text AS "exchange",
          sb.market,
          sb.industry,
          sb.area,
          sb.list_status::text AS "listStatus",
          sb.list_date      AS "listDate",
          sb.is_hs          AS "isHs",
          sb.cnspell,
          db.pe_ttm         AS "peTtm",
          db.pb,
          db.dv_ttm         AS "dvTtm",
          db.total_mv       AS "totalMv",
          db.circ_mv        AS "circMv",
          db.turnover_rate  AS "turnoverRate",
          d.pct_chg         AS "pctChg",
          d.amount,
          d.close,
          d.vol
        FROM stock_basic sb
        LEFT JOIN LATERAL (
          SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
          FROM daily_basic
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC
          LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
          SELECT pct_chg, amount, close, vol
          FROM daily
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC
          LIMIT 1
        ) d ON true
        ${whereClause}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    ])

    return {
      page,
      pageSize,
      total: Number(countResult[0]?.count ?? 0),
      items,
    }
  }

  async search({ keyword, limit = 10 }: StockSearchDto) {
    return this.prisma.stockBasic.findMany({
      where: {
        listStatus: 'L' as any,
        OR: [
          { tsCode: { contains: keyword, mode: 'insensitive' } },
          { name: { contains: keyword, mode: 'insensitive' } },
          { symbol: { contains: keyword, mode: 'insensitive' } },
          { cnspell: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      select: {
        tsCode: true,
        symbol: true,
        name: true,
        exchange: true,
        market: true,
        industry: true,
      },
      take: Math.min(limit, 20),
      orderBy: { tsCode: 'asc' },
    })
  }

  async findOne(code: string) {
    const [stock, company, latestDaily, latestDailyBasic, latestAdjFactor] = await this.prisma.$transaction([
      this.prisma.stockBasic.findUnique({
        where: { tsCode: code },
      }),
      this.prisma.stockCompany.findUnique({
        where: { tsCode: code },
      }),
      this.prisma.daily.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.dailyBasic.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.adjFactor.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
    ])

    if (!stock) {
      return null
    }

    return {
      stock,
      company,
      latestDaily,
      latestDailyBasic,
      latestAdjFactor,
    }
  }
}
