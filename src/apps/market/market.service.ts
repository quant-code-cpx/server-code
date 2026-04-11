import { Injectable } from '@nestjs/common'
import { MoneyflowContentType, Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
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
      orderBy: [{ contentType: 'asc' }, { rank: 'asc' }, { netAmount: 'desc' }],
    })

    const applyLimit = (items: typeof rows) => (query.limit ? items.slice(0, query.limit) : items)

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

    // 当日 PE/PB 中位数（使用 PostgreSQL percentile_cont 函数）
    const currentMedian = await this.prisma.$queryRaw<{ pe_ttm_median: number; pb_median: number }[]>`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm) AS pe_ttm_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)     AS pb_median
      FROM stock_daily_valuation_metrics
      WHERE trade_date = ${tradeDateStr}::date
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

  async getIndexQuote(query: IndexQuoteQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestIndexTradeDate()
    if (!tradeDate) {
      return []
    }

    const tsCodeFilter = query.ts_codes && query.ts_codes.length > 0 ? { in: query.ts_codes } : undefined

    return this.prisma.indexDaily.findMany({
      where: { tradeDate, ...(tsCodeFilter ? { tsCode: tsCodeFilter } : {}) },
      orderBy: { tsCode: 'asc' },
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

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const latestDate = await this.resolveLatestIndexTradeDate()
      if (!latestDate) return { tsCode, name: MarketService.INDEX_NAME_MAP[tsCode] ?? tsCode, period, data: [] }

      const startDate = this.periodToStartDate(latestDate, period as IndexTrendPeriod)

      const rows = await this.prisma.indexDaily.findMany({
        where: { tsCode, tradeDate: { gte: startDate } },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, close: true, pctChg: true, vol: true, amount: true },
      })

      return {
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
    })
  }

  // ─── 市场涨跌分布 ──────────────────────────────────────────────────────────

  async getChangeDistribution(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestDailyTradeDate()
    if (!tradeDate) return null

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYY-MM-DD')
    const cacheKey = `market:change-dist:${tradeDateStr}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      // 使用 PostgreSQL width_bucket 按 1% 步长分桶
      const bucketRows = await this.prisma.$queryRaw<{ bucket: number; cnt: bigint }[]>`
        SELECT
          width_bucket(pct_chg, -11, 11, 22) AS bucket,
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

      return { tradeDate, limitUp, limitDown, distribution }
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
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `market:vol-overview:${tradeDateStr}:${days}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
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

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const dateRows = await this.prisma.$queryRaw<{ trade_date: Date }[]>`
        SELECT DISTINCT trade_date
        FROM stock_daily_prices
        WHERE trade_date <= ${tradeDate}
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
    })
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
      const rows = await this.prisma.moneyflowMktDc.findMany({
        where: { tradeDate: { lte: tradeDate } },
        orderBy: { tradeDate: 'desc' },
        take: days,
      })

      const sorted = rows.reverse()
      let cumulative = 0
      return {
        data: sorted.map((r) => {
          cumulative += r.netAmount ?? 0
          return {
            tradeDate: dayjs(r.tradeDate).format('YYYY-MM-DD'),
            netAmount: r.netAmount,
            cumulativeNet: Number(cumulative.toFixed(2)),
            buyElgAmount: r.buyElgAmount,
            buyLgAmount: r.buyLgAmount,
            buyMdAmount: r.buyMdAmount,
            buySmAmount: r.buySmAmount,
          }
        }),
      }
    })
  }

  // ─── 板块资金流向排行 ──────────────────────────────────────────────────────

  async getSectorFlowRanking(query: SectorFlowRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: null, contentType: query.content_type ?? 'INDUSTRY', sectors: [] }

    const contentType = (query.content_type ?? 'INDUSTRY') as MoneyflowContentType
    const sortBy = query.sort_by ?? 'net_amount'
    const order = (query.order ?? 'desc') as 'asc' | 'desc'
    const limit = query.limit ?? 20

    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
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
    if (!tradeDate) return { tradeDate: null, data: [] }

    const order = query.order ?? 'desc'
    const limit = query.limit ?? 20

    const tradeDateStr = dayjs(tradeDate).tz('Asia/Shanghai').format('YYYYMMDD')
    const cacheKey = `market:main-flow-rank:${tradeDateStr}:${order}:${limit}`

    return this.rememberMarketCache(cacheKey, MARKET_STANDARD_CACHE_TTL_SECONDS, async () => {
      const rows = await this.prisma.$queryRaw<
        {
          ts_code: string
          name: string | null
          industry: string | null
          main_net_inflow: string
          elg_net_inflow: string
          lg_net_inflow: string
          pct_chg: number | null
          amount: number | null
        }[]
      >`
        SELECT
          mf.ts_code,
          sb.name,
          sb.industry,
          (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0)
           + COALESCE(mf.buy_lg_amount, 0)  - COALESCE(mf.sell_lg_amount, 0))  AS main_net_inflow,
          (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0))   AS elg_net_inflow,
          (COALESCE(mf.buy_lg_amount, 0)  - COALESCE(mf.sell_lg_amount, 0))    AS lg_net_inflow,
          d.pct_chg,
          d.amount
        FROM stock_capital_flows mf
        JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        LEFT JOIN stock_daily_prices d ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
        WHERE mf.trade_date = ${tradeDateStr}::date
        ORDER BY main_net_inflow ${order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`}
        LIMIT ${limit}
      `

      return {
        tradeDate,
        data: rows.map((r) => ({
          tsCode: r.ts_code,
          name: r.name,
          industry: r.industry,
          mainNetInflow: Number(r.main_net_inflow),
          elgNetInflow: Number(r.elg_net_inflow),
          lgNetInflow: Number(r.lg_net_inflow),
          pctChg: r.pct_chg !== null ? Number(r.pct_chg) : null,
          amount: r.amount !== null ? Number(r.amount) : null,
        })),
      }
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
    const where: Record<string, unknown> = { type: 'N' }
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
    return { tsCode, name: board?.name ?? null, total, items }
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

  private rememberMarketCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.MARKET,
      key,
      ttlSeconds,
      loader,
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
