import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE, CACHE_TTL_SECONDS } from 'src/constant/cache.constant'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  diffCompactTradeDateFromShanghaiToday,
  formatDateToCompactTradeDate,
  parseCompactTradeDateToUtcDate,
} from 'src/common/utils/trade-date.util'
import { StockDetailChartDto, AdjustType, ChartPeriod } from './dto/stock-detail-chart.dto'

const MAX_CHART_RANGE_DAYS = 3650

// 交易所代码 → 中文名映射
const EXCHANGE_LABEL: Record<string, string> = {
  SSE: '上交所',
  SZSE: '深交所',
  BSE: '北交所',
  HKEX: '港交所',
}

function calcMa(closes: (number | null)[], currentIndex: number, period: number): number | null {
  if (currentIndex < period - 1) return null
  const slice = closes.slice(currentIndex - period + 1, currentIndex + 1)
  if (slice.some((v) => v === null)) return null
  const sum = (slice as number[]).reduce((a, b) => a + b, 0)
  return Math.round((sum / period) * 100) / 100
}

@Injectable()
export class StockDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async getDetailOverview(tsCode: string, tradeDate?: string) {
    const cacheKey = this.cacheService.buildKey(CACHE_KEY_PREFIX.STOCK_OVERVIEW, { tsCode, tradeDate: tradeDate ?? '' })
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_OVERVIEW,
      key: cacheKey,
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_OVERVIEW,
      loader: async () => {
        // Resolve target trade date
        let targetDate: Date | undefined
        if (tradeDate) {
          targetDate = parseCompactTradeDateToUtcDate(tradeDate)
        }

        const [basic, company, latestDaily, latestValuation, latestExpress] = await Promise.all([
          this.prisma.stockBasic.findUnique({ where: { tsCode } }),
          this.prisma.stockCompany.findUnique({ where: { tsCode } }),
          this.prisma.daily.findFirst({
            where: { tsCode, ...(targetDate ? { tradeDate: { lte: targetDate } } : {}) },
            orderBy: { tradeDate: 'desc' },
          }),
          this.prisma.dailyBasic.findFirst({
            where: { tsCode, ...(targetDate ? { tradeDate: { lte: targetDate } } : {}) },
            orderBy: { tradeDate: 'desc' },
          }),
          this.prisma.express.findFirst({ where: { tsCode }, orderBy: { annDate: 'desc' } }),
        ])

        if (!basic) return null

        // Compute quoteStatus: LIVE (<= 5 calendar days old), STALE, or MISSING
        let quoteStatus: 'LIVE' | 'STALE' | 'MISSING' = 'MISSING'
        let latestTradeDate: string | null = null
        if (latestDaily?.tradeDate) {
          latestTradeDate = formatDateToCompactTradeDate(latestDaily.tradeDate)
          const daysAgo = diffCompactTradeDateFromShanghaiToday(latestTradeDate)
          quoteStatus = daysAgo != null && daysAgo <= 5 ? 'LIVE' : 'STALE'
        }

        // Compute todayHeadline
        let todayHeadline: string | null = null
        if (latestDaily) {
          const pctChgNum = latestDaily.pctChg != null ? Number(latestDaily.pctChg) : null
          const amountNum = latestDaily.amount != null ? Number(latestDaily.amount) : null
          const sign = pctChgNum != null ? (pctChgNum >= 0 ? '+' : '') : ''
          const pctStr = pctChgNum != null ? `涨幅 ${sign}${pctChgNum.toFixed(2)}%` : null
          const amtStr = amountNum != null ? `成交额 ${(amountNum / 100000).toFixed(1)}亿` : null
          const peTtm = latestValuation?.peTtm != null ? `PE-TTM ${Number(latestValuation.peTtm).toFixed(1)}x` : null
          todayHeadline = [pctStr, amtStr, peTtm].filter(Boolean).join('，') || null
        }

        // Compute capabilities
        const capabilities = {
          quote: !!latestDaily,
          valuation: !!latestValuation,
          financials: !!latestExpress,
          company: !!company,
        }

        return {
          quoteStatus,
          latestTradeDate,
          capabilities,
          todayHeadline,
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
                tradeDate: latestTradeDate,
                open: latestDaily.open != null ? Number(latestDaily.open) : null,
                high: latestDaily.high != null ? Number(latestDaily.high) : null,
                low: latestDaily.low != null ? Number(latestDaily.low) : null,
                close: latestDaily.close != null ? Number(latestDaily.close) : null,
                preClose: latestDaily.preClose != null ? Number(latestDaily.preClose) : null,
                change: latestDaily.change != null ? Number(latestDaily.change) : null,
                pctChg: latestDaily.pctChg != null ? Number(latestDaily.pctChg) : null,
                vol: latestDaily.vol != null ? Number(latestDaily.vol) : null,
                amount: latestDaily.amount != null ? Number(latestDaily.amount) : null,
              }
            : null,
          latestValuation: latestValuation
            ? {
                tradeDate: formatDateToCompactTradeDate(latestValuation.tradeDate),
                turnoverRate: latestValuation.turnoverRate != null ? Number(latestValuation.turnoverRate) : null,
                turnoverRateF: latestValuation.turnoverRateF != null ? Number(latestValuation.turnoverRateF) : null,
                volumeRatio: latestValuation.volumeRatio != null ? Number(latestValuation.volumeRatio) : null,
                pe: latestValuation.pe != null ? Number(latestValuation.pe) : null,
                peTtm: latestValuation.peTtm != null ? Number(latestValuation.peTtm) : null,
                pb: latestValuation.pb != null ? Number(latestValuation.pb) : null,
                ps: latestValuation.ps != null ? Number(latestValuation.ps) : null,
                psTtm: latestValuation.psTtm != null ? Number(latestValuation.psTtm) : null,
                dvRatio: latestValuation.dvRatio != null ? Number(latestValuation.dvRatio) : null,
                dvTtm: latestValuation.dvTtm != null ? Number(latestValuation.dvTtm) : null,
                totalShare: latestValuation.totalShare != null ? Number(latestValuation.totalShare) : null,
                floatShare: latestValuation.floatShare != null ? Number(latestValuation.floatShare) : null,
                freeShare: latestValuation.freeShare != null ? Number(latestValuation.freeShare) : null,
                totalMv: latestValuation.totalMv != null ? Number(latestValuation.totalMv) : null,
                circMv: latestValuation.circMv != null ? Number(latestValuation.circMv) : null,
                limitStatus: latestValuation.limitStatus,
              }
            : null,
          latestExpress: latestExpress
            ? {
                annDate: latestExpress.annDate,
                endDate: latestExpress.endDate,
                revenue: latestExpress.revenue != null ? Number(latestExpress.revenue) : null,
                nIncome: latestExpress.nIncome != null ? Number(latestExpress.nIncome) : null,
                totalAssets: latestExpress.totalAssets != null ? Number(latestExpress.totalAssets) : null,
                dilutedEps: latestExpress.dilutedEps != null ? Number(latestExpress.dilutedEps) : null,
                dilutedRoe: latestExpress.dilutedRoe != null ? Number(latestExpress.dilutedRoe) : null,
                yoyNetProfit: latestExpress.yoyNetProfit != null ? Number(latestExpress.yoyNetProfit) : null,
                yoySales: latestExpress.yoySales != null ? Number(latestExpress.yoySales) : null,
              }
            : null,
        }
      },
    })
  }

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
      const cutoff = dto.endDate ? this.parseCompactDate(dto.endDate, 'endDate') : new Date()
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
      const { startDate, endDate } = this.resolveChartDateRange(dto, period)
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
    const earlierCheck = await this.prisma.$queryRaw<Array<{ hasMore: boolean }>>`
      SELECT EXISTS(
        SELECT 1
        FROM ${tableName}
        WHERE ts_code = ${tsCode} AND trade_date < ${oldestDate}
      ) AS "hasMore"
    `
    const hasMore = Boolean(earlierCheck[0]?.hasMore)

    return { tsCode, period, adjustType, hasMore, items: seriesWithMa }
  }

  private resolveChartDateRange(dto: StockDetailChartDto, period: ChartPeriod) {
    const defaultDays = period === ChartPeriod.DAILY ? 730 : 1825
    const today = new Date()
    const endDate = dto.endDate ? this.parseCompactDate(dto.endDate, 'endDate') : today
    const startDate = dto.startDate
      ? this.parseCompactDate(dto.startDate, 'startDate')
      : dayjs(endDate).subtract(defaultDays, 'day').toDate()

    const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
    if (rangeDays < 0 || rangeDays > MAX_CHART_RANGE_DAYS) {
      throw new BusinessException(ErrorEnum.INVALID_DATE_RANGE)
    }

    return { startDate, endDate }
  }

  private parseCompactDate(value: string, fieldName: 'startDate' | 'endDate'): Date {
    const normalized = value.trim()
    if (!/^\d{8}$/.test(normalized)) {
      const [code] = ErrorEnum.INVALID_DATE_RANGE.split(':')
      throw new BusinessException(`${code}:${fieldName} 必须为 YYYYMMDD 格式`)
    }

    const year = Number(normalized.slice(0, 4))
    const month = Number(normalized.slice(4, 6))
    const day = Number(normalized.slice(6, 8))
    const parsed = new Date(year, month - 1, day)

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      const [code] = ErrorEnum.INVALID_DATE_RANGE.split(':')
      throw new BusinessException(`${code}:${fieldName} 不是有效日期`)
    }

    return parsed
  }

  async getStockConcepts(tsCode: string) {
    const [memberships, stock] = await Promise.all([
      this.prisma.thsMember.findMany({
        where: { conCode: tsCode },
        include: { board: { select: { tsCode: true, name: true } } },
      }),
      this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { name: true } }),
    ])
    return {
      tsCode,
      name: stock?.name ?? null,
      concepts: memberships.map((m: { board: { tsCode: string; name: string } }) => ({
        tsCode: m.board.tsCode,
        name: m.board.name,
      })),
    }
  }
}
