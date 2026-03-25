import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { FinancialSyncService } from 'src/tushare/sync/financial-sync.service'
import { StockListQueryDto, StockSortBy } from './dto/stock-list-query.dto'
import { StockSearchDto } from './dto/stock-search.dto'
import { StockDetailChartDto, AdjustType, ChartPeriod } from './dto/stock-detail-chart.dto'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'

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
    private readonly dividendSyncService: FinancialSyncService,
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
            peTtm: latestValuation.peTtm,
            pb: latestValuation.pb,
            ps: latestValuation.ps,
            dvTtm: latestValuation.dvTtm,
            totalMv: latestValuation.totalMv,
            circMv: latestValuation.circMv,
            volumeRatio: latestValuation.volumeRatio,
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

    // 默认时间范围：最近 2 年（日线），最近 5 年（周/月线）
    const defaultDays = period === ChartPeriod.DAILY ? 730 : 1825
    const startDate = dto.startDate
      ? dayjs(dto.startDate, 'YYYYMMDD').toDate()
      : dayjs().subtract(defaultDays, 'day').toDate()
    const endDate = dto.endDate ? dayjs(dto.endDate, 'YYYYMMDD').toDate() : new Date()

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

    // 查询 OHLCV + 复权因子
    const rows = await this.prisma.$queryRaw<ChartRow[]>`
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

    if (!rows.length) {
      return { tsCode, period, adjustType, items: [] }
    }

    // 计算复权价格
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

    // 计算 MA 指标（仅在 close 可用时）
    const closes = items.map((r) => r.close)
    const seriesWithMa = items.map((row, i) => ({
      ...row,
      ma5: calcMa(closes, i, 5),
      ma10: calcMa(closes, i, 10),
      ma20: calcMa(closes, i, 20),
    }))

    return { tsCode, period, adjustType, items: seriesWithMa }
  }

  // ─── 股票详情：资金流 ─────────────────────────────────────────────────────────

  async getDetailMoneyFlow({ tsCode, days = 60 }: StockDetailMoneyFlowDto) {
    const records = await this.prisma.moneyflowDc.findMany({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })

    // 汇总 5 / 20 / 60 日净流入
    const summarize = (n: number) => records.slice(0, n).reduce((acc, r) => acc + (r.netAmount ?? 0), 0)

    const items = [...records].reverse().map((r) => ({
      tradeDate: r.tradeDate,
      close: r.close,
      pctChange: r.pctChange,
      netAmount: r.netAmount,
      netAmountRate: r.netAmountRate,
      buyElgAmount: r.buyElgAmount,
      buyLgAmount: r.buyLgAmount,
      buyMdAmount: r.buyMdAmount,
      buySmAmount: r.buySmAmount,
    }))

    return {
      tsCode,
      summary: {
        netAmount5d: Math.round(summarize(5) * 100) / 100,
        netAmount20d: Math.round(summarize(20) * 100) / 100,
        netAmount60d: Math.round(summarize(Math.min(60, records.length)) * 100) / 100,
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
    // 如果本地没有该股票的分红数据，触发按需同步
    const localDividendCount = await this.prisma.dividend.count({ where: { tsCode } })
    if (localDividendCount === 0) {
      await this.dividendSyncService.syncDividendsForStock(tsCode).catch(() => {
        // 同步失败不阻断查询，直接返回空
      })
    }

    const [dividends, top10, top10Float] = await Promise.all([
      this.prisma.dividend.findMany({
        where: { tsCode },
        orderBy: { annDate: 'desc' },
        take: 20,
      }),
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

    // 将 top10Holders 按 endDate 分组，返回最新一期
    const latestHolderPeriod = top10[0]?.endDate ?? null
    const latestHolders = latestHolderPeriod
      ? top10.filter((h) => h.endDate.getTime() === latestHolderPeriod.getTime())
      : []

    const latestFloatPeriod = top10Float[0]?.endDate ?? null
    const latestFloatHolders = latestFloatPeriod
      ? top10Float.filter((h) => h.endDate.getTime() === latestFloatPeriod.getTime())
      : []

    return {
      tsCode,
      dividendHistory: dividends.map((d) => ({
        annDate: d.annDate,
        endDate: d.endDate,
        divProc: d.divProc,
        cashDiv: d.cashDiv,
        cashDivTax: d.cashDivTax,
        stkDiv: d.stkDiv,
        exDate: d.exDate,
        payDate: d.payDate,
      })),
      top10Holders: {
        endDate: latestHolderPeriod,
        holders: latestHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holderType: h.holderType,
        })),
      },
      top10FloatHolders: {
        endDate: latestFloatPeriod,
        holders: latestFloatHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holderType: h.holderType,
        })),
      },
    }
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
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function calcMa(closes: (number | null)[], currentIndex: number, period: number): number | null {
  if (currentIndex < period - 1) return null
  const slice = closes.slice(currentIndex - period + 1, currentIndex + 1)
  if (slice.some((v) => v === null)) return null
  const sum = (slice as number[]).reduce((a, b) => a + b, 0)
  return Math.round((sum / period) * 100) / 100
}

// 排序字段到 SQL 列名的安全映射（value 来自受控枚举，不直接来自用户输入）
