import { Injectable, Logger } from '@nestjs/common'
import { MoneyflowContentType, Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CORE_INDEX_CODES, CORE_INDEX_NAME_MAP, CORE_INDEX_BASE_MAP } from 'src/constant/tushare.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'
import { IndexQuoteQueryDto } from './dto/index-quote-query.dto'
import { SectorFlowQueryDto } from './dto/sector-flow-query.dto'
import { HsgtFlowQueryDto } from './dto/hsgt-flow-query.dto'
import { IndexTrendQueryDto, IndexTrendPeriod } from './dto/index-trend-query.dto'
import { SectorRankingQueryDto } from './dto/sector-ranking-query.dto'
import { VolOverviewQueryDto } from './dto/vol-overview-query.dto'
import { SentimentTrendQueryDto } from './dto/sentiment-trend-query.dto'
import { ValuationTrendQueryDto, ValuationTrendPeriod } from './dto/valuation-trend-query.dto'
import { MoneyFlowTrendQueryDto } from './dto/money-flow-trend-query.dto'
import { SectorFlowRankingQueryDto } from './dto/sector-flow-ranking-query.dto'
import { SectorFlowTrendQueryDto } from './dto/sector-flow-trend-query.dto'
import { HsgtTrendQueryDto } from './dto/hsgt-trend-query.dto'
import { MainFlowRankingQueryDto } from './dto/main-flow-ranking-query.dto'
import { StockFlowDetailQueryDto } from './dto/stock-flow-detail-query.dto'
import { IndexQuoteWithSparklineQueryDto } from './dto/index-quote-with-sparkline-query.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

const MARKET_STANDARD_CACHE_TTL_SECONDS = 4 * 3600
const MARKET_EXTENDED_CACHE_TTL_SECONDS = 8 * 3600

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
  private readonly logger = new Logger(MarketService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ─── 大盘资金流向 ──────────────────────────────────────────────────────────

  async getMarketMoneyFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestStockFlowTradeDate()
    if (!tradeDate) {
      return []
    }

    // 单一数据源：THS 个股资金流向（moneyflow）全市场汇总 + 指数收盘（indexDaily）
    const [agg, shRow, szRow] = await Promise.all([
      this.prisma.moneyflow.aggregate({
        where: { tradeDate },
        _sum: {
          buyElgAmount: true,
          sellElgAmount: true,
          buyLgAmount: true,
          sellLgAmount: true,
          buyMdAmount: true,
          sellMdAmount: true,
          buySmAmount: true,
          sellSmAmount: true,
          netMfAmount: true,
        },
      }),
      this.prisma.indexDaily.findFirst({
        where: { tsCode: '000001.SH', tradeDate },
        select: { close: true, pctChg: true },
      }),
      this.prisma.indexDaily.findFirst({
        where: { tsCode: '399001.SZ', tradeDate },
        select: { close: true, pctChg: true },
      }),
    ])

    // THS 字段单位：万元 → 元
    const toYuan = (v: number | null | undefined) => (v != null ? v * 10000 : null)
    const s = agg._sum
    const elgBuy = toYuan(s.buyElgAmount)
    const elgSell = toYuan(s.sellElgAmount)
    const lgBuy = toYuan(s.buyLgAmount)
    const lgSell = toYuan(s.sellLgAmount)
    const mdBuy = toYuan(s.buyMdAmount)
    const mdSell = toYuan(s.sellMdAmount)
    const smBuy = toYuan(s.buySmAmount)
    const smSell = toYuan(s.sellSmAmount)

    // 全市场单边总成交 = 四层买入之和（各层 buy ≈ sell，与 daily.amount 口径一致）
    const totalAmount =
      elgBuy != null && lgBuy != null && mdBuy != null && smBuy != null ? elgBuy + lgBuy + mdBuy + smBuy : null

    // 占比工具（分母为总成交）
    const pct = (v: number | null) =>
      v != null && totalAmount != null && totalAmount !== 0 ? (v / totalAmount) * 100 : null

    // 构造单层数据
    const makeTier = (buy: number | null, sell: number | null) => {
      const net = buy != null && sell != null ? buy - sell : null
      return {
        buyAmount: buy,
        sellAmount: sell,
        netAmount: net,
        buyRate: pct(buy),
        sellRate: pct(sell),
        netRate: pct(net),
      }
    }

    // 主力 = 超大 + 大单，散户 = 中 + 小单
    const mainBuy = elgBuy != null && lgBuy != null ? elgBuy + lgBuy : null
    const mainSell = elgSell != null && lgSell != null ? elgSell + lgSell : null
    const retailBuy = mdBuy != null && smBuy != null ? mdBuy + smBuy : null
    const retailSell = mdSell != null && smSell != null ? mdSell + smSell : null

    return {
      tradeDate,
      closeSh: shRow?.close ?? null,
      pctChangeSh: shRow?.pctChg ?? null,
      closeSz: szRow?.close ?? null,
      pctChangeSz: szRow?.pctChg ?? null,
      totalAmount,
      netMfAmount: toYuan(s.netMfAmount),
      main: makeTier(mainBuy, mainSell),
      retail: makeTier(retailBuy, retailSell),
      elg: makeTier(elgBuy, elgSell),
      lg: makeTier(lgBuy, lgSell),
      md: makeTier(mdBuy, mdSell),
      sm: makeTier(smBuy, smSell),
    }
  }

  // ─── 行业板块资金流向 ──────────────────────────────────────────────────────

  async getSectorFlow(query: SectorFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) {
      return {
        tradeDate: null,
        industry: [],
        concept: [],
        region: [],
      }
    }

    const contentTypeFilter = query.content_type ? (query.content_type as MoneyflowContentType) : undefined

    const rows = await this.prisma.moneyflowIndDc.findMany({
      where: { tradeDate, ...(contentTypeFilter ? { contentType: contentTypeFilter } : {}) },
      orderBy: [{ contentType: 'asc' }, { netAmount: 'desc' }],
    })

    // 有 limit 时按 abs(netAmount) 降序截断，无 limit 时保持原顺序
    const applyLimit = (items: typeof rows) => {
      if (!query.limit) return items
      return [...items].sort((a, b) => Math.abs(b.netAmount ?? 0) - Math.abs(a.netAmount ?? 0)).slice(0, query.limit)
    }

    return {
      tradeDate,
      industry: applyLimit(rows.filter((item) => item.contentType === MoneyflowContentType.INDUSTRY)),
      concept: applyLimit(rows.filter((item) => item.contentType === MoneyflowContentType.CONCEPT)),
      region: applyLimit(rows.filter((item) => item.contentType === MoneyflowContentType.REGION)),
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
      return {
        tradeDate: null,
        peTtmMedian: null,
        pbMedian: null,
        peTtmPercentile: { oneYear: null, threeYear: null, fiveYear: null },
        pbPercentile: { oneYear: null, threeYear: null, fiveYear: null },
      }
    }

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const cacheKey = `valuation:${tradeDateStr}`
    return this.rememberMarketCache(cacheKey, MARKET_EXTENDED_CACHE_TTL_SECONDS, async () => {
      const fiveYearAgo = new Date(tradeDate)
      fiveYearAgo.setFullYear(fiveYearAgo.getFullYear() - 5)
      const oneYearAgo = new Date(tradeDate)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      const threeYearAgo = new Date(tradeDate)
      threeYearAgo.setFullYear(threeYearAgo.getFullYear() - 3)

      // 单次查询：拉取 5 年内每日 PE_TTM / PB 双字段中位数，ORDER BY 保证最后一行为当日
      const dailyMedians = await this.prisma.$queryRaw<
        { trade_date: Date; pe_ttm_median: string; pb_median: string }[]
      >`
        SELECT
          trade_date,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm)::text AS pe_ttm_median,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)::text     AS pb_median
        FROM stock_daily_valuation_metrics
        WHERE trade_date >= ${fiveYearAgo} AND trade_date <= ${tradeDate}
          AND pe_ttm > 0 AND pe_ttm < 1000
          AND pb > 0
        GROUP BY trade_date
        ORDER BY trade_date
      `

      if (dailyMedians.length === 0) {
        return {
          tradeDate,
          peTtmMedian: null,
          pbMedian: null,
          peTtmPercentile: { oneYear: null, threeYear: null, fiveYear: null },
          pbPercentile: { oneYear: null, threeYear: null, fiveYear: null },
        }
      }

      // 最后一行即当日
      const lastRow = dailyMedians[dailyMedians.length - 1]
      const peTtmMedianCurrent = Number(lastRow.pe_ttm_median)
      const pbMedianCurrent = Number(lastRow.pb_median)

      const oneYearAgoTs = oneYearAgo.getTime()
      const threeYearAgoTs = threeYearAgo.getTime()
      const oneYearRows = dailyMedians.filter((r) => new Date(r.trade_date).getTime() >= oneYearAgoTs)
      const threeYearRows = dailyMedians.filter((r) => new Date(r.trade_date).getTime() >= threeYearAgoTs)

      const computePct = (
        rows: { pe_ttm_median: string; pb_median: string }[],
        field: 'pe_ttm_median' | 'pb_median',
        currentVal: number,
      ): number | null => {
        if (rows.length < 2) return null
        const allVals = rows.map((r) => Number(r[field])).sort((a, b) => a - b)
        const rank = allVals.filter((v) => v <= currentVal).length
        return Math.round((rank / allVals.length) * 100)
      }

      return {
        tradeDate,
        peTtmMedian: Number(peTtmMedianCurrent.toFixed(2)),
        pbMedian: Number(pbMedianCurrent.toFixed(2)),
        peTtmPercentile: {
          oneYear: computePct(oneYearRows, 'pe_ttm_median', peTtmMedianCurrent),
          threeYear: computePct(threeYearRows, 'pe_ttm_median', peTtmMedianCurrent),
          fiveYear: computePct(dailyMedians, 'pe_ttm_median', peTtmMedianCurrent),
        },
        pbPercentile: {
          oneYear: computePct(oneYearRows, 'pb_median', pbMedianCurrent),
          threeYear: computePct(threeYearRows, 'pb_median', pbMedianCurrent),
          fiveYear: computePct(dailyMedians, 'pb_median', pbMedianCurrent),
        },
      }
    })
  }

  // ─── 核心指数行情 ──────────────────────────────────────────────────────────

  async getIndexQuote(query: IndexQuoteQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestIndexTradeDate()
    if (!tradeDate) {
      return []
    }

    const tsCodeFilter = query.ts_codes && query.ts_codes.length > 0 ? { in: query.ts_codes } : undefined

    const rows = await this.prisma.indexDaily.findMany({
      where: { tradeDate, ...(tsCodeFilter ? { tsCode: tsCodeFilter } : {}) },
      orderBy: { tsCode: 'asc' },
    })
    console.log(rows, rows[0].tsCode, CORE_INDEX_BASE_MAP[rows[0].tsCode], CORE_INDEX_NAME_MAP[rows[0].tsCode])

    return rows.map((r) => {
      const base = CORE_INDEX_BASE_MAP[r.tsCode]
      return {
        ...r,
        baseDate: base?.baseDate ?? '',
        basePoint: base?.basePoint ?? 0,
      }
    })
  }

  // ─── 沪深港通（北向/南向）资金流向 ────────────────────────────────────────

  async getHsgtFlow(query: HsgtFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestHsgtTradeDate()
    if (!tradeDate) {
      return { tradeDate: null, history: [] }
    }

    const days = query.days ?? 20

    // 返回最近 N 个交易日的沪深港通数据用于趋势展示
    const history = await this.prisma.moneyflowHsgt.findMany({
      where: { tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })

    return {
      tradeDate,
      history: history.reverse(),
    }
  }

  // ─── 核心指数走势 ──────────────────────────────────────────────────────────

  async getIndexTrend(query: IndexTrendQueryDto) {
    const tsCode = query.ts_code ?? '000001.SH'
    const period = query.period ?? '3m'

    // Resolve latest date outside the cache block so the key reflects newest available data
    const latestDate = await this.resolveLatestIndexTradeDate()
    if (!latestDate) return { tsCode, name: CORE_INDEX_NAME_MAP[tsCode] ?? tsCode, period, data: [] }

    const latestDateStr = dayjs(latestDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const cacheKey = `market:index-trend:${tsCode}:${period}:${latestDateStr}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const startDate = this.periodToStartDate(latestDate, period as IndexTrendPeriod)

      const rows = await this.prisma.indexDaily.findMany({
        where: { tsCode, tradeDate: { gte: startDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, close: true, pctChg: true, vol: true, amount: true },
      })

      return {
        tsCode,
        name: CORE_INDEX_NAME_MAP[tsCode] ?? tsCode,
        period,
        data: rows.map((r) => ({
          tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
          close: r.close,
          pctChg: r.pctChg,
          vol: r.vol,
          amount: r.amount,
        })),
      }
    })
  }

  // ─── 批量指数行情 + 迷你走势 ────────────────────────────────────────────────

  async getIndexQuoteWithSparkline(query: IndexQuoteWithSparklineQueryDto) {
    const period = query.sparkline_period ?? '1m'
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestIndexTradeDate()
    if (!tradeDate) return { tradeDate: null, sparklinePeriod: period, indices: [] }

    const cacheKey = `market:index-quote-sparkline:${dayjs(tradeDate).format('YYYYMMDD')}:${period}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const startDate = this.periodToStartDate(tradeDate, period as IndexTrendPeriod)

      // 一次查询取 sparkline 窗口内所有核心指数数据（当日行情也包含在内）
      const rows = await this.prisma.indexDaily.findMany({
        where: {
          tsCode: { in: [...CORE_INDEX_CODES] },
          tradeDate: { gte: startDate },
        },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        select: {
          tsCode: true,
          tradeDate: true,
          close: true,
          preClose: true,
          change: true,
          pctChg: true,
          vol: true,
          amount: true,
        },
      })

      // 按指数分组
      const grouped = new Map<string, typeof rows>()
      for (const r of rows) {
        if (!grouped.has(r.tsCode)) grouped.set(r.tsCode, [])
        grouped.get(r.tsCode)!.push(r)
      }

      const indices = CORE_INDEX_CODES.map((tsCode) => {
        const series = grouped.get(tsCode) ?? []
        const latest = series.filter((r) => r.tradeDate <= tradeDate).at(-1)
        const base = CORE_INDEX_BASE_MAP[tsCode]
        return {
          tsCode,
          name: CORE_INDEX_NAME_MAP[tsCode] ?? tsCode,
          tradeDate: latest?.tradeDate ?? tradeDate,
          close: latest?.close ?? null,
          preClose: latest?.preClose ?? null,
          change: latest?.change ?? null,
          pctChg: latest?.pctChg ?? null,
          vol: latest?.vol ?? null,
          amount: latest?.amount ?? null,
          baseDate: base?.baseDate ?? '',
          basePoint: base?.basePoint ?? 0,
          sparkline: series.map((r) => r.close),
        }
      })

      return { tradeDate, sparklinePeriod: period, indices }
    })
  }

  // ─── 市场涨跌分布 ──────────────────────────────────────────────────────────

  async getChangeDistribution(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return null

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYY-MM-DD')
    const cacheKey = `market:change-dist:${tradeDateStr}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      // 使用 PostgreSQL width_bucket 按 1% 步长分桶（-10 ~ 10，共 20 档）
      // bucket=0 为溢出低区（pct_chg < -10），bucket=22 为溢出高区（pct_chg >= 10）
      const bucketRows = await this.prisma.$queryRaw<{ bucket: number; cnt: bigint }[]>`
        SELECT
          CASE
            WHEN pct_chg < -10 THEN 0
            WHEN pct_chg >= 10 THEN 22
            ELSE width_bucket(pct_chg, -10, 10, 20)
          END AS bucket,
          COUNT(*) AS cnt
        FROM stock_daily_prices
        WHERE trade_date = ${tradeDateStr}::date
        GROUP BY bucket
        ORDER BY bucket
      `

      const [limitUp, limitDown] = await Promise.all([
        this.prisma.daily.count({ where: { tradeDate, pctChg: { gte: 9.5 } } }),
        this.prisma.daily.count({ where: { tradeDate, pctChg: { lte: -9.5 } } }),
      ])

      // 构建 22 档直方图：溢出低区 + 20 个 1% 正常档 + 溢出高区
      const bucketMap = new Map(bucketRows.map((r) => [Number(r.bucket), Number(r.cnt)]))
      const regular = Array.from({ length: 20 }, (_, i) => {
        const low = -10 + i
        const high = low + 1
        return {
          label: `${low}~${high}`,
          count: bucketMap.get(i + 1) ?? 0,
        }
      })
      const distribution = [
        { label: '<-10%', count: bucketMap.get(0) ?? 0 },
        ...regular,
        { label: '>10%', count: bucketMap.get(22) ?? 0 },
      ]

      return { tradeDate, limitUp, limitDown, distribution }
    })
  }

  // ─── 市场宽度（涨停/跌停/涨跌家数）──────────────────────────────────────

  async getMarketBreadth(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return null

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYY-MM-DD')
    const cacheKey = `market:breadth:${tradeDateStr}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const [[row], limitListRows] = await Promise.all([
        this.prisma.$queryRaw<
          [
            {
              limitUp: bigint
              limitDown: bigint
              bigRise: bigint
              rise: bigint
              flat: bigint
              fall: bigint
              bigFall: bigint
              total: bigint
            },
          ]
        >`
          SELECT
            COUNT(*) FILTER (WHERE pct_chg >= 9.5)                              AS "limitUp",
            COUNT(*) FILTER (WHERE pct_chg <= -9.5)                             AS "limitDown",
            COUNT(*) FILTER (WHERE pct_chg >= 5)                                AS "bigRise",
            COUNT(*) FILTER (WHERE pct_chg >= 0.001 AND pct_chg < 5)           AS "rise",
            COUNT(*) FILTER (WHERE pct_chg > -0.001 AND pct_chg < 0.001)       AS "flat",
            COUNT(*) FILTER (WHERE pct_chg > -5 AND pct_chg < -0.001)          AS "fall",
            COUNT(*) FILTER (WHERE pct_chg <= -5)                               AS "bigFall",
            COUNT(*)                                                             AS "total"
          FROM stock_daily_prices
          WHERE trade_date = ${tradeDateStr}::date
        `,
        this.prisma.limitListD.findMany({
          where: { tradeDate },
          select: { limit: true, limitTimes: true },
        }),
      ])

      const limitUpBroken = limitListRows.filter((r) => r.limit === 'Z').length

      const groupMap = new Map<number, number>()
      for (const r of limitListRows.filter((r) => r.limit === 'U')) {
        const board = r.limitTimes ?? 1
        groupMap.set(board, (groupMap.get(board) ?? 0) + 1)
      }
      const consecutiveLimitGroups = Array.from(groupMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([board, count]) => ({ board, count }))

      return {
        tradeDate,
        limitUp: Number(row.limitUp),
        limitDown: Number(row.limitDown),
        bigRise: Number(row.bigRise),
        rise: Number(row.rise),
        flat: Number(row.flat),
        fall: Number(row.fall),
        bigFall: Number(row.bigFall),
        total: Number(row.total),
        limitUpBroken,
        consecutiveLimitGroups,
      }
    })
  }

  // ─── 行业涨跌排行 ──────────────────────────────────────────────────────────

  async getSectorRanking(query: SectorRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: null, sectors: [] }

    const sortBy = query.sort_by ?? 'pct_change'
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:sector-ranking:${tradeDateStr}:${sortBy}:${query.limit ?? 'all'}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const orderBy = sortBy === 'net_amount' ? { netAmount: 'desc' as const } : { pctChange: 'desc' as const }

      const rows = await this.prisma.moneyflowIndDc.findMany({
        where: { tradeDate, contentType: MoneyflowContentType.INDUSTRY },
        orderBy,
        ...(query.limit ? { take: query.limit } : {}),
        select: { tsCode: true, name: true, pctChange: true, netAmount: true, netAmountRate: true },
      })

      return {
        tradeDate,
        sectors: rows.map((r) => ({
          tsCode: r.tsCode,
          name: r.name,
          pctChange: r.pctChange,
          netAmount: r.netAmount,
          netAmountRate: r.netAmountRate,
        })),
      }
    })
  }

  // ─── 市场成交概况 ──────────────────────────────────────────────────────────

  async getVolumeOverview(query: VolOverviewQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return { data: [] }

    const days = query.days ?? 20
    // Use Shanghai timezone for formatting to avoid UTC-offset date mismatch
    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const tradeDateIso = `${tradeDateStr.slice(0, 4)}-${tradeDateStr.slice(4, 6)}-${tradeDateStr.slice(6, 8)}`
    const cacheKey = `market:vol-overview:${tradeDateStr}:${days}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      // 全A成交额（万元，amount字段单位为千元，除以100000转亿元）
      // 下界：3倍日历天数，足够覆盖任意 days 个交易日（约含周末/节假日缓冲）
      // Use date strings with ::date cast to avoid UTC-offset comparison issues
      const volLowerBoundIso = dayjs
        .tz(tradeDateStr, 'YYYYMMDD', 'Asia/Shanghai')
        .subtract(days * 3, 'day')
        .format('YYYY-MM-DD')
      const totalRows = await this.prisma.$queryRaw<{ trade_date: Date; total_amount: string }[]>`
        SELECT trade_date, SUM(amount) / 100000.0 AS total_amount
        FROM stock_daily_prices
        WHERE trade_date <= ${tradeDateIso}::date
          AND trade_date >= ${volLowerBoundIso}::date
        GROUP BY trade_date
        ORDER BY trade_date DESC
        LIMIT ${days}
      `

      // 指数成交额（index_daily amount 字段单位同 daily，除以100000转亿元）
      const tradeDateUtc = new Date(`${tradeDateIso}T00:00:00.000Z`)
      const indexRows = await this.prisma.indexDaily.findMany({
        where: {
          tsCode: { in: ['000001.SH', '399001.SZ'] },
          tradeDate: { lte: tradeDateUtc },
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
        .reverse()

      return { data }
    })
  }

  // ─── 市场情绪趋势 ──────────────────────────────────────────────────────────

  async getSentimentTrend(query: SentimentTrendQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return { data: [] }

    const days = query.days ?? 20
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:sentiment-trend:${tradeDateStr}:${days}`

    return this.rememberMarketCache(
      cacheKey,
      MARKET_STANDARD_CACHE_TTL_SECONDS,
      async () => {
        const sentimentLowerBound = new Date(tradeDate)
        sentimentLowerBound.setDate(sentimentLowerBound.getDate() - days * 3)
        const dateRows = await this.prisma.$queryRaw<{ trade_date: Date }[]>`
          SELECT DISTINCT trade_date
          FROM stock_daily_prices
          WHERE trade_date <= ${tradeDate}
            AND trade_date >= ${sentimentLowerBound}
          ORDER BY trade_date DESC
          LIMIT ${days}
        `
        if (dateRows.length === 0) return { data: [] }

        const tradeDates = dateRows.map((r) => r.trade_date)

        const sentimentRows = await this.prisma.$queryRaw<
          {
            trade_date: Date
            rise: bigint
            flat: bigint
            fall: bigint
            limit_up: bigint
            limit_down: bigint
          }[]
        >`
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

        return {
          data: sentimentRows.map((r) => ({
            tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
            rise: Number(r.rise),
            flat: Number(r.flat),
            fall: Number(r.fall),
            limitUp: Number(r.limit_up),
            limitDown: Number(r.limit_down),
          })),
        }
      },
      (result) => result.data.length === 0,
    )
  }

  // ─── 估值趋势 ─────────────────────────────────────────────────────────────

  async getValuationTrend(query: ValuationTrendQueryDto) {
    const period = query.period ?? '1y'
    const cacheKey = `market:valuation-trend:${period}`

    return this.rememberMarketCache(cacheKey, MARKET_EXTENDED_CACHE_TTL_SECONDS, async () => {
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

      return {
        period,
        data: rows.map((r) => ({
          tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
          peTtmMedian: Number(Number(r.pe_ttm_median).toFixed(2)),
          pbMedian: Number(Number(r.pb_median).toFixed(2)),
        })),
      }
    })
  }

  // ─── 大盘资金流向趋势 ──────────────────────────────────────────────────────

  async getMoneyFlowTrend(query: MoneyFlowTrendQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestMarketTradeDate()
    if (!tradeDate) return { data: [] }

    const days = query.days ?? 20
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:mf-trend:${tradeDateStr}:${days}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      // 从个股 moneyflow 按交易日聚合全市场净流入，口径与 getMarketMoneyFlow 一致（全口径，非主力）
      const rows = await this.prisma.moneyflow.groupBy({
        by: ['tradeDate'],
        where: { tradeDate: { lte: tradeDate } },
        _sum: {
          netMfAmount: true,
          buyElgAmount: true,
          sellElgAmount: true,
          buyLgAmount: true,
          sellLgAmount: true,
          buyMdAmount: true,
          sellMdAmount: true,
          buySmAmount: true,
          sellSmAmount: true,
        },
        orderBy: { tradeDate: 'desc' },
        take: days,
      })

      const sorted = rows.reverse()
      let cumulative = 0
      const wan2yuan = (v: number | null | undefined) => (v != null ? Number((v * 10000).toFixed(2)) : null)
      return {
        data: sorted.map((r) => {
          // netMfAmount 单位万元，× 10000 转元，与 getMarketMoneyFlow 保持一致
          const netAmount = r._sum.netMfAmount != null ? Number((r._sum.netMfAmount * 10000).toFixed(2)) : 0
          cumulative += netAmount
          const buyElg = wan2yuan(r._sum.buyElgAmount)
          const sellElg = wan2yuan(r._sum.sellElgAmount)
          const buyLg = wan2yuan(r._sum.buyLgAmount)
          const sellLg = wan2yuan(r._sum.sellLgAmount)
          const buyMd = wan2yuan(r._sum.buyMdAmount)
          const sellMd = wan2yuan(r._sum.sellMdAmount)
          const buySm = wan2yuan(r._sum.buySmAmount)
          const sellSm = wan2yuan(r._sum.sellSmAmount)
          return {
            tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
            netAmount,
            cumulativeNet: Number(cumulative.toFixed(2)),
            buyElgAmount: buyElg != null && sellElg != null ? Number((buyElg - sellElg).toFixed(2)) : null,
            buyLgAmount: buyLg != null && sellLg != null ? Number((buyLg - sellLg).toFixed(2)) : null,
            buyMdAmount: buyMd != null && sellMd != null ? Number((buyMd - sellMd).toFixed(2)) : null,
            buySmAmount: buySm != null && sellSm != null ? Number((buySm - sellSm).toFixed(2)) : null,
          }
        }),
      }
    })
  }

  // ─── 板块资金流向排行 ──────────────────────────────────────────────────────

  async getSectorFlowRanking(query: SectorFlowRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    const dual = query.dual ?? false

    if (!tradeDate) {
      const contentType = query.content_type ?? 'INDUSTRY'
      return dual
        ? { tradeDate: null, contentType, topInflow: [], topOutflow: [] }
        : { tradeDate: null, contentType, sectors: [] }
    }

    const contentType = (query.content_type ?? 'INDUSTRY') as MoneyflowContentType
    const sortBy = query.sort_by ?? 'net_amount'
    const order = (query.order ?? 'desc') as 'asc' | 'desc'
    const limit = query.limit ?? 20

    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')

    if (dual) {
      const cacheKey = `market:sector-rank:${tradeDateStr}:${contentType}:${sortBy}:dual:${limit}`
      return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
        const orderByDesc = {
          net_amount: { netAmount: 'desc' as const },
          pct_change: { pctChange: 'desc' as const },
          buy_elg_amount: { buyElgAmount: 'desc' as const },
        }
        const orderByAsc = {
          net_amount: { netAmount: 'asc' as const },
          pct_change: { pctChange: 'asc' as const },
          buy_elg_amount: { buyElgAmount: 'asc' as const },
        }
        const selectFields = {
          tsCode: true,
          name: true,
          pctChange: true,
          close: true,
          netAmount: true,
          netAmountRate: true,
          buyElgAmount: true,
          buyLgAmount: true,
          buyMdAmount: true,
          buySmAmount: true,
        } as const

        const [topInflowRows, topOutflowRows] = await Promise.all([
          this.prisma.moneyflowIndDc.findMany({
            where: { tradeDate, contentType },
            orderBy: orderByDesc[sortBy],
            take: limit,
            select: selectFields,
          }),
          this.prisma.moneyflowIndDc.findMany({
            where: { tradeDate, contentType },
            orderBy: orderByAsc[sortBy],
            take: limit,
            select: selectFields,
          }),
        ])

        const mapRow = (r: (typeof topInflowRows)[number]) => ({
          tsCode: r.tsCode,
          name: r.name,
          pctChange: r.pctChange,
          close: r.close,
          netAmount: r.netAmount,
          netAmountRate: r.netAmountRate,
          buyElgAmount: r.buyElgAmount,
          buyLgAmount: r.buyLgAmount,
          buyMdAmount: r.buyMdAmount,
          buySmAmount: r.buySmAmount,
        })

        return {
          tradeDate,
          contentType,
          topInflow: topInflowRows.map(mapRow),
          topOutflow: topOutflowRows.map(mapRow),
        }
      })
    }

    const cacheKey = `market:sector-rank:${tradeDateStr}:${contentType}:${sortBy}:${order}:${limit}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const orderByMap = {
        net_amount: { netAmount: order },
        pct_change: { pctChange: order },
        buy_elg_amount: { buyElgAmount: order },
      } as const

      const rows = await this.prisma.moneyflowIndDc.findMany({
        where: { tradeDate, contentType },
        orderBy: orderByMap[sortBy],
        take: limit,
        select: {
          tsCode: true,
          name: true,
          pctChange: true,
          close: true,
          netAmount: true,
          netAmountRate: true,
          buyElgAmount: true,
          buyLgAmount: true,
          buyMdAmount: true,
          buySmAmount: true,
        },
      })

      return {
        tradeDate,
        contentType,
        sectors: rows.map((r) => ({
          tsCode: r.tsCode,
          name: r.name,
          pctChange: r.pctChange,
          close: r.close,
          netAmount: r.netAmount,
          netAmountRate: r.netAmountRate,
          buyElgAmount: r.buyElgAmount,
          buyLgAmount: r.buyLgAmount,
          buyMdAmount: r.buyMdAmount,
          buySmAmount: r.buySmAmount,
        })),
      }
    })
  }

  // ─── 板块资金流向趋势 ──────────────────────────────────────────────────────

  async getSectorFlowTrend(query: SectorFlowTrendQueryDto) {
    const tsCode = query.ts_code
    const contentType = (query.content_type ?? 'INDUSTRY') as MoneyflowContentType
    const days = query.days ?? 20
    const cacheKey = `market:sector-trend:${tsCode}:${contentType}:${days}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const rows = await this.prisma.moneyflowIndDc.findMany({
        where: { tsCode, contentType },
        orderBy: { tradeDate: 'desc' },
        take: days,
        select: { tradeDate: true, name: true, pctChange: true, netAmount: true },
      })

      if (rows.length === 0) {
        return { tsCode, name: null, data: [] }
      }

      const name = rows[0].name ?? null
      const sorted = rows.reverse()
      let cumulative = 0
      return {
        tsCode,
        name,
        data: sorted.map((r) => {
          cumulative += r.netAmount ?? 0
          return {
            tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
            pctChange: r.pctChange,
            netAmount: r.netAmount,
            cumulativeNet: Number(cumulative.toFixed(2)),
          }
        }),
      }
    })
  }

  // ─── 沪深港通趋势（扩展）─────────────────────────────────────────────────

  async getHsgtTrend(query: HsgtTrendQueryDto) {
    const period = query.period ?? '3m'
    const cacheKey = `market:hsgt-trend:${period}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const latestDate = await this.resolveLatestHsgtTradeDate()
      if (!latestDate) return { period, data: [] }

      const startDate = this.periodToStartDate(latestDate, period)

      const rows = await this.prisma.moneyflowHsgt.findMany({
        where: { tradeDate: { gte: startDate } },
        orderBy: { tradeDate: 'asc' },
      })

      let cumulativeNorth = 0
      let cumulativeSouth = 0
      return {
        period,
        data: rows.map((r) => {
          cumulativeNorth += r.northMoney ?? 0
          cumulativeSouth += r.southMoney ?? 0
          return {
            tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
            northMoney: r.northMoney,
            southMoney: r.southMoney,
            hgt: r.hgt,
            sgt: r.sgt,
            ggtSs: r.ggtSs,
            ggtSz: r.ggtSz,
            cumulativeNorth: Number(cumulativeNorth.toFixed(2)),
            cumulativeSouth: Number(cumulativeSouth.toFixed(2)),
          }
        }),
      }
    })
  }

  // ─── 主力资金净流入 Top N ──────────────────────────────────────────────────

  async getMainFlowRanking(query: MainFlowRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestStockFlowTradeDate()
    const dual = query.dual ?? false

    if (!tradeDate) {
      return dual ? { tradeDate: null, topInflow: [], topOutflow: [] } : { tradeDate: null, data: [] }
    }

    const sortBy = query.sort_by ?? 'main_net_inflow'
    const limit = query.limit ?? 20

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const cacheKey = `market:main-flow-rank:${tradeDateStr}:${sortBy}:${dual ? 'dual' : (query.order ?? 'desc')}:${limit}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      type RawRow = {
        ts_code: string
        name: string | null
        industry: string | null
        main_net_inflow: string
        elg_net_inflow: string
        lg_net_inflow: string
        md_net_inflow: string
        sm_net_inflow: string
        pct_chg: number | null
        amount: number | null
      }

      const sortColMap: Record<string, Prisma.Sql> = {
        main_net_inflow: Prisma.sql`main_net_inflow`,
        elg_net_inflow: Prisma.sql`elg_net_inflow`,
        lg_net_inflow: Prisma.sql`lg_net_inflow`,
        pct_chg: Prisma.sql`d.pct_chg`,
      }
      const sortCol = sortColMap[sortBy] ?? Prisma.sql`main_net_inflow`

      const buildQuery = (dirSql: Prisma.Sql): Prisma.Sql => Prisma.sql`
        SELECT
          mf.ts_code,
          sb.name,
          sb.industry,
          (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0)
           + COALESCE(mf.buy_lg_amount, 0)  - COALESCE(mf.sell_lg_amount, 0))  AS main_net_inflow,
          (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0))   AS elg_net_inflow,
          (COALESCE(mf.buy_lg_amount, 0)  - COALESCE(mf.sell_lg_amount, 0))    AS lg_net_inflow,
          (COALESCE(mf.buy_md_amount, 0)  - COALESCE(mf.sell_md_amount, 0))    AS md_net_inflow,
          (COALESCE(mf.buy_sm_amount, 0)  - COALESCE(mf.sell_sm_amount, 0))    AS sm_net_inflow,
          d.pct_chg,
          d.amount
        FROM stock_capital_flows mf
        JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        LEFT JOIN stock_daily_prices d ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
        WHERE mf.trade_date = ${tradeDateStr}::date
        ORDER BY ${sortCol} ${dirSql} NULLS LAST
        LIMIT ${limit}
      `

      const mapRow = (r: RawRow) => ({
        tsCode: r.ts_code,
        name: r.name,
        industry: r.industry,
        mainNetInflow: Number(r.main_net_inflow),
        elgNetInflow: Number(r.elg_net_inflow),
        lgNetInflow: Number(r.lg_net_inflow),
        mdNetInflow: Number(r.md_net_inflow),
        smNetInflow: Number(r.sm_net_inflow),
        pctChg: r.pct_chg !== null ? Number(r.pct_chg) : null,
        amount: r.amount !== null ? Number(r.amount) : null,
      })

      if (dual) {
        const [topInflowRows, topOutflowRows] = await Promise.all([
          this.prisma.$queryRaw<RawRow[]>(buildQuery(Prisma.sql`DESC`)),
          this.prisma.$queryRaw<RawRow[]>(buildQuery(Prisma.sql`ASC`)),
        ])
        return {
          tradeDate,
          topInflow: topInflowRows.map(mapRow),
          topOutflow: topOutflowRows.map(mapRow),
        }
      }

      const order = query.order ?? 'desc'
      const rows = await this.prisma.$queryRaw<RawRow[]>(
        buildQuery(order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`),
      )
      return { tradeDate, data: rows.map(mapRow) }
    })
  }

  // ─── 个股资金流动明细 ──────────────────────────────────────────────────────

  async getStockFlowDetail(query: StockFlowDetailQueryDto) {
    const tsCode = query.ts_code
    const days = query.days ?? 20
    const cacheKey = `market:stock-flow:${tsCode}:${days}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const [flowRows, stockBasic] = await Promise.all([
        this.prisma.moneyflow.findMany({
          where: { tsCode },
          orderBy: { tradeDate: 'desc' },
          take: days,
        }),
        this.prisma.stockBasic.findUnique({
          where: { tsCode },
          select: { name: true },
        }),
      ])

      const name = stockBasic?.name ?? null
      return {
        tsCode,
        name,
        data: flowRows.reverse().map((r) => {
          const elgNet = (r.buyElgAmount ?? 0) - (r.sellElgAmount ?? 0)
          const lgNet = (r.buyLgAmount ?? 0) - (r.sellLgAmount ?? 0)
          const mdNet = (r.buyMdAmount ?? 0) - (r.sellMdAmount ?? 0)
          const smNet = (r.buySmAmount ?? 0) - (r.sellSmAmount ?? 0)
          return {
            tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
            mainNetInflow: Number((elgNet + lgNet).toFixed(2)),
            retailNetInflow: Number((mdNet + smNet).toFixed(2)),
            buyElgAmount: r.buyElgAmount,
            sellElgAmount: r.sellElgAmount,
            buyLgAmount: r.buyLgAmount,
            sellLgAmount: r.sellLgAmount,
            buyMdAmount: r.buyMdAmount,
            sellMdAmount: r.sellMdAmount,
            buySmAmount: r.buySmAmount,
            sellSmAmount: r.sellSmAmount,
            netMfAmount: r.netMfAmount,
          }
        }),
      }
    })
  }

  // ─── 概念板块 ──────────────────────────────────────────────────────────────

  async getConceptList(dto: { keyword?: string; page?: number; pageSize?: number }) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    // 仅返回在 ths_index_members 中有实际成员的概念板块，
    // 避免 Tushare ths_index 元数据 count 与 ths_member 实际返回不一致导致成员列表为空
    const where: Record<string, unknown> = { type: 'N', members: { some: {} } }
    if (dto.keyword) {
      where['name'] = { contains: dto.keyword }
    }
    const [total, items] = await Promise.all([
      this.prisma.thsIndex.count({ where }),
      this.prisma.thsIndex.findMany({
        where,
        select: { tsCode: true, name: true, count: true, listDate: true },
        orderBy: { count: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { total, page, pageSize, items }
  }

  async getConceptMembers(dto: { tsCode: string; page?: number; pageSize?: number }) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 100
    const { tsCode } = dto
    const [board, total, items] = await Promise.all([
      this.prisma.thsIndex.findUnique({ where: { tsCode }, select: { name: true } }),
      this.prisma.thsMember.count({ where: { tsCode } }),
      this.prisma.thsMember.findMany({
        where: { tsCode },
        select: { conCode: true, conName: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    if (total === 0) {
      this.logger.warn(`[概念成分] tsCode="${tsCode}" 在 ths_index_members 中无记录，board=${board?.name ?? 'NOT_FOUND'}`)
    }
    return { tsCode, name: board?.name ?? null, total, items }
  }

  // ─── 日度叙事（P0）──────────────────────────────────────────────────────────

  async getDailyNarrative(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return null

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYY-MM-DD')
    const cacheKey = `market:daily-narrative:${tradeDateStr}`

    return this.rememberMarketCache(
      cacheKey,
      MARKET_STANDARD_CACHE_TTL_SECONDS,
      async () => {
        const [breadthRows, mktFlowRow, hsgtRow, sectorRows, valuationRows, limitListRows] = await Promise.all([
          // 1. 涨跌家数统计
          this.prisma.$queryRaw<[{ limit_up: bigint; limit_down: bigint; rise: bigint; fall: bigint; total: bigint }]>`
            SELECT
              COUNT(*) FILTER (WHERE pct_chg >= 9.5)   AS limit_up,
              COUNT(*) FILTER (WHERE pct_chg <= -9.5)  AS limit_down,
              COUNT(*) FILTER (WHERE pct_chg > 0.001)  AS rise,
              COUNT(*) FILTER (WHERE pct_chg < -0.001) AS fall,
              COUNT(*)                                  AS total
            FROM stock_daily_prices
            WHERE trade_date = ${tradeDateStr}::date
          `,
          // 2. 全市场资金流（moneyflow_mkt_dc，netAmount 单位：元）
          this.prisma.moneyflowMktDc.findFirst({
            where: { tradeDate: { lte: tradeDate } },
            orderBy: { tradeDate: 'desc' },
            select: { netAmount: true, tradeDate: true },
          }),
          // 3. 北向资金（最近一条 ≤ 当日）
          this.prisma.moneyflowHsgt.findFirst({
            where: { tradeDate: { lte: tradeDate } },
            orderBy: { tradeDate: 'desc' },
            select: { northMoney: true, tradeDate: true },
          }),
          // 4. 行业板块涨跌（用于计算分化度）
          this.prisma.moneyflowIndDc.findMany({
            where: { tradeDate, contentType: MoneyflowContentType.INDUSTRY },
            select: { pctChange: true },
          }),
          // 5. 当日 PE_TTM 中位数
          this.prisma.$queryRaw<[{ pe_ttm_median: string | null }]>`
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm)::text AS pe_ttm_median
            FROM stock_daily_valuation_metrics
            WHERE trade_date = ${tradeDateStr}::date
              AND pe_ttm > 0 AND pe_ttm < 1000
          `,
          // 6. 涨停板明细（炸板数、连板数据）
          this.prisma.limitListD.findMany({
            where: { tradeDate },
            select: { limit: true, limitTimes: true },
          }),
        ])

        const b = breadthRows[0]
        const limitUp = Number(b.limit_up)
        const limitDown = Number(b.limit_down)
        const rise = Number(b.rise)
        const fall = Number(b.fall)
        const total = Number(b.total)

        const netAmount = mktFlowRow?.netAmount ?? null // 元
        const northMoney = hsgtRow?.northMoney ?? null // 百万元

        const pctChanges = sectorRows.map((r) => r.pctChange ?? 0)
        const sectorDivergence = this.computeStdDev(pctChanges)

        const peTtmMedian = valuationRows[0]?.pe_ttm_median != null ? Number(valuationRows[0].pe_ttm_median) : null

        const limitUpBroken = limitListRows.filter((r) => r.limit === 'Z').length

        // ─── 各维度得分（0–100）───────────────────────────────────────────────
        // 涨跌比得分：上涨家数 / 全市场总家数
        const breadthScore = total > 0 ? Math.min(100, Math.max(0, Math.round((rise / total) * 100))) : 50

        // 主力资金得分：以 ±500亿元（±5e10）为满分区间
        const mainFlowScore =
          netAmount != null ? Math.min(100, Math.max(0, Math.round((netAmount / 5e10) * 50 + 50))) : 50

        // 北向得分：以 ±200亿元（±20000 百万）为满分区间
        const northScore =
          northMoney != null ? Math.min(100, Math.max(0, Math.round((northMoney / 20000) * 50 + 50))) : 50

        // 估值得分：PE_TTM 越低越看多；以 PE=10 为 100 分，PE=50 为 0 分
        const valuationScore =
          peTtmMedian != null ? Math.min(100, Math.max(0, Math.round(100 - ((peTtmMedian - 10) / 40) * 100))) : 50

        // 综合得分
        const score = Math.round(0.4 * breadthScore + 0.3 * mainFlowScore + 0.2 * northScore + 0.1 * valuationScore)

        // ─── 基调判断 ──────────────────────────────────────────────────────────
        // 板块分化且整体偏强/偏弱：divergent；否则按综合分判断
        const isDivergent = sectorDivergence > 3 && Math.abs(breadthScore - mainFlowScore) > 25
        let tone: 'bullish' | 'bearish' | 'divergent' | 'neutral'
        if (isDivergent) {
          tone = 'divergent'
        } else if (score >= 65) {
          tone = 'bullish'
        } else if (score <= 35) {
          tone = 'bearish'
        } else {
          tone = 'neutral'
        }

        // ─── 一句话标题 ────────────────────────────────────────────────────────
        const riseRate = total > 0 ? Math.round((rise / total) * 100) : 0
        const headlines: Record<typeof tone, string> = {
          bullish: `全面普涨，${riseRate}% 个股上涨，做多情绪偏强`,
          bearish: `市场普跌，${riseRate}% 个股上涨，做空压力较大`,
          divergent: `分化行情，板块轮动明显，${riseRate}% 个股上涨`,
          neutral: `窄幅震荡，${riseRate}% 个股上涨，市场方向待明朗`,
        }
        const headline = headlines[tone]

        // ─── 支撑证据 ──────────────────────────────────────────────────────────
        const bullets: string[] = []
        bullets.push(`涨停 ${limitUp} 家，跌停 ${limitDown} 家`)
        if (limitUpBroken > 0) {
          const brokenRate =
            limitUp + limitUpBroken > 0 ? Math.round((limitUpBroken / (limitUp + limitUpBroken)) * 100) : 0
          bullets.push(`炸板 ${limitUpBroken} 家，炸板率 ${brokenRate}%`)
        }
        if (netAmount != null) {
          const net100M = (netAmount / 1e8).toFixed(1)
          bullets.push(`主力净${netAmount >= 0 ? '流入' : '流出'} ${Math.abs(Number(net100M))} 亿元`)
        }
        if (northMoney != null) {
          const north100M = (northMoney / 100).toFixed(1)
          bullets.push(`北向资金净${northMoney >= 0 ? '买入' : '卖出'} ${Math.abs(Number(north100M))} 亿元`)
        }
        if (peTtmMedian != null) {
          bullets.push(`全A PE_TTM 中位数 ${peTtmMedian.toFixed(1)}x`)
        }

        // ─── 关键事件 ──────────────────────────────────────────────────────────
        const keyEvents: Array<{
          category: 'breadth' | 'money_flow' | 'northbound' | 'sector' | 'limit_up' | 'valuation'
          title: string
          value?: number
        }> = [
          { category: 'breadth', title: `${rise} 家上涨 / ${fall} 家下跌`, value: riseRate },
          { category: 'limit_up', title: `涨停 ${limitUp} 家 / 炸板 ${limitUpBroken} 家`, value: limitUp },
        ]
        if (netAmount != null) {
          keyEvents.push({
            category: 'money_flow',
            title: `主力净流入 ${(netAmount / 1e8).toFixed(1)} 亿`,
            value: Number((netAmount / 1e8).toFixed(1)),
          })
        }
        if (northMoney != null) {
          keyEvents.push({
            category: 'northbound',
            title: `北向净${northMoney >= 0 ? '买入' : '卖出'} ${Math.abs(northMoney / 100).toFixed(1)} 亿`,
            value: Number((northMoney / 100).toFixed(1)),
          })
        }
        if (sectorDivergence > 0) {
          keyEvents.push({
            category: 'sector',
            title: `板块涨跌分化度（行业标准差）${sectorDivergence.toFixed(2)}`,
            value: Number(sectorDivergence.toFixed(2)),
          })
        }
        if (peTtmMedian != null) {
          keyEvents.push({
            category: 'valuation',
            title: `全A PE_TTM 中位数 ${peTtmMedian.toFixed(1)}`,
            value: Number(peTtmMedian.toFixed(1)),
          })
        }

        return { tradeDate, tone, headline, bullets, score, keyEvents }
      },
      (result) => !result,
    )
  }

  // ─── Top 异动合并（P2）──────────────────────────────────────────────────────

  async getTopMovers(query: { trade_date?: string; dim: 'gain' | 'loss' | 'amplitude' | 'amount'; limit?: number }) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return { data: [] }

    const dim = query.dim
    const limit = query.limit ?? 20
    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYY-MM-DD')
    const cacheKey = `market:top-movers:${tradeDateStr}:${dim}:${limit}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const orderExpr = {
        gain: Prisma.sql`d.pct_chg DESC NULLS LAST`,
        loss: Prisma.sql`d.pct_chg ASC NULLS LAST`,
        amplitude: Prisma.sql`CASE WHEN d.pre_close > 0 THEN (d.high - d.low) / d.pre_close * 100 ELSE NULL END DESC NULLS LAST`,
        amount: Prisma.sql`d.amount DESC NULLS LAST`,
      }[dim]

      const rows = await this.prisma.$queryRaw<
        Array<{
          ts_code: string
          name: string | null
          industry: string | null
          pct_chg: number | null
          amount: number | null
          turnover_rate: number | null
          amplitude: number | null
        }>
      >`
        SELECT
          d.ts_code,
          sb.name,
          sb.industry,
          d.pct_chg,
          d.amount,
          db.turnover_rate,
          CASE WHEN d.pre_close > 0 THEN ROUND(((d.high - d.low) / d.pre_close * 100)::numeric, 2) ELSE NULL END AS amplitude
        FROM stock_daily_prices d
        JOIN stock_basic_profiles sb ON sb.ts_code = d.ts_code
        LEFT JOIN stock_daily_valuation_metrics db ON db.ts_code = d.ts_code AND db.trade_date = d.trade_date
        WHERE d.trade_date = ${tradeDateStr}::date
        ORDER BY ${orderExpr}
        LIMIT ${limit}
      `

      return {
        data: rows.map((r) => ({
          tsCode: r.ts_code,
          name: r.name,
          industry: r.industry,
          pctChg: r.pct_chg !== null ? Number(r.pct_chg) : null,
          amount: r.amount !== null ? Number(r.amount) : null,
          turnoverRate: r.turnover_rate !== null ? Number(r.turnover_rate) : null,
          amplitude: r.amplitude !== null ? Number(r.amplitude) : null,
        })),
      }
    })
  }

  // ─── 数据日期汇总（供前端登录后初始化） ──────────────────────────────────────

  async getDataDates() {
    const [daily, index, sector, moneyflow, dailyBasic, hsgt] = await Promise.all([
      this.resolveLatestDailyTradeDate(),
      this.resolveLatestIndexTradeDate(),
      this.resolveLatestSectorTradeDate(),
      this.resolveLatestMarketTradeDate(),
      this.resolveLatestDailyBasicTradeDate(),
      this.resolveLatestHsgtTradeDate(),
    ])
    const fmt = (d: Date | null) => (d ? dayjs(d).tz('Asia/Shanghai').format('YYYYMMDD') : null)
    return {
      daily: fmt(daily),
      index: fmt(index),
      sector: fmt(sector),
      moneyflow: fmt(moneyflow),
      dailyBasic: fmt(dailyBasic),
      hsgt: fmt(hsgt),
    }
  }

  // ─── 行业涨跌幅 + 资金双榜 ────────────────────────────────────────────────────

  async getSectorTopBottom(query: { trade_date?: string; top_n?: number }) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate)
      return {
        tradeDate: null,
        pctGainers: [],
        pctLosers: [],
        flowGainers: [],
        flowLosers: [],
        gainersCount: 0,
        losersCount: 0,
        flatCount: 0,
        totalCount: 0,
      }

    const topN = query.top_n ?? 5
    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const cacheKey = `market:sector-top-bottom:${tradeDateStr}:${topN}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const all = await this.prisma.moneyflowIndDc.findMany({
        where: { tradeDate, contentType: MoneyflowContentType.INDUSTRY },
        select: { tsCode: true, name: true, pctChange: true, netAmount: true },
      })

      type Row = (typeof all)[0]
      const toItem = (r: Row) => ({
        tsCode: r.tsCode,
        name: r.name,
        pctChange: r.pctChange !== null ? Number(r.pctChange) : null,
        netAmount: r.netAmount !== null ? Number(r.netAmount) : null,
      })

      const gainers = all.filter((r) => (r.pctChange ?? 0) > 0.001)
      const losers = all.filter((r) => (r.pctChange ?? 0) < -0.001)
      const flowGainers = all.filter((r) => (r.netAmount ?? 0) > 0)
      const flowLosers = all.filter((r) => (r.netAmount ?? 0) < 0)
      const flat = all.length - gainers.length - losers.length

      gainers.sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))
      losers.sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0))
      flowGainers.sort((a, b) => (b.netAmount ?? 0) - (a.netAmount ?? 0))
      flowLosers.sort((a, b) => (a.netAmount ?? 0) - (b.netAmount ?? 0))

      return {
        tradeDate: tradeDateStr,
        pctGainers: gainers.slice(0, topN).map(toItem),
        pctLosers: losers.slice(0, topN).map(toItem),
        flowGainers: flowGainers.slice(0, topN).map(toItem),
        flowLosers: flowLosers.slice(0, topN).map(toItem),
        gainersCount: gainers.length,
        losersCount: losers.length,
        flatCount: flat,
        totalCount: all.length,
      }
    })
  }

  private computeStdDev(values: number[]): number {
    const n = values.length
    if (n <= 1) return 0
    const mean = values.reduce((a, b) => a + b, 0) / n
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
    return Math.sqrt(variance)
  }

  private async computeValuationPercentile(tradeDate: Date, field: 'pe_ttm' | 'pb') {
    const oneYearAgo = new Date(tradeDate)
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const threeYearAgo = new Date(tradeDate)
    threeYearAgo.setFullYear(threeYearAgo.getFullYear() - 3)
    const fiveYearAgo = new Date(tradeDate)
    fiveYearAgo.setFullYear(fiveYearAgo.getFullYear() - 5)

    const computePercentile = async (startDate: Date): Promise<number | null> => {
      const dailyMedians: { daily_median: string }[] =
        field === 'pe_ttm'
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

    // 顺序执行避免多个大范围 PERCENTILE_CONT 查询并发冲击
    const oneYear = await computePercentile(oneYearAgo)
    const threeYear = await computePercentile(threeYearAgo)
    const fiveYear = await computePercentile(fiveYearAgo)

    return { oneYear, threeYear, fiveYear }
  }

  private async resolveLatestMarketTradeDate() {
    const record = await this.prisma.moneyflow.findFirst({
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

  private async resolveLatestStockFlowTradeDate() {
    const record = await this.prisma.moneyflow.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private parseDate(value: string) {
    return dayjs.tz(value, 'YYYYMMDD', 'Asia/Shanghai').toDate()
  }

  private rememberMarketCache<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    skipCacheIf?: (v: T) => boolean,
  ) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.MARKET,
      key,
      ttlSeconds,
      loader,
      skipCacheIf,
    })
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
