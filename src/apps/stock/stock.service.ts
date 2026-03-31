import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import type { RedisClientType } from 'redis'
import { FinancialSyncService } from 'src/tushare/sync/financial-sync.service'
import { StockListQueryDto, StockSortBy } from './dto/stock-list-query.dto'
import { StockSearchDto } from './dto/stock-search.dto'
import { StockDetailChartDto, AdjustType, ChartPeriod } from './dto/stock-detail-chart.dto'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'
import { StockDetailShareCapitalDto } from './dto/stock-detail-share-capital.dto'
import { StockDetailFinancingDto } from './dto/stock-detail-financing.dto'
import { StockDetailFinancialStatementsDto } from './dto/stock-detail-financial-statements.dto'
import { StockScreenerQueryDto, ScreenerSortBy } from './dto/stock-screener-query.dto'

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

// 选股器排序字段安全映射
const SCREENER_SORT_MAP: Record<ScreenerSortBy, string> = {
  [ScreenerSortBy.TOTAL_MV]: 'db.total_mv',
  [ScreenerSortBy.CIRC_MV]: 'db.circ_mv',
  [ScreenerSortBy.PE_TTM]: 'db.pe_ttm',
  [ScreenerSortBy.PB]: 'db.pb',
  [ScreenerSortBy.DV_TTM]: 'db.dv_ttm',
  [ScreenerSortBy.PCT_CHG]: 'd.pct_chg',
  [ScreenerSortBy.TURNOVER_RATE]: 'db.turnover_rate',
  [ScreenerSortBy.AMOUNT]: 'd.amount',
  [ScreenerSortBy.ROE]: 'fi.roe',
  [ScreenerSortBy.REVENUE_YOY]: 'fi.revenue_yoy',
  [ScreenerSortBy.NETPROFIT_YOY]: 'fi.netprofit_yoy',
  [ScreenerSortBy.GROSS_MARGIN]: 'fi.grossprofit_margin',
  [ScreenerSortBy.NET_MARGIN]: 'fi.netprofit_margin',
  [ScreenerSortBy.DEBT_TO_ASSETS]: 'fi.debt_to_assets',
  [ScreenerSortBy.MAIN_NET_INFLOW_5D]: 'mf_agg.main_net_5d',
  [ScreenerSortBy.LIST_DATE]: 'sb.list_date',
}

// 内置选股预设
interface ScreenerPreset {
  id: string
  name: string
  description: string
  filters: Partial<StockScreenerQueryDto>
}

const BUILT_IN_PRESETS: ScreenerPreset[] = [
  {
    id: 'value',
    name: '低估值蓝筹',
    description: 'PE<15, PB<2, 股息率>2%, 市值>100亿',
    filters: {
      maxPeTtm: 15,
      maxPb: 2,
      minDvTtm: 2,
      minTotalMv: 1000000,
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'growth',
    name: '高成长',
    description: '营收增速>20%, 净利增速>20%, ROE>10%',
    filters: {
      minRevenueYoy: 20,
      minNetprofitYoy: 20,
      minRoe: 10,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'quality',
    name: '优质白马',
    description: 'ROE>15%, 毛利率>30%, 资产负债率<60%, 经营现金流/净利>0.8',
    filters: {
      minRoe: 15,
      minGrossMargin: 30,
      maxDebtToAssets: 60,
      minOcfToNetprofit: 0.8,
      sortBy: ScreenerSortBy.ROE,
      sortOrder: 'desc',
    },
  },
  {
    id: 'dividend',
    name: '高股息',
    description: '股息率>3%, PE<20, 市值>50亿',
    filters: {
      minDvTtm: 3,
      maxPeTtm: 20,
      minTotalMv: 500000,
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'small_growth',
    name: '小盘成长',
    description: '市值<100亿, 营收增速>30%, 净利增速>30%',
    filters: {
      maxTotalMv: 1000000,
      minRevenueYoy: 30,
      minNetprofitYoy: 30,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'main_inflow',
    name: '主力资金流入',
    description: '近5日主力净流入>0, 换手率>1%',
    filters: {
      minMainNetInflow5d: 0,
      minTurnoverRate: 1,
      sortBy: ScreenerSortBy.MAIN_NET_INFLOW_5D,
      sortOrder: 'desc',
    },
  },
]

// 交易所代码 → 中文名映射
const EXCHANGE_LABEL: Record<string, string> = {
  SSE: '上交所',
  SZSE: '深交所',
  BSE: '北交所',
  HKEX: '港交所',
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

/**
 * StockService
 *
 * 股票查询服务：
 * - 列表支持分页、关键词搜索、多维筛选和按估值/行情字段排序
 * - 详情拆分为 overview / chart / money-flow / financials / shareholders 五个子接口
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialSyncService: FinancialSyncService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  // ─── 股票列表 ─────────────────────────────────────────────────────────────────

  async findAll(query: StockListQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? StockSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

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
    if (query.minTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv >= ${query.minTotalMv}`)
    if (query.maxTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv <= ${query.maxTotalMv}`)
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

    const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
    const sortCol = Prisma.raw(SORT_COLUMN_MAP[sortBy])
    const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

    const requiresMetricJoinForCount =
      query.minTotalMv !== undefined ||
      query.maxTotalMv !== undefined ||
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

    const countPromise = requiresMetricJoinForCount
      ? this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM stock_basic_profiles sb
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
  }

  // ─── 股票搜索 ─────────────────────────────────────────────────────────────────

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
      select: { tsCode: true, symbol: true, name: true, exchange: true, market: true, industry: true },
      take: Math.min(limit, 20),
      orderBy: { tsCode: 'asc' },
    })
  }

  // ─── 股票详情：总览 ───────────────────────────────────────────────────────────

  async getDetailOverview(tsCode: string) {
    const [basic, company, latestDaily, latestValuation, latestExpress] = await Promise.all([
      this.prisma.stockBasic.findUnique({ where: { tsCode } }),
      this.prisma.stockCompany.findUnique({ where: { tsCode } }),
      this.prisma.daily.findFirst({ where: { tsCode }, orderBy: { tradeDate: 'desc' } }),
      this.prisma.dailyBasic.findFirst({ where: { tsCode }, orderBy: { tradeDate: 'desc' } }),
      this.prisma.express.findFirst({ where: { tsCode }, orderBy: { annDate: 'desc' } }),
    ])

    if (!basic) return null

    return {
      basic: {
        tsCode: basic.tsCode,
        symbol: basic.symbol,
        name: basic.name,
        exchange: EXCHANGE_LABEL[basic.exchange as string] ?? basic.exchange,
        industry: basic.industry,
        market: basic.market,
        area: basic.area,
        listStatus: basic.listStatus,
        listDate: basic.listDate,
        isHs: basic.isHs,
      },
      company: company
        ? {
            chairman: company.chairman,
            manager: company.manager,
            mainBusiness: company.mainBusiness,
            introduction: company.introduction,
            province: company.province,
            city: company.city,
            website: company.website,
            employees: company.employees,
            regCapital: company.regCapital,
          }
        : null,
      latestQuote: latestDaily
        ? {
            tradeDate: latestDaily.tradeDate,
            open: latestDaily.open,
            high: latestDaily.high,
            low: latestDaily.low,
            close: latestDaily.close,
            preClose: latestDaily.preClose,
            change: latestDaily.change,
            pctChg: latestDaily.pctChg,
            vol: latestDaily.vol,
            amount: latestDaily.amount,
          }
        : null,
      latestValuation: latestValuation
        ? {
            tradeDate: latestValuation.tradeDate,
            turnoverRate: latestValuation.turnoverRate,
            turnoverRateF: latestValuation.turnoverRateF,
            volumeRatio: latestValuation.volumeRatio,
            pe: latestValuation.pe,
            peTtm: latestValuation.peTtm,
            pb: latestValuation.pb,
            ps: latestValuation.ps,
            psTtm: latestValuation.psTtm,
            dvRatio: latestValuation.dvRatio,
            dvTtm: latestValuation.dvTtm,
            totalShare: latestValuation.totalShare,
            floatShare: latestValuation.floatShare,
            freeShare: latestValuation.freeShare,
            totalMv: latestValuation.totalMv,
            circMv: latestValuation.circMv,
            limitStatus: latestValuation.limitStatus,
          }
        : null,
      latestExpress: latestExpress
        ? {
            annDate: latestExpress.annDate,
            endDate: latestExpress.endDate,
            revenue: latestExpress.revenue,
            nIncome: latestExpress.nIncome,
            totalAssets: latestExpress.totalAssets,
            dilutedEps: latestExpress.dilutedEps,
            dilutedRoe: latestExpress.dilutedRoe,
            yoyNetProfit: latestExpress.yoyNetProfit,
            yoySales: latestExpress.yoySales,
          }
        : null,
    }
  }

  // ─── 股票详情：K 线图 ────────────────────────────────────────────────────────

  async getDetailChart(dto: StockDetailChartDto) {
    const { tsCode, period = ChartPeriod.DAILY, adjustType = AdjustType.QFQ } = dto

    // 选择表名（日/周/月）
    const tableMap: Record<ChartPeriod, string> = {
      [ChartPeriod.DAILY]: 'stock_daily_prices',
      [ChartPeriod.WEEKLY]: 'stock_weekly_prices',
      [ChartPeriod.MONTHLY]: 'stock_monthly_prices',
    }
    const tableName = Prisma.raw(tableMap[period])

    interface ChartRow {
      tradeDate: Date
      open: number | null
      high: number | null
      low: number | null
      close: number | null
      vol: number | null
      amount: number | null
      pctChg: number | null
      adjFactor: number | null
    }

    let rows: ChartRow[]

    if (dto.limit) {
      // 分页模式：按 tradeDate 倒序取最新 N 条，再翻转为升序供 MA 计算
      const cutoff = dto.endDate ? dayjs(dto.endDate, 'YYYYMMDD').toDate() : new Date()
      const lim = dto.limit
      rows = (
        await this.prisma.$queryRaw<ChartRow[]>`
          SELECT
            t.trade_date  AS "tradeDate",
            t.open, t.high, t.low, t.close, t.vol, t.amount,
            t.pct_chg     AS "pctChg",
            af.adj_factor AS "adjFactor"
          FROM ${tableName} t
          LEFT JOIN stock_adjustment_factors af
            ON af.ts_code = t.ts_code AND af.trade_date = t.trade_date
          WHERE t.ts_code = ${tsCode}
            AND t.trade_date <= ${cutoff}
          ORDER BY t.trade_date DESC
          LIMIT ${lim}
        `
      ).reverse()
    } else {
      // 范围模式：指定起止日期（默认最近 2 年/5 年）
      const defaultDays = period === ChartPeriod.DAILY ? 730 : 1825
      const startDate = dto.startDate
        ? dayjs(dto.startDate, 'YYYYMMDD').toDate()
        : dayjs().subtract(defaultDays, 'day').toDate()
      const endDate = dto.endDate ? dayjs(dto.endDate, 'YYYYMMDD').toDate() : new Date()
      rows = await this.prisma.$queryRaw<ChartRow[]>`
        SELECT
          t.trade_date  AS "tradeDate",
          t.open, t.high, t.low, t.close, t.vol, t.amount,
          t.pct_chg     AS "pctChg",
          af.adj_factor AS "adjFactor"
        FROM ${tableName} t
        LEFT JOIN stock_adjustment_factors af
          ON af.ts_code = t.ts_code AND af.trade_date = t.trade_date
        WHERE t.ts_code = ${tsCode}
          AND t.trade_date >= ${startDate}
          AND t.trade_date <= ${endDate}
        ORDER BY t.trade_date ASC
      `
    }

    if (!rows.length) {
      return { tsCode, period, adjustType, hasMore: false, items: [] }
    }

    // 计算复权价格（rows 此时为升序）
    const latestAdj = rows[rows.length - 1]?.adjFactor ?? 1

    const items = rows.map((row) => {
      const factor = row.adjFactor ?? 1
      let adjMultiplier = 1

      if (adjustType === AdjustType.QFQ) {
        adjMultiplier = factor > 0 ? latestAdj / factor : 1
      } else if (adjustType === AdjustType.HFQ) {
        adjMultiplier = factor
      }

      const round2 = (v: number | null) => (v !== null ? Math.round(v * adjMultiplier * 100) / 100 : null)

      return {
        tradeDate: row.tradeDate,
        open: round2(row.open),
        high: round2(row.high),
        low: round2(row.low),
        close: round2(row.close),
        vol: row.vol,
        amount: row.amount,
        pctChg: row.pctChg,
      }
    })

    // 计算 MA 指标（close 不足时返回 null）
    const closes = items.map((r) => r.close)
    const seriesWithMa = items.map((row, i) => ({
      ...row,
      ma5: calcMa(closes, i, 5),
      ma10: calcMa(closes, i, 10),
      ma20: calcMa(closes, i, 20),
      ma60: calcMa(closes, i, 60),
    }))

    // 判断是否还有更早的历史数据
    const oldestDate = rows[0].tradeDate
    const earlierCheck = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM ${tableName}
      WHERE ts_code = ${tsCode} AND trade_date < ${oldestDate}
    `
    const hasMore = Number(earlierCheck[0]?.count ?? 0) > 0

    return { tsCode, period, adjustType, hasMore, items: seriesWithMa }
  }

  // ─── 股票详情：今日资金流（分级别拆分）────────────────────────────────────────

  async getDetailTodayFlow(tsCode: string) {
    const record = await this.prisma.moneyflow.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
    })

    if (!record) return null

    const r2 = (v: number | null | undefined) => (v != null ? Math.round(v * 100) / 100 : null)

    const buyElg = r2(record.buyElgAmount)
    const sellElg = r2(record.sellElgAmount)
    const buyLg = r2(record.buyLgAmount)
    const sellLg = r2(record.sellLgAmount)
    const buyMd = r2(record.buyMdAmount)
    const sellMd = r2(record.sellMdAmount)
    const buySm = r2(record.buySmAmount)
    const sellSm = r2(record.sellSmAmount)

    const net = (buy: number | null, sell: number | null) => (buy != null && sell != null ? r2(buy - sell) : null)

    const mainBuy = buyElg != null && buyLg != null ? r2(buyElg + buyLg) : null
    const mainSell = sellElg != null && sellLg != null ? r2(sellElg + sellLg) : null

    return {
      tsCode,
      tradeDate: record.tradeDate,
      superLarge: { buyAmount: buyElg, sellAmount: sellElg, netAmount: net(buyElg, sellElg) },
      large: { buyAmount: buyLg, sellAmount: sellLg, netAmount: net(buyLg, sellLg) },
      medium: { buyAmount: buyMd, sellAmount: sellMd, netAmount: net(buyMd, sellMd) },
      small: { buyAmount: buySm, sellAmount: sellSm, netAmount: net(buySm, sellSm) },
      mainForce: { buyAmount: mainBuy, sellAmount: mainSell, netAmount: net(mainBuy, mainSell) },
      netMfAmount: r2(record.netMfAmount),
    }
  }

  // ─── 股票详情：资金流 ─────────────────────────────────────────────────────────

  async getDetailMoneyFlow({ tsCode, days = 60 }: StockDetailMoneyFlowDto) {
    interface MoneyFlowRow {
      tradeDate: Date
      close: number | null
      pctChg: number | null
      netMfAmount: number | null
      buyElgAmount: number | null
      sellElgAmount: number | null
      buyLgAmount: number | null
      sellLgAmount: number | null
      buyMdAmount: number | null
      sellMdAmount: number | null
      buySmAmount: number | null
      sellSmAmount: number | null
    }

    const records = await this.prisma.$queryRaw<MoneyFlowRow[]>`
      SELECT
        mf.trade_date        AS "tradeDate",
        d.close,
        d.pct_chg            AS "pctChg",
        mf.net_mf_amount     AS "netMfAmount",
        mf.buy_elg_amount    AS "buyElgAmount",
        mf.sell_elg_amount   AS "sellElgAmount",
        mf.buy_lg_amount     AS "buyLgAmount",
        mf.sell_lg_amount    AS "sellLgAmount",
        mf.buy_md_amount     AS "buyMdAmount",
        mf.sell_md_amount    AS "sellMdAmount",
        mf.buy_sm_amount     AS "buySmAmount",
        mf.sell_sm_amount    AS "sellSmAmount"
      FROM stock_capital_flows mf
      LEFT JOIN stock_daily_prices d
        ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
      WHERE mf.ts_code = ${tsCode}
      ORDER BY mf.trade_date DESC
      LIMIT ${days}
    `

    // 汇总 5 / 20 / 60 日净流入
    const summarize = (n: number) => records.slice(0, n).reduce((acc, r) => acc + (r.netMfAmount ?? 0), 0)

    const items = [...records].reverse().map((r) => ({
      tradeDate: r.tradeDate,
      close: r.close,
      pctChg: r.pctChg,
      netMfAmount: r.netMfAmount,
      buyElgAmount: r.buyElgAmount,
      sellElgAmount: r.sellElgAmount,
      buyLgAmount: r.buyLgAmount,
      sellLgAmount: r.sellLgAmount,
      buyMdAmount: r.buyMdAmount,
      sellMdAmount: r.sellMdAmount,
      buySmAmount: r.buySmAmount,
      sellSmAmount: r.sellSmAmount,
    }))

    return {
      tsCode,
      summary: {
        netMfAmount5d: Math.round(summarize(5) * 100) / 100,
        netMfAmount20d: Math.round(summarize(20) * 100) / 100,
        netMfAmount60d: Math.round(summarize(Math.min(60, records.length)) * 100) / 100,
      },
      items,
    }
  }

  // ─── 股票详情：财务指标 ───────────────────────────────────────────────────────

  async getDetailFinancials({ tsCode, periods = 8 }: StockDetailFinancialsDto) {
    const finaRecords = await this.prisma.finaIndicator.findMany({
      where: { tsCode },
      orderBy: { endDate: 'desc' },
      take: periods,
    })

    const history = [...finaRecords].reverse().map((r) => ({
      endDate: r.endDate,
      annDate: r.annDate,
      eps: r.eps,
      dtEps: r.dtEps,
      roe: r.roe,
      dtRoe: r.dtRoe,
      roa: r.roa,
      grossprofit_margin: r.grossprofit_margin,
      netprofit_margin: r.netprofit_margin,
      debtToAssets: r.debtToAssets,
      currentRatio: r.currentRatio,
      quickRatio: r.quickRatio,
      revenueYoy: r.revenueYoy,
      netprofitYoy: r.netprofitYoy,
      ocfToNetprofit: r.ocfToNetprofit,
      fcff: r.fcff,
    }))

    const latest = history[history.length - 1] ?? null

    // 同时返回最近几期业绩快报（作为更实时的财务补充）
    const expressRecords = await this.prisma.express.findMany({
      where: { tsCode },
      orderBy: { annDate: 'desc' },
      take: 4,
    })

    return {
      tsCode,
      latest,
      history,
      recentExpress: expressRecords.map((e) => ({
        annDate: e.annDate,
        endDate: e.endDate,
        revenue: e.revenue,
        nIncome: e.nIncome,
        dilutedEps: e.dilutedEps,
        dilutedRoe: e.dilutedRoe,
        yoyNetProfit: e.yoyNetProfit,
        yoySales: e.yoySales,
      })),
    }
  }

  // ─── 股票详情：股东与分红 ─────────────────────────────────────────────────────

  async getDetailShareholders({ tsCode }: StockDetailShareholdersDto) {
    const [top10, top10Float] = await Promise.all([
      // 取最近 4 个报告期的前十大股东
      this.prisma.top10Holders.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 40,
      }),
      this.prisma.top10FloatHolders.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 40,
      }),
    ])

    // 将 top10Holders 按 endDate 分组，返回最新一期，按持股数量降序
    const latestHolderPeriod = top10[0]?.endDate ?? null
    const latestHolders = latestHolderPeriod
      ? top10
          .filter((h) => h.endDate.getTime() === latestHolderPeriod.getTime())
          .sort((a, b) => (b.holdAmount ?? 0) - (a.holdAmount ?? 0))
      : []

    const latestFloatPeriod = top10Float[0]?.endDate ?? null
    const latestFloatHolders = latestFloatPeriod
      ? top10Float
          .filter((h) => h.endDate.getTime() === latestFloatPeriod.getTime())
          .sort((a, b) => (b.holdAmount ?? 0) - (a.holdAmount ?? 0))
      : []

    return {
      tsCode,
      top10Holders: {
        endDate: latestHolderPeriod,
        holders: latestHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holdFloatRatio: h.holdFloatRatio,
          holdChange: h.holdChange,
          holderType: h.holderType,
          annDate: h.annDate,
        })),
      },
      top10FloatHolders: {
        endDate: latestFloatPeriod,
        holders: latestFloatHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holdFloatRatio: h.holdFloatRatio,
          holdChange: h.holdChange,
          holderType: h.holderType,
          annDate: h.annDate,
        })),
      },
    }
  }

  // ─── 股票详情：分红融资 ────────────────────────────────────────────────────────

  async getDetailDividendFinancing({ tsCode }: StockDetailFinancingDto) {
    // 仅返回分红历史（配股逻辑已移除）
    const localDividendCount = await this.prisma.dividend.count({ where: { tsCode } })
    if (localDividendCount === 0) {
      await this.financialSyncService.syncDividendsForStock(tsCode).catch(() => {})
    }

    const dividends = await this.prisma.dividend.findMany({
      where: { tsCode },
      orderBy: { annDate: 'desc' },
    })

    return {
      tsCode,
      dividends: dividends.map((d) => ({
        annDate: d.annDate,
        endDate: d.endDate,
        divProc: d.divProc,
        stkDiv: d.stkDiv,
        stkBoRate: d.stkBoRate,
        stkCoRate: d.stkCoRate,
        cashDiv: d.cashDiv,
        cashDivTax: d.cashDivTax,
        recordDate: d.recordDate,
        exDate: d.exDate,
        payDate: d.payDate,
        divListdate: d.divListdate,
        impAnnDate: d.impAnnDate,
        baseDate: d.baseDate,
        baseShare: d.baseShare,
      })),
    }
  }

  // ─── 股票详情：主力资金流向 ──────────────────────────────────────────────────

  async getDetailMainMoneyFlow({ tsCode, days = 60 }: StockDetailMoneyFlowDto) {
    interface MainFlowRow {
      tradeDate: Date
      close: number | null
      buyElgAmount: number | null
      sellElgAmount: number | null
      buyLgAmount: number | null
      sellLgAmount: number | null
      buyMdAmount: number | null
      sellMdAmount: number | null
      buySmAmount: number | null
      sellSmAmount: number | null
    }

    const records = await this.prisma.$queryRaw<MainFlowRow[]>`
      SELECT
        mf.trade_date        AS "tradeDate",
        d.close,
        mf.buy_elg_amount    AS "buyElgAmount",
        mf.sell_elg_amount   AS "sellElgAmount",
        mf.buy_lg_amount     AS "buyLgAmount",
        mf.sell_lg_amount    AS "sellLgAmount",
        mf.buy_md_amount     AS "buyMdAmount",
        mf.sell_md_amount    AS "sellMdAmount",
        mf.buy_sm_amount     AS "buySmAmount",
        mf.sell_sm_amount    AS "sellSmAmount"
      FROM stock_capital_flows mf
      LEFT JOIN stock_daily_prices d
        ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
      WHERE mf.ts_code = ${tsCode}
      ORDER BY mf.trade_date DESC
      LIMIT ${days}
    `

    // 主力 = 特大单 + 大单；散户 = 中单 + 小单
    const calcMainNet = (r: MainFlowRow) =>
      (r.buyElgAmount ?? 0) + (r.buyLgAmount ?? 0) - (r.sellElgAmount ?? 0) - (r.sellLgAmount ?? 0)
    const calcRetailNet = (r: MainFlowRow) =>
      (r.buyMdAmount ?? 0) + (r.buySmAmount ?? 0) - (r.sellMdAmount ?? 0) - (r.sellSmAmount ?? 0)

    const calculateMainNetFlowSum = (n: number) =>
      Math.round(records.slice(0, n).reduce((acc, r) => acc + calcMainNet(r), 0) * 100) / 100

    const items = [...records].reverse().map((r) => {
      const mainNetAmount = calcMainNet(r)
      const retailNetAmount = calcRetailNet(r)
      const mainBuy = (r.buyElgAmount ?? 0) + (r.buyLgAmount ?? 0)
      const mainSell = (r.sellElgAmount ?? 0) + (r.sellLgAmount ?? 0)
      const mainTotal = mainBuy + mainSell
      const mainNetAmountRate = mainTotal > 0 ? Math.round((mainNetAmount / mainTotal) * 10000) / 100 : null
      return {
        tradeDate: r.tradeDate,
        close: r.close,
        mainNetAmount: Math.round(mainNetAmount * 100) / 100,
        mainNetAmountRate,
        retailNetAmount: Math.round(retailNetAmount * 100) / 100,
      }
    })

    return {
      tsCode,
      summary: {
        mainNetAmount5d: calculateMainNetFlowSum(Math.min(5, records.length)),
        mainNetAmount10d: calculateMainNetFlowSum(Math.min(10, records.length)),
        mainNetAmount20d: calculateMainNetFlowSum(Math.min(20, records.length)),
      },
      items,
    }
  }

  // ─── 股票详情：股本结构 ────────────────────────────────────────────────────────

  async getDetailShareCapital({ tsCode }: StockDetailShareCapitalDto) {
    const latestRecord = await this.prisma.dailyBasic.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true, totalShare: true, floatShare: true, freeShare: true },
    })

    const latest =
      latestRecord && latestRecord.totalShare !== null && latestRecord.floatShare !== null
        ? {
            totalShare: latestRecord.totalShare,
            floatShare: latestRecord.floatShare,
            freeShare: latestRecord.freeShare ?? latestRecord.floatShare,
            restrictedShare: latestRecord.totalShare - latestRecord.floatShare,
            announceDate: latestRecord.tradeDate,
          }
        : null

    // 取年末快照（每年最后一个交易日），最多返回最近 10 年，用于展示股本结构历史变化
    const allRecords = await this.prisma.dailyBasic.findMany({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true, totalShare: true, floatShare: true },
    })

    // 按年分组，保留每年最后一个交易日记录
    const yearEndSnapshots = new Map<
      number,
      { tradeDate: Date; totalShare: number | null; floatShare: number | null }
    >()
    for (const r of allRecords) {
      const year = r.tradeDate.getFullYear()
      if (!yearEndSnapshots.has(year)) {
        yearEndSnapshots.set(year, r)
      }
    }

    const history = [...yearEndSnapshots.values()]
      .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime())
      .slice(0, 10)
      .map((r) => ({
        changeDate: r.tradeDate,
        totalShare: r.totalShare,
        floatShare: r.floatShare,
        changeReason: '定期披露',
      }))

    return { tsCode, latest, history }
  }

  // ─── 股票详情：三大财务报表（利润表/资产负债表/现金流量表） ────────────────────

  async getDetailFinancialStatements({ tsCode, periods = 8 }: StockDetailFinancialStatementsDto) {
    // 多取 4 期以便计算最早一期的同比
    const fetchLimit = periods + 4

    const [incomeRows, balanceRows, cashflowRows] = await Promise.all([
      (this.prisma as any).income.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
      (this.prisma as any).balanceSheet.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
      (this.prisma as any).cashflow.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
    ])

    return {
      tsCode,
      income: buildIncomeItems(incomeRows, periods),
      balanceSheet: buildBalanceSheetItems(balanceRows, periods),
      cashflow: buildCashflowItems(cashflowRows, periods),
    }
  }

  // ─── 股票详情：融资记录 ────────────────────────────────────────────────────────

  async getDetailFinancing({ tsCode }: StockDetailFinancingDto) {
    // 配股表已移除：返回空列表（保留接口兼容）
    return { tsCode, items: [] }
  }

  // ─── 旧接口（兼容保留） ───────────────────────────────────────────────────────

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

  // ─── 选股器 ───────────────────────────────────────────────────────────────────

  async screener(query: StockScreenerQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? ScreenerSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

    // 构建 WHERE 条件
    const conditions: Prisma.Sql[] = [Prisma.sql`sb.list_status = 'L'`]

    if (query.exchange) conditions.push(Prisma.sql`sb.exchange = ${query.exchange}::"StockExchange"`)
    if (query.market) conditions.push(Prisma.sql`sb.market = ${query.market}`)
    if (query.industry) conditions.push(Prisma.sql`sb.industry = ${query.industry}`)
    if (query.area) conditions.push(Prisma.sql`sb.area = ${query.area}`)
    if (query.isHs) conditions.push(Prisma.sql`sb.is_hs = ${query.isHs}`)

    // 估值
    if (query.minPeTtm !== undefined) conditions.push(Prisma.sql`db.pe_ttm >= ${query.minPeTtm}`)
    if (query.maxPeTtm !== undefined) conditions.push(Prisma.sql`db.pe_ttm <= ${query.maxPeTtm}`)
    if (query.minPb !== undefined) conditions.push(Prisma.sql`db.pb >= ${query.minPb}`)
    if (query.maxPb !== undefined) conditions.push(Prisma.sql`db.pb <= ${query.maxPb}`)
    if (query.minDvTtm !== undefined) conditions.push(Prisma.sql`db.dv_ttm >= ${query.minDvTtm}`)
    if (query.minTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv >= ${query.minTotalMv}`)
    if (query.maxTotalMv !== undefined) conditions.push(Prisma.sql`db.total_mv <= ${query.maxTotalMv}`)
    if (query.minCircMv !== undefined) conditions.push(Prisma.sql`db.circ_mv >= ${query.minCircMv}`)
    if (query.maxCircMv !== undefined) conditions.push(Prisma.sql`db.circ_mv <= ${query.maxCircMv}`)
    if (query.minTurnoverRate !== undefined) conditions.push(Prisma.sql`db.turnover_rate >= ${query.minTurnoverRate}`)
    if (query.maxTurnoverRate !== undefined) conditions.push(Prisma.sql`db.turnover_rate <= ${query.maxTurnoverRate}`)

    // 行情
    if (query.minPctChg !== undefined) conditions.push(Prisma.sql`d.pct_chg >= ${query.minPctChg}`)
    if (query.maxPctChg !== undefined) conditions.push(Prisma.sql`d.pct_chg <= ${query.maxPctChg}`)
    if (query.minAmount !== undefined) conditions.push(Prisma.sql`d.amount >= ${query.minAmount}`)
    if (query.maxAmount !== undefined) conditions.push(Prisma.sql`d.amount <= ${query.maxAmount}`)

    // 成长
    if (query.minRevenueYoy !== undefined) conditions.push(Prisma.sql`fi.revenue_yoy >= ${query.minRevenueYoy}`)
    if (query.maxRevenueYoy !== undefined) conditions.push(Prisma.sql`fi.revenue_yoy <= ${query.maxRevenueYoy}`)
    if (query.minNetprofitYoy !== undefined) conditions.push(Prisma.sql`fi.netprofit_yoy >= ${query.minNetprofitYoy}`)
    if (query.maxNetprofitYoy !== undefined) conditions.push(Prisma.sql`fi.netprofit_yoy <= ${query.maxNetprofitYoy}`)

    // 盈利
    if (query.minRoe !== undefined) conditions.push(Prisma.sql`fi.roe >= ${query.minRoe}`)
    if (query.maxRoe !== undefined) conditions.push(Prisma.sql`fi.roe <= ${query.maxRoe}`)
    if (query.minGrossMargin !== undefined) conditions.push(Prisma.sql`fi.grossprofit_margin >= ${query.minGrossMargin}`)
    if (query.maxGrossMargin !== undefined) conditions.push(Prisma.sql`fi.grossprofit_margin <= ${query.maxGrossMargin}`)
    if (query.minNetMargin !== undefined) conditions.push(Prisma.sql`fi.netprofit_margin >= ${query.minNetMargin}`)
    if (query.maxNetMargin !== undefined) conditions.push(Prisma.sql`fi.netprofit_margin <= ${query.maxNetMargin}`)

    // 财务健康
    if (query.maxDebtToAssets !== undefined) conditions.push(Prisma.sql`fi.debt_to_assets <= ${query.maxDebtToAssets}`)
    if (query.minCurrentRatio !== undefined) conditions.push(Prisma.sql`fi.current_ratio >= ${query.minCurrentRatio}`)
    if (query.minQuickRatio !== undefined) conditions.push(Prisma.sql`fi.quick_ratio >= ${query.minQuickRatio}`)

    // 现金流
    if (query.minOcfToNetprofit !== undefined)
      conditions.push(Prisma.sql`fi.ocf_to_netprofit >= ${query.minOcfToNetprofit}`)

    // 资金流
    if (query.minMainNetInflow5d !== undefined)
      conditions.push(Prisma.sql`mf_agg.main_net_5d >= ${query.minMainNetInflow5d}`)
    if (query.minMainNetInflow20d !== undefined)
      conditions.push(Prisma.sql`mf_agg.main_net_20d >= ${query.minMainNetInflow20d}`)

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    const sortCol = Prisma.raw(SCREENER_SORT_MAP[sortBy])
    const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

    // 资金流 JOIN 按需拼接（聚合查询开销较高）
    const moneyflowJoin =
      query.minMainNetInflow5d !== undefined ||
      query.minMainNetInflow20d !== undefined ||
      sortBy === ScreenerSortBy.MAIN_NET_INFLOW_5D
        ? Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT
            SUM(CASE WHEN rn <= 5 THEN
              (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
               + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
            ELSE 0 END) AS main_net_5d,
            SUM(CASE WHEN rn <= 20 THEN
              (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
               + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
            ELSE 0 END) AS main_net_20d
          FROM (
            SELECT *, ROW_NUMBER() OVER (ORDER BY trade_date DESC) AS rn
            FROM stock_capital_flows
            WHERE ts_code = sb.ts_code
          ) sub
          WHERE rn <= 20
        ) mf_agg ON true`
        : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::numeric AS main_net_5d, NULL::numeric AS main_net_20d) mf_agg ON true`

    interface ScreenerRow {
      tsCode: string
      name: string | null
      industry: string | null
      market: string | null
      listDate: Date | null
      close: number | null
      pctChg: number | null
      amount: number | null
      turnoverRate: number | null
      peTtm: number | null
      pb: number | null
      dvTtm: number | null
      totalMv: number | null
      circMv: number | null
      revenueYoy: number | null
      netprofitYoy: number | null
      roe: number | null
      grossMargin: number | null
      netMargin: number | null
      debtToAssets: number | null
      currentRatio: number | null
      quickRatio: number | null
      ocfToNetprofit: number | null
      latestFinDate: Date | null
      mainNetInflow5d: number | null
      mainNetInflow20d: number | null
    }

    const [countResult, items] = await Promise.all([
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM stock_basic_profiles sb
        LEFT JOIN LATERAL (
          SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
          FROM stock_daily_valuation_metrics
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
          SELECT trade_date, close, pct_chg, amount, vol
          FROM stock_daily_prices
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
          SELECT end_date, roe, grossprofit_margin, netprofit_margin,
                 revenue_yoy, netprofit_yoy, debt_to_assets,
                 current_ratio, quick_ratio, ocf_to_netprofit
          FROM financial_indicator_snapshots
          WHERE ts_code = sb.ts_code
          ORDER BY end_date DESC LIMIT 1
        ) fi ON true
        ${moneyflowJoin}
        ${whereClause}
      `,
      this.prisma.$queryRaw<ScreenerRow[]>`
        SELECT
          sb.ts_code            AS "tsCode",
          sb.name,
          sb.industry,
          sb.market,
          sb.list_date          AS "listDate",
          d.close,
          d.pct_chg             AS "pctChg",
          d.amount,
          db.turnover_rate      AS "turnoverRate",
          db.pe_ttm             AS "peTtm",
          db.pb,
          db.dv_ttm             AS "dvTtm",
          db.total_mv           AS "totalMv",
          db.circ_mv            AS "circMv",
          fi.revenue_yoy        AS "revenueYoy",
          fi.netprofit_yoy      AS "netprofitYoy",
          fi.roe,
          fi.grossprofit_margin AS "grossMargin",
          fi.netprofit_margin   AS "netMargin",
          fi.debt_to_assets     AS "debtToAssets",
          fi.current_ratio      AS "currentRatio",
          fi.quick_ratio        AS "quickRatio",
          fi.ocf_to_netprofit   AS "ocfToNetprofit",
          fi.end_date           AS "latestFinDate",
          mf_agg.main_net_5d    AS "mainNetInflow5d",
          mf_agg.main_net_20d   AS "mainNetInflow20d"
        FROM stock_basic_profiles sb
        LEFT JOIN LATERAL (
          SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
          FROM stock_daily_valuation_metrics
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
          SELECT trade_date, close, pct_chg, amount, vol
          FROM stock_daily_prices
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
          SELECT end_date, roe, grossprofit_margin, netprofit_margin,
                 revenue_yoy, netprofit_yoy, debt_to_assets,
                 current_ratio, quick_ratio, ocf_to_netprofit
          FROM financial_indicator_snapshots
          WHERE ts_code = sb.ts_code
          ORDER BY end_date DESC LIMIT 1
        ) fi ON true
        ${moneyflowJoin}
        ${whereClause}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    ])

    const formatDate = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null)

    return {
      page,
      pageSize,
      total: Number(countResult[0]?.count ?? 0),
      items: items.map((r) => ({
        ...r,
        listDate: formatDate(r.listDate),
        latestFinDate: formatDate(r.latestFinDate),
        peTtm: r.peTtm !== null ? Number(r.peTtm) : null,
        pb: r.pb !== null ? Number(r.pb) : null,
        dvTtm: r.dvTtm !== null ? Number(r.dvTtm) : null,
        totalMv: r.totalMv !== null ? Number(r.totalMv) : null,
        circMv: r.circMv !== null ? Number(r.circMv) : null,
        turnoverRate: r.turnoverRate !== null ? Number(r.turnoverRate) : null,
        close: r.close !== null ? Number(r.close) : null,
        pctChg: r.pctChg !== null ? Number(r.pctChg) : null,
        amount: r.amount !== null ? Number(r.amount) : null,
        revenueYoy: r.revenueYoy !== null ? Number(r.revenueYoy) : null,
        netprofitYoy: r.netprofitYoy !== null ? Number(r.netprofitYoy) : null,
        roe: r.roe !== null ? Number(r.roe) : null,
        grossMargin: r.grossMargin !== null ? Number(r.grossMargin) : null,
        netMargin: r.netMargin !== null ? Number(r.netMargin) : null,
        debtToAssets: r.debtToAssets !== null ? Number(r.debtToAssets) : null,
        currentRatio: r.currentRatio !== null ? Number(r.currentRatio) : null,
        quickRatio: r.quickRatio !== null ? Number(r.quickRatio) : null,
        ocfToNetprofit: r.ocfToNetprofit !== null ? Number(r.ocfToNetprofit) : null,
        mainNetInflow5d: r.mainNetInflow5d !== null ? Number(r.mainNetInflow5d) : null,
        mainNetInflow20d: r.mainNetInflow20d !== null ? Number(r.mainNetInflow20d) : null,
      })),
    }
  }

  // ─── 行业列表 ─────────────────────────────────────────────────────────────────

  async getIndustries() {
    const cacheKey = 'stock:industries'
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as { industries: { name: string; count: number }[] }
    }

    interface IndustryRow {
      name: string
      count: bigint
    }

    const rows = await this.prisma.$queryRaw<IndustryRow[]>`
      SELECT industry AS name, COUNT(*)::bigint AS count
      FROM stock_basic_profiles
      WHERE list_status = 'L' AND industry IS NOT NULL AND industry != ''
      GROUP BY industry
      ORDER BY count DESC
    `

    const result = { industries: rows.map((r) => ({ name: r.name, count: Number(r.count) })) }
    await this.redis.setEx(cacheKey, 86400, JSON.stringify(result))
    return result
  }

  // ─── 地域列表 ─────────────────────────────────────────────────────────────────

  async getAreas() {
    const cacheKey = 'stock:areas'
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as { areas: { name: string; count: number }[] }
    }

    interface AreaRow {
      name: string
      count: bigint
    }

    const rows = await this.prisma.$queryRaw<AreaRow[]>`
      SELECT area AS name, COUNT(*)::bigint AS count
      FROM stock_basic_profiles
      WHERE list_status = 'L' AND area IS NOT NULL AND area != ''
      GROUP BY area
      ORDER BY count DESC
    `

    const result = { areas: rows.map((r) => ({ name: r.name, count: Number(r.count) })) }
    await this.redis.setEx(cacheKey, 86400, JSON.stringify(result))
    return result
  }

  // ─── 选股预设 ─────────────────────────────────────────────────────────────────

  getScreenerPresets(): { presets: { id: string; name: string; description: string; filters: Record<string, unknown> }[] } {
    return { presets: BUILT_IN_PRESETS }
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function calcMa(closes: (number | null)[], currentIndex: number, period: number): number | null {
  if (currentIndex < period - 1) return null
  const slice = closes.slice(currentIndex - period + 1, currentIndex + 1)
  if (slice.some((v) => v === null)) return null
  const sum = (slice as number[]).reduce((a, b) => a + b, 0)
  return Math.round((sum / period) * 100) / 100
}

// ─── 三大财务报表工具函数 ──────────────────────────────────────────────────────

/** 将 Date 格式化为 YYYYMMDD 字符串，用于查找同比期 */
function fmtPeriodKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** 返回同比期 key（上一年同季度，YYYYMMDD） */
function prevYearKey(date: Date): string {
  const y = date.getUTCFullYear() - 1
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** 计算同比变动率（%），若上年值为零或空则返回 null */
function yoy(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null
  return Math.round(((curr - prev) / Math.abs(prev)) * 10000) / 100
}

function buildIncomeItems(rows: any[], limit: number) {
  // rows 已按 endDate desc 排序
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      totalRevenue: r.totalRevenue,
      revenue: r.revenue,
      operateProfit: r.operateProfit,
      totalProfit: r.totalProfit,
      nIncome: r.nIncome,
      nIncomeAttrP: r.nIncomeAttrP,
      basicEps: r.basicEps,
      sellExp: r.sellExp,
      adminExp: r.adminExp,
      finExp: r.finExp,
      rdExp: r.rdExp,
      ebit: r.ebit,
      ebitda: r.ebitda,
      totalRevenueYoy: prev ? yoy(r.totalRevenue, prev.totalRevenue) : null,
      nIncomeYoy: prev ? yoy(r.nIncome, prev.nIncome) : null,
      operateProfitYoy: prev ? yoy(r.operateProfit, prev.operateProfit) : null,
    }
  })
}

function buildBalanceSheetItems(rows: any[], limit: number) {
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      totalAssets: r.totalAssets,
      totalCurAssets: r.totalCurAssets,
      totalNca: r.totalNca,
      moneyCap: r.moneyCap,
      inventories: r.inventories,
      accountsReceiv: r.accountsReceiv,
      totalLiab: r.totalLiab,
      totalCurLiab: r.totalCurLiab,
      totalNcl: r.totalNcl,
      stBorr: r.stBorr,
      ltBorr: r.ltBorr,
      totalHldrEqyExcMinInt: r.totalHldrEqyExcMinInt,
      totalHldrEqyIncMinInt: r.totalHldrEqyIncMinInt,
      totalAssetsYoy: prev ? yoy(r.totalAssets, prev.totalAssets) : null,
      equityYoy: prev ? yoy(r.totalHldrEqyExcMinInt, prev.totalHldrEqyExcMinInt) : null,
    }
  })
}

function buildCashflowItems(rows: any[], limit: number) {
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      nCashflowAct: r.nCashflowAct,
      nCashflowInvAct: r.nCashflowInvAct,
      nCashFlowsFncAct: r.nCashFlowsFncAct,
      freeCashflow: r.freeCashflow,
      nIncrCashCashEqu: r.nIncrCashCashEqu,
      cFrSaleSg: r.cFrSaleSg,
      cPaidGoodsS: r.cPaidGoodsS,
      nCashflowActYoy: prev ? yoy(r.nCashflowAct, prev.nCashflowAct) : null,
      freeCashflowYoy: prev ? yoy(r.freeCashflow, prev.freeCashflow) : null,
    }
  })
}

// 排序字段到 SQL 列名的安全映射（value 来自受控枚举，不直接来自用户输入）
