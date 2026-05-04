import { Injectable } from '@nestjs/common'
import { Prisma, StockListStatus } from '@prisma/client'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE, CACHE_TTL_SECONDS } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
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
  fullname: string | null
  exchange: string | null
  currType: string | null
  market: string | null
  industry: string | null
  area: string | null
  listStatus: string | null
  listDate: Date | null
  latestTradeDate: Date | null
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

@Injectable()
export class StockListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /** 把 query 中所有过滤条件转换为 SQL 片段数组（供 findAll / getListSummary 共用）*/
  private buildListConditions(query: StockListQueryDto): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = []

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      conditions.push(
        Prisma.sql`(sb.ts_code ILIKE ${kw} OR sb.name ILIKE ${kw} OR sb.symbol ILIKE ${kw} OR sb.cnspell ILIKE ${kw})`,
      )
    }

    if (query.exchange) conditions.push(Prisma.sql`sb.exchange = ${query.exchange}::"StockExchange"`)
    if (query.listStatus) conditions.push(Prisma.sql`sb.list_status = ${query.listStatus}::"StockListStatus"`)
    if (query.industry) conditions.push(Prisma.sql`sb.industry ILIKE ${'%' + query.industry + '%'}`)
    if (query.area) conditions.push(Prisma.sql`sb.area ILIKE ${'%' + query.area + '%'}`)
    if (query.market) conditions.push(Prisma.sql`sb.market ILIKE ${'%' + query.market + '%'}`)
    if (query.isHs) conditions.push(Prisma.sql`sb.is_hs = ${query.isHs}`)
    if (query.industries?.length) conditions.push(Prisma.sql`sb.industry = ANY(${query.industries})`)
    if (query.areas?.length) conditions.push(Prisma.sql`sb.area = ANY(${query.areas})`)
    if (query.minTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv >= ${query.minTotalMv}`)
    if (query.maxTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv <= ${query.maxTotalMv}`)
    if (query.minPeTtm !== undefined) conditions.push(Prisma.sql`db.pe_ttm >= ${query.minPeTtm}`)
    if (query.maxPeTtm !== undefined) conditions.push(Prisma.sql`db.pe_ttm <= ${query.maxPeTtm}`)
    if (query.minPb !== undefined) conditions.push(Prisma.sql`db.pb >= ${query.minPb}`)
    if (query.maxPb !== undefined) conditions.push(Prisma.sql`db.pb <= ${query.maxPb}`)
    if (query.minDvTtm !== undefined) conditions.push(Prisma.sql`db.dv_ttm >= ${query.minDvTtm}`)
    if (query.minTurnoverRate !== undefined) conditions.push(Prisma.sql`db.turnover_rate >= ${query.minTurnoverRate}`)
    if (query.maxTurnoverRate !== undefined) conditions.push(Prisma.sql`db.turnover_rate <= ${query.maxTurnoverRate}`)
    if (query.minPctChg !== undefined) conditions.push(Prisma.sql`d.pct_chg >= ${query.minPctChg}`)
    if (query.maxPctChg !== undefined) conditions.push(Prisma.sql`d.pct_chg <= ${query.maxPctChg}`)
    if (query.minAmount !== undefined) conditions.push(Prisma.sql`d.amount >= ${query.minAmount}`)
    if (query.maxAmount !== undefined) conditions.push(Prisma.sql`d.amount <= ${query.maxAmount}`)

    return conditions
  }

  /** 是否有需要 valuation/market metric 表 JOIN 的条件（用于 count 优化）*/
  private requiresMetricJoin(query: StockListQueryDto): boolean {
    return (
      query.minTotalMv !== undefined ||
      query.maxTotalMv !== undefined ||
      query.minPeTtm !== undefined ||
      query.maxPeTtm !== undefined ||
      query.minPb !== undefined ||
      query.maxPb !== undefined ||
      query.minDvTtm !== undefined ||
      query.minTurnoverRate !== undefined ||
      query.maxTurnoverRate !== undefined ||
      query.minPctChg !== undefined ||
      query.maxPctChg !== undefined ||
      query.minAmount !== undefined ||
      query.maxAmount !== undefined
    )
  }

  async findAll(query: StockListQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? StockSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_LIST,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.STOCK_LIST, {
        ...query,
        page,
        pageSize,
        sortBy,
        sortOrder,
      }),
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_LIST,
      loader: async () => {
        const conditions = this.buildListConditions(query)

        const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
        const sortCol = Prisma.raw(SORT_COLUMN_MAP[sortBy])
        const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

        const needsConceptJoin = !!query.conceptCodes?.length
        const conceptJoinSql = needsConceptJoin
          ? Prisma.sql`INNER JOIN ths_index_members tm ON tm.con_code = sb.ts_code AND tm.is_new = 'Y'
              AND tm.ts_code = ANY(${query.conceptCodes!})`
          : Prisma.empty

        const countPromise =
          this.requiresMetricJoin(query) || needsConceptJoin
            ? this.prisma.$queryRaw<[{ count: bigint }]>`
              SELECT COUNT(*)::bigint AS count
              FROM stock_basic_profiles sb
              ${conceptJoinSql}
              LEFT JOIN LATERAL (
                SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
                FROM stock_daily_valuation_metrics WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
              ) db ON true
              LEFT JOIN LATERAL (
                SELECT pct_chg, amount, close, vol
                FROM stock_daily_prices WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
              ) d ON true
              ${whereClause}
            `
            : this.prisma.$queryRaw<[{ count: bigint }]>`
              SELECT COUNT(*)::bigint AS count
              FROM stock_basic_profiles sb
              ${whereClause}
            `

        const [countResult, items] = await Promise.all([
          countPromise,
          this.prisma.$queryRaw<StockListRow[]>`
            SELECT
              sb.ts_code            AS "tsCode",   sb.symbol,    sb.name, sb.fullname,
              sb.exchange::text     AS "exchange",  sb.curr_type AS "currType", sb.market,    sb.industry,
              sb.area,              sb.list_status::text AS "listStatus",
              sb.list_date          AS "listDate",  d.trade_date AS "latestTradeDate", sb.is_hs AS "isHs", sb.cnspell,
              db.pe_ttm AS "peTtm", db.pb,          db.dv_ttm AS "dvTtm",
              db.total_mv AS "totalMv", db.circ_mv AS "circMv", db.turnover_rate AS "turnoverRate",
              d.pct_chg AS "pctChg", d.amount, d.close, d.vol
            FROM stock_basic_profiles sb
            ${conceptJoinSql}
            LEFT JOIN LATERAL (
              SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
              FROM stock_daily_valuation_metrics WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
            ) db ON true
            LEFT JOIN LATERAL (
              SELECT trade_date, pct_chg, amount, close, vol
              FROM stock_daily_prices WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
            ) d ON true
            ${whereClause}
            ORDER BY ${sortCol} ${sortDir}
            LIMIT ${pageSize} OFFSET ${offset}
          `,
        ])

        return { page, pageSize, total: Number(countResult[0]?.count ?? 0), items }
      },
    })
  }

  /** 供导出用：不分页，最多 5000 条，不走缓存 */
  async findAllForExport(query: StockListQueryDto): Promise<StockListRow[]> {
    const sortBy = query.sortBy ?? StockSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

    const conditions = this.buildListConditions(query)
    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
    const sortCol = Prisma.raw(SORT_COLUMN_MAP[sortBy])
    const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

    const conceptJoinSql = query.conceptCodes?.length
      ? Prisma.sql`INNER JOIN ths_index_members tm ON tm.con_code = sb.ts_code AND tm.is_new = 'Y'
          AND tm.ts_code = ANY(${query.conceptCodes})`
      : Prisma.empty

    return this.prisma.$queryRaw<StockListRow[]>`
      SELECT
        sb.ts_code            AS "tsCode",   sb.symbol,    sb.name, sb.fullname,
        sb.exchange::text     AS "exchange",  sb.curr_type AS "currType", sb.market,    sb.industry,
        sb.area,              sb.list_status::text AS "listStatus",
        sb.list_date          AS "listDate",  d.trade_date AS "latestTradeDate", sb.is_hs AS "isHs", sb.cnspell,
        db.pe_ttm AS "peTtm", db.pb,          db.dv_ttm AS "dvTtm",
        db.total_mv AS "totalMv", db.circ_mv AS "circMv", db.turnover_rate AS "turnoverRate",
        d.pct_chg AS "pctChg", d.amount, d.close, d.vol
      FROM stock_basic_profiles sb
      ${conceptJoinSql}
      LEFT JOIN LATERAL (
        SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
        FROM stock_daily_valuation_metrics WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
      ) db ON true
      LEFT JOIN LATERAL (
        SELECT trade_date, pct_chg, amount, close, vol
        FROM stock_daily_prices WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
      ) d ON true
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT 5000
    `
  }

  async getListSummary(query: StockListQueryDto) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_LIST,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.STOCK_LIST, { ...query, _summary: true }),
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_LIST,
      loader: async () => {
        const conditions = this.buildListConditions(query)
        const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty

        const conceptJoinSql = query.conceptCodes?.length
          ? Prisma.sql`INNER JOIN ths_index_members tm ON tm.con_code = sb.ts_code AND tm.is_new = 'Y'
              AND tm.ts_code = ANY(${query.conceptCodes})`
          : Prisma.empty

        type SummaryRow = {
          latestTradeDate: Date | null
          upCount: bigint
          downCount: bigint
          flatCount: bigint
          totalAmount: string | null
          missingQuoteCount: bigint
          staleCount: bigint
        }

        const [row] = await this.prisma.$queryRaw<SummaryRow[]>`
          SELECT
            MAX(d.trade_date)                                                          AS "latestTradeDate",
            COUNT(CASE WHEN d.pct_chg > 0  THEN 1 END)::bigint                        AS "upCount",
            COUNT(CASE WHEN d.pct_chg < 0  THEN 1 END)::bigint                        AS "downCount",
            COUNT(CASE WHEN d.pct_chg = 0  THEN 1 END)::bigint                        AS "flatCount",
            SUM(d.amount)::text                                                        AS "totalAmount",
            COUNT(CASE WHEN d.trade_date IS NULL      THEN 1 END)::bigint              AS "missingQuoteCount",
            COUNT(CASE WHEN d.trade_date IS NOT NULL
                        AND d.trade_date < (SELECT MAX(trade_date) FROM stock_daily_prices)
                       THEN 1 END)::bigint                                             AS "staleCount"
          FROM stock_basic_profiles sb
          ${conceptJoinSql}
          LEFT JOIN LATERAL (
            SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
            FROM stock_daily_valuation_metrics WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
          ) db ON true
          LEFT JOIN LATERAL (
            SELECT trade_date, pct_chg, amount
            FROM stock_daily_prices WHERE ts_code = sb.ts_code ORDER BY trade_date DESC LIMIT 1
          ) d ON true
          ${whereClause}
        `

        return {
          latestTradeDate: row?.latestTradeDate ?? null,
          upCount: Number(row?.upCount ?? 0),
          downCount: Number(row?.downCount ?? 0),
          flatCount: Number(row?.flatCount ?? 0),
          totalAmount: row?.totalAmount != null ? Number(row.totalAmount) : null,
          missingQuoteCount: Number(row?.missingQuoteCount ?? 0),
          staleCount: Number(row?.staleCount ?? 0),
        }
      },
    })
  }

  async search({ keyword, limit = 10 }: StockSearchDto) {
    const normalizedKeyword = keyword.trim()
    const safeLimit = Math.min(limit, 20)

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_SEARCH,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.STOCK_SEARCH, {
        keyword: normalizedKeyword,
        limit: safeLimit,
      }),
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_SEARCH,
      loader: () =>
        this.prisma.stockBasic.findMany({
          where: {
            listStatus: StockListStatus.L,
            OR: [
              { tsCode: { contains: normalizedKeyword, mode: 'insensitive' } },
              { name: { contains: normalizedKeyword, mode: 'insensitive' } },
              { symbol: { contains: normalizedKeyword, mode: 'insensitive' } },
              { cnspell: { contains: normalizedKeyword, mode: 'insensitive' } },
            ],
          },
          select: { tsCode: true, symbol: true, name: true, exchange: true, market: true, industry: true },
          take: safeLimit,
          orderBy: { tsCode: 'asc' },
        }),
    })
  }

  async findOne(code: string) {
    const [stock, company, latestDaily, latestDailyBasic, latestAdjFactor] = await Promise.all([
      this.prisma.stockBasic.findUnique({ where: { tsCode: code } }),
      this.prisma.stockCompany.findUnique({ where: { tsCode: code } }),
      this.prisma.daily.findFirst({ where: { tsCode: code }, orderBy: { tradeDate: 'desc' } }),
      this.prisma.dailyBasic.findFirst({ where: { tsCode: code }, orderBy: { tradeDate: 'desc' } }),
      this.prisma.adjFactor.findFirst({ where: { tsCode: code }, orderBy: { tradeDate: 'desc' } }),
    ])

    if (!stock) return null

    return { stock, company, latestDaily, latestDailyBasic, latestAdjFactor }
  }
}
