import { Injectable } from '@nestjs/common'
import { MoneyflowContentType } from '@prisma/client'
import * as dayjs from 'dayjs'
// use require for plugins to ensure compatibility with commonjs output
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
import { PrismaService } from 'src/shared/prisma.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * MarketService
 *
 * 基于已同步入库的各类数据表提供市场总览查询：
 * - 大盘资金流向 (moneyflow_mkt_dc)
 * - 行业板块资金流向 (moneyflow_ind_dc)
 * - 市场情绪统计 (daily)
 * - 市场整体估值 PE/PB 分位 (daily_basic)
 * - 核心指数行情 (index_daily)
 * - 沪深港通北向/南向资金 (moneyflow_hsgt)
 */
@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── 大盘资金流向 ──────────────────────────────────────────────────────────

  async getMarketMoneyFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestMarketTradeDate()
    if (!tradeDate) {
      return []
    }

    return this.prisma.moneyflowMktDc.findMany({
      where: { tradeDate },
      orderBy: { tradeDate: 'desc' },
    })
  }

  // ─── 行业板块资金流向 ──────────────────────────────────────────────────────

  async getSectorFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) {
      return {
        tradeDate: null,
        industry: [],
        concept: [],
        region: [],
      }
    }

    const rows = await this.prisma.moneyflowIndDc.findMany({
      where: { tradeDate },
      orderBy: [{ contentType: 'asc' }, { rank: 'asc' }, { netAmount: 'desc' }],
    })

    return {
      tradeDate,
      industry: rows.filter((item) => item.contentType === MoneyflowContentType.INDUSTRY),
      concept: rows.filter((item) => item.contentType === MoneyflowContentType.CONCEPT),
      region: rows.filter((item) => item.contentType === MoneyflowContentType.REGION),
    }
  }

  // ─── 市场情绪（涨跌家数统计）─────────────────────────────────────────────

  async getMarketSentiment(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) {
      return null
    }

    const [bigRise, rise, flat, fall, bigFall] = await Promise.all([
      this.prisma.daily.count({ where: { tradeDate, pctChg: { gte: 5 } } }),
      this.prisma.daily.count({ where: { tradeDate, pctChg: { gte: 0.001, lt: 5 } } }),
      this.prisma.daily.count({ where: { tradeDate, pctChg: { gte: -0.001, lte: 0.001 } } }),
      this.prisma.daily.count({ where: { tradeDate, pctChg: { gt: -5, lt: -0.001 } } }),
      this.prisma.daily.count({ where: { tradeDate, pctChg: { lte: -5 } } }),
    ])

    return {
      tradeDate,
      bigRise,
      rise,
      flat,
      fall,
      bigFall,
      total: bigRise + rise + flat + fall + bigFall,
    }
  }

  // ─── 市场整体估值（PE/PB 分位）────────────────────────────────────────────

  async getMarketValuation(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestDailyBasicTradeDate()
    if (!tradeDate) {
      return { tradeDate: null, peTtmMedian: null, pbMedian: null, peTtmPercentile: { oneYear: null, threeYear: null, fiveYear: null }, pbPercentile: { oneYear: null, threeYear: null, fiveYear: null } }
    }

    // 当日 PE/PB 中位数（使用 PostgreSQL percentile_cont 函数）
    const currentMedian = await this.prisma.$queryRaw<{ pe_ttm_median: number; pb_median: number }[]>`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm) AS pe_ttm_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)     AS pb_median
      FROM stock_daily_valuation_metrics
      WHERE trade_date = ${tradeDate}
        AND pe_ttm > 0 AND pe_ttm < 1000
        AND pb > 0
    `
    const peTtmMedian = currentMedian[0]?.pe_ttm_median ?? null
    const pbMedian = currentMedian[0]?.pb_median ?? null

    // 历史分位：取各窗口内每日中位数，再求当日分位
    const [peTtmPercentile, pbPercentile] = await Promise.all([
      this.computeValuationPercentile(tradeDate, 'pe_ttm'),
      this.computeValuationPercentile(tradeDate, 'pb'),
    ])

    return {
      tradeDate,
      peTtmMedian: peTtmMedian !== null ? Number(Number(peTtmMedian).toFixed(2)) : null,
      pbMedian: pbMedian !== null ? Number(Number(pbMedian).toFixed(2)) : null,
      peTtmPercentile,
      pbPercentile,
    }
  }

  // ─── 核心指数行情 ──────────────────────────────────────────────────────────

  async getIndexQuote(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestIndexTradeDate()
    if (!tradeDate) {
      return []
    }

    return this.prisma.indexDaily.findMany({
      where: { tradeDate },
      orderBy: { tsCode: 'asc' },
    })
  }

  // ─── 沪深港通（北向/南向）资金流向 ────────────────────────────────────────

  async getHsgtFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestHsgtTradeDate()
    if (!tradeDate) {
      return { tradeDate: null, history: [] }
    }

    // 返回最近 20 个交易日的沪深港通数据用于趋势展示
    const history = await this.prisma.moneyflowHsgt.findMany({
      where: { tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      take: 20,
    })

    return {
      tradeDate,
      history: history.reverse(),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有辅助方法
  // ═══════════════════════════════════════════════════════════════════════════

  private async computeValuationPercentile(tradeDate: Date, field: 'pe_ttm' | 'pb') {
    const oneYearAgo = new Date(tradeDate)
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const threeYearAgo = new Date(tradeDate)
    threeYearAgo.setFullYear(threeYearAgo.getFullYear() - 3)
    const fiveYearAgo = new Date(tradeDate)
    fiveYearAgo.setFullYear(fiveYearAgo.getFullYear() - 5)

    const computePercentile = async (startDate: Date): Promise<number | null> => {
      const dailyMedians: { daily_median: string }[] = field === 'pe_ttm'
        ? await this.prisma.$queryRaw`
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm)::text AS daily_median
            FROM stock_daily_valuation_metrics
            WHERE trade_date >= ${startDate} AND trade_date <= ${tradeDate}
              AND pe_ttm > 0 AND pe_ttm < 1000 AND pb > 0
            GROUP BY trade_date
            ORDER BY trade_date
          `
        : await this.prisma.$queryRaw`
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)::text AS daily_median
            FROM stock_daily_valuation_metrics
            WHERE trade_date >= ${startDate} AND trade_date <= ${tradeDate}
              AND pe_ttm > 0 AND pe_ttm < 1000 AND pb > 0
            GROUP BY trade_date
            ORDER BY trade_date
          `

      if (dailyMedians.length < 2) return null

      // 当日是最后一个（ORDER BY trade_date 升序）
      const currentVal = Number(dailyMedians[dailyMedians.length - 1].daily_median)
      const allVals = dailyMedians.map((r) => Number(r.daily_median)).sort((a, b) => a - b)
      const rank = allVals.filter((v) => v <= currentVal).length
      return Math.round((rank / allVals.length) * 100)
    }

    const [oneYear, threeYear, fiveYear] = await Promise.all([
      computePercentile(oneYearAgo),
      computePercentile(threeYearAgo),
      computePercentile(fiveYearAgo),
    ])

    return { oneYear, threeYear, fiveYear }
  }

  private async resolveLatestMarketTradeDate() {
    const record = await this.prisma.moneyflowMktDc.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestSectorTradeDate() {
    const record = await this.prisma.moneyflowIndDc.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestDailyTradeDate() {
    const record = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestDailyBasicTradeDate() {
    const record = await this.prisma.dailyBasic.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestIndexTradeDate() {
    const record = await this.prisma.indexDaily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestHsgtTradeDate() {
    const record = await this.prisma.moneyflowHsgt.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private parseDate(value: string) {
    return (dayjs as any).tz(value, 'YYYYMMDD', 'Asia/Shanghai').toDate()
  }
}
