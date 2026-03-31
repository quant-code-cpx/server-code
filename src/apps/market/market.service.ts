import { Inject, Injectable } from '@nestjs/common'
import { MoneyflowContentType } from '@prisma/client'
import * as dayjs from 'dayjs'
// use require for plugins to ensure compatibility with commonjs output
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
import type { RedisClientType } from 'redis'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'
import { IndexTrendQueryDto, IndexTrendPeriod } from './dto/index-trend-query.dto'
import { SectorRankingQueryDto } from './dto/sector-ranking-query.dto'
import { VolOverviewQueryDto } from './dto/vol-overview-query.dto'
import { SentimentTrendQueryDto } from './dto/sentiment-trend-query.dto'
import { ValuationTrendQueryDto, ValuationTrendPeriod } from './dto/valuation-trend-query.dto'

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

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

  // ─── 核心指数走势 ──────────────────────────────────────────────────────────

  /** 指数代码 → 中文名称映射 */
  private static readonly INDEX_NAME_MAP: Record<string, string> = {
    '000001.SH': '上证指数',
    '399001.SZ': '深证成指',
    '399006.SZ': '创业板指',
    '000300.SH': '沪深300',
    '000905.SH': '中证500',
    '000852.SH': '中证1000',
  }

  async getIndexTrend(query: IndexTrendQueryDto) {
    const tsCode = query.ts_code ?? '000001.SH'
    const period = query.period ?? '3m'
    const cacheKey = `market:index-trend:${tsCode}:${period}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const latestDate = await this.resolveLatestIndexTradeDate()
    if (!latestDate) return { tsCode, name: MarketService.INDEX_NAME_MAP[tsCode] ?? tsCode, period, data: [] }

    const startDate = this.periodToStartDate(latestDate, period as IndexTrendPeriod)

    const rows = await this.prisma.indexDaily.findMany({
      where: { tsCode, tradeDate: { gte: startDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, close: true, pctChg: true, vol: true, amount: true },
    })

    const result = {
      tsCode,
      name: MarketService.INDEX_NAME_MAP[tsCode] ?? tsCode,
      period,
      data: rows.map((r) => ({
        tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
        close: r.close,
        pctChg: r.pctChg,
        vol: r.vol,
        amount: r.amount,
      })),
    }

    await this.redis.setEx(cacheKey, 4 * 3600, JSON.stringify(result))
    return result
  }

  // ─── 市场涨跌分布 ──────────────────────────────────────────────────────────

  async getChangeDistribution(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return null

    const tradeDateStr = dayjs(tradeDate).format('YYYY-MM-DD')
    const cacheKey = `market:change-dist:${tradeDateStr}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    // 使用 PostgreSQL width_bucket 按 1% 步长分桶
    const bucketRows = await this.prisma.$queryRaw<{ bucket: number; cnt: bigint }[]>`
      SELECT
        width_bucket(pct_chg, -11, 11, 22) AS bucket,
        COUNT(*) AS cnt
      FROM stock_daily_prices
      WHERE trade_date = ${tradeDate}
      GROUP BY bucket
      ORDER BY bucket
    `

    const [limitUp, limitDown] = await Promise.all([
      this.prisma.daily.count({ where: { tradeDate, pctChg: { gte: 9.5 } } }),
      this.prisma.daily.count({ where: { tradeDate, pctChg: { lte: -9.5 } } }),
    ])

    // 构建 21 档直方图（桶 1~21 对应 [-11,-10), [-10,-9), ..., [9,10), [10,11]）
    const bucketMap = new Map(bucketRows.map((r) => [Number(r.bucket), Number(r.cnt)]))
    const distribution = Array.from({ length: 21 }, (_, i) => {
      const low = -11 + i
      const high = low + 1
      return {
        label: `${low}~${high}`,
        count: bucketMap.get(i + 1) ?? 0,
      }
    })

    const result = { tradeDate, limitUp, limitDown, distribution }
    await this.redis.setEx(cacheKey, 4 * 3600, JSON.stringify(result))
    return result
  }

  // ─── 行业涨跌排行 ──────────────────────────────────────────────────────────

  async getSectorRanking(query: SectorRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: null, sectors: [] }

    const sortBy = query.sort_by ?? 'pct_change'
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:sector-ranking:${tradeDateStr}:${sortBy}:${query.limit ?? 'all'}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const orderBy = sortBy === 'net_amount' ? { netAmount: 'desc' as const } : { pctChange: 'desc' as const }

    const rows = await this.prisma.moneyflowIndDc.findMany({
      where: { tradeDate, contentType: MoneyflowContentType.INDUSTRY },
      orderBy,
      ...(query.limit ? { take: query.limit } : {}),
      select: { tsCode: true, name: true, pctChange: true, netAmount: true, netAmountRate: true },
    })

    const result = {
      tradeDate,
      sectors: rows.map((r) => ({
        tsCode: r.tsCode,
        name: r.name,
        pctChange: r.pctChange,
        netAmount: r.netAmount,
        netAmountRate: r.netAmountRate,
      })),
    }

    await this.redis.setEx(cacheKey, 4 * 3600, JSON.stringify(result))
    return result
  }

  // ─── 市场成交概况 ──────────────────────────────────────────────────────────

  async getVolumeOverview(query: VolOverviewQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return { data: [] }

    const days = query.days ?? 20
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:vol-overview:${tradeDateStr}:${days}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    // 全A成交额（万元，amount字段单位为千元，除以100000转亿元）
    const totalRows = await this.prisma.$queryRaw<{ trade_date: Date; total_amount: string }[]>`
      SELECT trade_date, SUM(amount) / 100000.0 AS total_amount
      FROM stock_daily_prices
      WHERE trade_date <= ${tradeDate}
      GROUP BY trade_date
      ORDER BY trade_date DESC
      LIMIT ${days}
    `

    // 指数成交额（index_daily amount 字段单位同 daily，除以100000转亿元）
    const indexRows = await this.prisma.indexDaily.findMany({
      where: {
        tsCode: { in: ['000001.SH', '399001.SZ'] },
        tradeDate: { lte: tradeDate },
      },
      orderBy: { tradeDate: 'desc' },
      take: days * 2,
      select: { tsCode: true, tradeDate: true, amount: true },
    })

    // 以 tradeDate 为 key 合并
    const indexMap = new Map<string, { sh: number; sz: number }>()
    for (const r of indexRows) {
      const key = dayjs(r.tradeDate).format('YYYY-MM-DD')
      if (!indexMap.has(key)) indexMap.set(key, { sh: 0, sz: 0 })
      const entry = indexMap.get(key)!
      const amountBillions = r.amount !== null ? Number(r.amount) / 100000 : 0
      if (r.tsCode === '000001.SH') entry.sh = amountBillions
      else if (r.tsCode === '399001.SZ') entry.sz = amountBillions
    }

    const data = totalRows
      .map((r) => {
        const key = dayjs(r.trade_date).format('YYYY-MM-DD')
        const idx = indexMap.get(key) ?? { sh: 0, sz: 0 }
        return {
          tradeDate: key,
          totalAmount: Number(Number(r.total_amount).toFixed(2)),
          shAmount: Number(idx.sh.toFixed(2)),
          szAmount: Number(idx.sz.toFixed(2)),
        }
      })
      .reverse() // 按时间升序返回

    const result = { data }
    await this.redis.setEx(cacheKey, 4 * 3600, JSON.stringify(result))
    return result
  }

  // ─── 市场情绪趋势 ──────────────────────────────────────────────────────────

  async getSentimentTrend(query: SentimentTrendQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return { data: [] }

    const days = query.days ?? 20
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:sentiment-trend:${tradeDateStr}:${days}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    // 取最近 N 个交易日日期
    const dateRows = await this.prisma.$queryRaw<{ trade_date: Date }[]>`
      SELECT DISTINCT trade_date
      FROM stock_daily_prices
      WHERE trade_date <= ${tradeDate}
      ORDER BY trade_date DESC
      LIMIT ${days}
    `
    if (dateRows.length === 0) return { data: [] }

    const tradeDates = dateRows.map((r) => r.trade_date)

    // 一次性批量统计所有交易日的涨跌家数
    const sentimentRows = await this.prisma.$queryRaw<{
      trade_date: Date
      rise: bigint
      flat: bigint
      fall: bigint
      limit_up: bigint
      limit_down: bigint
    }[]>`
      SELECT
        trade_date,
        COUNT(*) FILTER (WHERE pct_chg > 0.001)                        AS rise,
        COUNT(*) FILTER (WHERE pct_chg >= -0.001 AND pct_chg <= 0.001) AS flat,
        COUNT(*) FILTER (WHERE pct_chg < -0.001)                       AS fall,
        COUNT(*) FILTER (WHERE pct_chg >= 9.5)                         AS limit_up,
        COUNT(*) FILTER (WHERE pct_chg <= -9.5)                        AS limit_down
      FROM stock_daily_prices
      WHERE trade_date = ANY(${tradeDates})
      GROUP BY trade_date
      ORDER BY trade_date ASC
    `

    const data = sentimentRows.map((r) => ({
      tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
      rise: Number(r.rise),
      flat: Number(r.flat),
      fall: Number(r.fall),
      limitUp: Number(r.limit_up),
      limitDown: Number(r.limit_down),
    }))

    const result = { data }
    await this.redis.setEx(cacheKey, 4 * 3600, JSON.stringify(result))
    return result
  }

  // ─── 估值趋势 ─────────────────────────────────────────────────────────────

  async getValuationTrend(query: ValuationTrendQueryDto) {
    const period = query.period ?? '1y'
    const cacheKey = `market:valuation-trend:${period}`

    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const latestDate = await this.resolveLatestDailyBasicTradeDate()
    if (!latestDate) return { period, data: [] }

    const startDate = this.periodToStartDate(latestDate, period as ValuationTrendPeriod)

    const rows = await this.prisma.$queryRaw<{ trade_date: Date; pe_ttm_median: string; pb_median: string }[]>`
      SELECT
        trade_date,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm)::text AS pe_ttm_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)::text     AS pb_median
      FROM stock_daily_valuation_metrics
      WHERE trade_date >= ${startDate}
        AND pe_ttm > 0 AND pe_ttm < 1000 AND pb > 0
      GROUP BY trade_date
      ORDER BY trade_date ASC
    `

    const data = rows.map((r) => ({
      tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
      peTtmMedian: Number(Number(r.pe_ttm_median).toFixed(2)),
      pbMedian: Number(Number(r.pb_median).toFixed(2)),
    }))

    const result = { period, data }
    await this.redis.setEx(cacheKey, 8 * 3600, JSON.stringify(result))
    return result
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

  /** 根据 period 字符串计算起始日期（从基准日期向前推） */
  private periodToStartDate(baseDate: Date, period: IndexTrendPeriod | ValuationTrendPeriod): Date {
    const d = dayjs(baseDate)
    switch (period) {
      case '1m':
        return d.subtract(1, 'month').toDate()
      case '3m':
        return d.subtract(3, 'month').toDate()
      case '6m':
        return d.subtract(6, 'month').toDate()
      case '1y':
        return d.subtract(1, 'year').toDate()
      case '3y':
        return d.subtract(3, 'year').toDate()
      case '5y':
        return d.subtract(5, 'year').toDate()
    }
  }
}
