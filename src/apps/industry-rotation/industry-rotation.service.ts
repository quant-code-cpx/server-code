import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as dayjs from 'dayjs'
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { ReturnComparisonQueryDto } from './dto/return-comparison-query.dto'
import { MomentumRankingQueryDto } from './dto/momentum-ranking-query.dto'
import { FlowAnalysisQueryDto } from './dto/flow-analysis-query.dto'
import { IndustryValuationQueryDto } from './dto/industry-valuation-query.dto'
import { RotationOverviewQueryDto } from './dto/rotation-overview-query.dto'
import { IndustryDetailQueryDto } from './dto/industry-detail-query.dto'
import { RotationHeatmapQueryDto } from './dto/rotation-heatmap-query.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

const STANDARD_TTL = 4 * 3600
const EXTENDED_TTL = 8 * 3600

@Injectable()
export class IndustryRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ─── 行业收益对比 ─────────────────────────────────────────────────────────

  async getReturnComparison(query: ReturnComparisonQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: null, industries: [] }

    const periods = (query.periods ?? [5, 20, 60]).slice(0, 5)
    const sortPeriod = query.sort_period ?? 20
    const order = query.order ?? 'desc'
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `ind-rotation:return:${tradeDateStr}:${periods.join(',')}:${sortPeriod}:${order}`

    return this.rememberCache(cacheKey, STANDARD_TTL, async () => {
      const rows = await this.fetchReturnComparisonRows(tradeDate, periods)

      const industries = rows.map((r) => {
        const returns: Record<number, number | null> = {}
        for (const p of periods) {
          const raw = (r as any)[`return_${p}`]
          returns[p] = raw !== null && raw !== undefined ? Number((Number(raw) * 100).toFixed(4)) : null
        }
        return {
          tsCode: r.ts_code,
          name: r.name,
          returns,
          latestPctChange: r.latest_pct_change !== null ? Number(Number(r.latest_pct_change).toFixed(4)) : null,
          latestClose: r.latest_close !== null ? Number(r.latest_close) : null,
        }
      })

      industries.sort((a, b) => {
        const av = a.returns[sortPeriod] ?? null
        const bv = b.returns[sortPeriod] ?? null
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return order === 'desc' ? bv - av : av - bv
      })

      return { tradeDate: tradeDateStr, industries }
    })
  }

  // ─── 行业动量排名 ─────────────────────────────────────────────────────────

  async getMomentumRanking(query: MomentumRankingQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: null, method: query.method ?? 'weighted', industries: [] }

    const method = query.method ?? 'weighted'
    const weights = query.weights ?? [0.3, 0.4, 0.3]
    const order = query.order ?? 'desc'
    const limit = query.limit
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `ind-rotation:momentum:${tradeDateStr}:${method}:${order}:${limit ?? 'all'}`

    return this.rememberCache(cacheKey, STANDARD_TTL, async () => {
      const rows = await this.fetchReturnComparisonRows(tradeDate, [5, 20, 60])

      const totalW = weights[0] + weights[1] + weights[2]
      const w = weights.map((wt) => wt / totalW)

      const industries = rows.map((r) => {
        const r5 =
          (r as any).return_5 !== null && (r as any).return_5 !== undefined
            ? Number((r as any).return_5) * 100
            : null
        const r20 =
          (r as any).return_20 !== null && (r as any).return_20 !== undefined
            ? Number((r as any).return_20) * 100
            : null
        const r60 =
          (r as any).return_60 !== null && (r as any).return_60 !== undefined
            ? Number((r as any).return_60) * 100
            : null

        let momentumScore: number
        if (method === 'simple') {
          momentumScore = r20 ?? 0
        } else {
          const available: { val: number; weight: number }[] = []
          if (r5 !== null) available.push({ val: r5, weight: w[0] })
          if (r20 !== null) available.push({ val: r20, weight: w[1] })
          if (r60 !== null) available.push({ val: r60, weight: w[2] })
          if (available.length === 0) {
            momentumScore = 0
          } else {
            const totalAvailW = available.reduce((s, x) => s + x.weight, 0)
            momentumScore = available.reduce((s, x) => s + (x.val * x.weight) / totalAvailW, 0)
          }
        }

        return {
          tsCode: r.ts_code,
          name: r.name,
          momentumScore: Number(momentumScore.toFixed(4)),
          return5d: r5 !== null ? Number(r5.toFixed(4)) : null,
          return20d: r20 !== null ? Number(r20.toFixed(4)) : null,
          return60d: r60 !== null ? Number(r60.toFixed(4)) : null,
          latestPctChange: r.latest_pct_change !== null ? Number(Number(r.latest_pct_change).toFixed(4)) : null,
          rank: 0,
        }
      })

      industries.sort((a, b) =>
        order === 'desc' ? b.momentumScore - a.momentumScore : a.momentumScore - b.momentumScore,
      )

      industries.forEach((item, i) => {
        item.rank = i + 1
      })

      const result = limit ? industries.slice(0, limit) : industries
      return { tradeDate: tradeDateStr, method, industries: result }
    })
  }

  // ─── 行业资金流转分析 ─────────────────────────────────────────────────────

  async getFlowAnalysis(query: FlowAnalysisQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestSectorTradeDate()
    if (!tradeDate)
      return {
        tradeDate: null,
        days: query.days ?? 5,
        industries: [],
        summary: { inflowCount: 0, outflowCount: 0, topInflowNames: [], topOutflowNames: [] },
      }

    const days = query.days ?? 5
    const sortBy = query.sort_by ?? 'cumulative_net'
    const order = query.order ?? 'desc'
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `ind-rotation:flow:${tradeDateStr}:${days}:${sortBy}:${order}`

    return this.rememberCache(cacheKey, STANDARD_TTL, async () => {
      const daysX2 = days * 2
      const halfDays = Math.ceil(days / 2)

      type FlowRow = {
        ts_code: string
        name: string
        cumulative_net: string | null
        avg_daily_net: string | null
        cum_buy_elg: string | null
        cum_buy_lg: string | null
        recent_half_net: string | null
        earlier_half_net: string | null
        prev_period_net: string | null
        cumulative_return: string | null
        latest_day_rank: number | null
      }

      const rows = await this.prisma.$queryRaw<FlowRow[]>(
        Prisma.sql`
          WITH date_range AS (
            SELECT DISTINCT trade_date
            FROM sector_capital_flows
            WHERE content_type = '行业' AND trade_date <= ${tradeDate}
            ORDER BY trade_date DESC
            LIMIT ${daysX2}
          ),
          recent AS (
            SELECT scf.*,
              ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS day_rn
            FROM sector_capital_flows scf
            JOIN date_range dr ON dr.trade_date = scf.trade_date
            WHERE scf.content_type = '行业'
          ),
          latest_rank AS (
            SELECT ts_code, rank AS latest_day_rank
            FROM sector_capital_flows
            WHERE content_type = '行业' AND trade_date = ${tradeDate}
          ),
          base_close AS (
            SELECT ts_code, MAX(close) FILTER (WHERE day_rn = ${days}) AS base_close_val,
                   MAX(close) FILTER (WHERE day_rn = 1) AS latest_close_val
            FROM recent
            GROUP BY ts_code
          )
          SELECT
            r.ts_code,
            MAX(r.name) AS name,
            SUM(r.net_amount) FILTER (WHERE r.day_rn <= ${days}) AS cumulative_net,
            AVG(r.net_amount) FILTER (WHERE r.day_rn <= ${days}) AS avg_daily_net,
            SUM(r.buy_elg_amount) FILTER (WHERE r.day_rn <= ${days}) AS cum_buy_elg,
            SUM(r.buy_lg_amount) FILTER (WHERE r.day_rn <= ${days}) AS cum_buy_lg,
            SUM(r.net_amount) FILTER (WHERE r.day_rn <= ${halfDays}) AS recent_half_net,
            SUM(r.net_amount) FILTER (WHERE r.day_rn > ${halfDays} AND r.day_rn <= ${days}) AS earlier_half_net,
            SUM(r.net_amount) FILTER (WHERE r.day_rn > ${days} AND r.day_rn <= ${daysX2}) AS prev_period_net,
            (bc.latest_close_val / NULLIF(bc.base_close_val, 0) - 1) * 100 AS cumulative_return,
            lr.latest_day_rank
          FROM recent r
          LEFT JOIN base_close bc ON bc.ts_code = r.ts_code
          LEFT JOIN latest_rank lr ON lr.ts_code = r.ts_code
          GROUP BY r.ts_code, lr.latest_day_rank, bc.latest_close_val, bc.base_close_val
        `,
      )

      const industries = rows.map((r) => {
        const cumulativeNet = r.cumulative_net !== null ? Number(r.cumulative_net) : 0
        const avgDailyNet = r.avg_daily_net !== null ? Number(r.avg_daily_net) : 0
        const cumBuyElg = r.cum_buy_elg !== null ? Number(r.cum_buy_elg) : 0
        const cumBuyLg = r.cum_buy_lg !== null ? Number(r.cum_buy_lg) : 0
        const recentHalf = r.recent_half_net !== null ? Number(r.recent_half_net) : 0
        const earlierHalf = r.earlier_half_net !== null ? Number(r.earlier_half_net) : 0
        const prevPeriod = r.prev_period_net !== null ? Number(r.prev_period_net) : null
        const flowMomentum = recentHalf - earlierHalf
        const flowAcceleration = prevPeriod !== null ? cumulativeNet - prevPeriod : null
        const mainForceRatio = cumulativeNet !== 0 ? (cumBuyElg + cumBuyLg) / cumulativeNet : null

        return {
          tsCode: r.ts_code,
          name: r.name,
          cumulativeNetAmount: Number(cumulativeNet.toFixed(2)),
          avgDailyNetAmount: Number(avgDailyNet.toFixed(2)),
          cumulativeReturn: r.cumulative_return !== null ? Number(Number(r.cumulative_return).toFixed(4)) : null,
          flowMomentum: Number(flowMomentum.toFixed(2)),
          flowAcceleration: flowAcceleration !== null ? Number(flowAcceleration.toFixed(2)) : null,
          cumulativeBuyElg: Number(cumBuyElg.toFixed(2)),
          cumulativeBuyLg: Number(cumBuyLg.toFixed(2)),
          mainForceRatio: mainForceRatio !== null ? Number(mainForceRatio.toFixed(4)) : null,
          latestDayRank: r.latest_day_rank ?? null,
        }
      })

      industries.sort((a, b) => {
        let av: number, bv: number
        if (sortBy === 'flow_momentum') {
          av = a.flowMomentum
          bv = b.flowMomentum
        } else if (sortBy === 'avg_daily_net') {
          av = a.avgDailyNetAmount
          bv = b.avgDailyNetAmount
        } else {
          av = a.cumulativeNetAmount
          bv = b.cumulativeNetAmount
        }
        return order === 'desc' ? bv - av : av - bv
      })

      if (query.limit) {
        industries.splice(query.limit)
      }

      const inflowIndustries = rows.filter((r) => (r.cumulative_net !== null ? Number(r.cumulative_net) : 0) > 0)
      const outflowIndustries = rows.filter((r) => (r.cumulative_net !== null ? Number(r.cumulative_net) : 0) <= 0)
      const sortedByNet = [...industries].sort((a, b) => b.cumulativeNetAmount - a.cumulativeNetAmount)

      const summary = {
        inflowCount: inflowIndustries.length,
        outflowCount: outflowIndustries.length,
        topInflowNames: sortedByNet.slice(0, 5).map((i) => i.name),
        topOutflowNames: sortedByNet
          .slice(-5)
          .reverse()
          .map((i) => i.name),
      }

      return { tradeDate: tradeDateStr, days, industries, summary }
    })
  }

  // ─── 行业估值分位 ─────────────────────────────────────────────────────────

  async getIndustryValuation(query: IndustryValuationQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestDailyBasicTradeDate()
    if (!tradeDate) return { tradeDate: null, industries: [] }

    const industryFilter = query.industry ?? null
    const sortBy = query.sort_by ?? 'pe_percentile_1y'
    const order = query.order ?? 'asc'
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `ind-rotation:val:${tradeDateStr}:${industryFilter ?? 'all'}:${sortBy}:${order}`

    return this.rememberCache(cacheKey, EXTENDED_TTL, async () => {
      type CurrentRow = {
        industry: string
        stock_count: number
        pe_ttm_median: number | null
        pb_median: number | null
      }

      const currentRows = await this.prisma.$queryRaw<CurrentRow[]>(
        Prisma.sql`
          SELECT
            sb.industry,
            COUNT(*)::int AS stock_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pe_ttm) AS pe_ttm_median,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pb)     AS pb_median
          FROM stock_daily_valuation_metrics db
          JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
          WHERE db.trade_date = ${tradeDate}
            AND sb.list_status = 'L'
            AND sb.industry IS NOT NULL AND sb.industry != ''
            AND db.pe_ttm > 0 AND db.pe_ttm < 1000
            AND db.pb > 0
            ${industryFilter ? Prisma.sql`AND sb.industry = ${industryFilter}` : Prisma.empty}
          GROUP BY sb.industry
        `,
      )

      if (currentRows.length === 0) return { tradeDate: tradeDateStr, industries: [] }

      const oneYearAgo = new Date(tradeDate)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

      const threeYearAgo = new Date(tradeDate)
      threeYearAgo.setFullYear(threeYearAgo.getFullYear() - 3)

      type PercentileRow = { industry: string; pe_percentile: number | null; pb_percentile: number | null }

      const [percentile1y, percentile3y] = await Promise.all([
        this.prisma.$queryRaw<PercentileRow[]>(
          Prisma.sql`
            WITH daily_medians AS (
              SELECT sb.industry, db.trade_date,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pe_ttm) AS pe_ttm_median,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pb) AS pb_median
              FROM stock_daily_valuation_metrics db
              JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
              WHERE db.trade_date >= ${oneYearAgo} AND db.trade_date <= ${tradeDate}
                AND sb.list_status = 'L'
                AND sb.industry IS NOT NULL AND sb.industry != ''
                AND db.pe_ttm > 0 AND db.pe_ttm < 1000 AND db.pb > 0
                ${industryFilter ? Prisma.sql`AND sb.industry = ${industryFilter}` : Prisma.empty}
              GROUP BY sb.industry, db.trade_date
            ),
            ranked AS (
              SELECT industry, trade_date, pe_ttm_median, pb_median,
                PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pe_ttm_median) * 100 AS pe_percentile,
                PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pb_median) * 100 AS pb_percentile
              FROM daily_medians
            )
            SELECT industry, pe_percentile, pb_percentile FROM ranked WHERE trade_date = ${tradeDate}
          `,
        ),
        this.prisma.$queryRaw<PercentileRow[]>(
          Prisma.sql`
            WITH all_dates AS (
              SELECT DISTINCT trade_date
              FROM stock_daily_valuation_metrics
              WHERE trade_date >= ${threeYearAgo} AND trade_date <= ${tradeDate}
            ),
            weekly_dates AS (
              SELECT trade_date
              FROM (
                SELECT trade_date,
                  ROW_NUMBER() OVER (
                    PARTITION BY DATE_TRUNC('week', trade_date) ORDER BY trade_date DESC
                  ) AS rn
                FROM all_dates
              ) t
              WHERE rn = 1
            ),
            daily_medians AS (
              SELECT sb.industry, db.trade_date,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pe_ttm) AS pe_ttm_median,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pb) AS pb_median
              FROM stock_daily_valuation_metrics db
              JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
              JOIN weekly_dates wd ON wd.trade_date = db.trade_date
              WHERE sb.list_status = 'L'
                AND sb.industry IS NOT NULL AND sb.industry != ''
                AND db.pe_ttm > 0 AND db.pe_ttm < 1000 AND db.pb > 0
                ${industryFilter ? Prisma.sql`AND sb.industry = ${industryFilter}` : Prisma.empty}
              GROUP BY sb.industry, db.trade_date
            ),
            ranked AS (
              SELECT industry, trade_date, pe_ttm_median, pb_median,
                PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pe_ttm_median) * 100 AS pe_percentile,
                PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pb_median) * 100 AS pb_percentile
              FROM daily_medians
            )
            SELECT industry, pe_percentile, pb_percentile FROM ranked
            WHERE trade_date = (SELECT MAX(trade_date) FROM weekly_dates WHERE trade_date <= ${tradeDate})
          `,
        ),
      ])

      const p1yMap = new Map(percentile1y.map((r) => [r.industry, r]))
      const p3yMap = new Map(percentile3y.map((r) => [r.industry, r]))

      const industries = currentRows.map((r) => {
        const p1y = p1yMap.get(r.industry)
        const p3y = p3yMap.get(r.industry)
        const peTtmPercentile1y =
          p1y?.pe_percentile !== null && p1y?.pe_percentile !== undefined
            ? Number(Number(p1y.pe_percentile).toFixed(2))
            : null

        return {
          industry: r.industry,
          stockCount: r.stock_count,
          peTtmMedian: r.pe_ttm_median !== null ? Number(Number(r.pe_ttm_median).toFixed(2)) : null,
          pbMedian: r.pb_median !== null ? Number(Number(r.pb_median).toFixed(2)) : null,
          peTtmPercentile1y,
          peTtmPercentile3y:
            p3y?.pe_percentile !== null && p3y?.pe_percentile !== undefined
              ? Number(Number(p3y.pe_percentile).toFixed(2))
              : null,
          pbPercentile1y:
            p1y?.pb_percentile !== null && p1y?.pb_percentile !== undefined
              ? Number(Number(p1y.pb_percentile).toFixed(2))
              : null,
          pbPercentile3y:
            p3y?.pb_percentile !== null && p3y?.pb_percentile !== undefined
              ? Number(Number(p3y.pb_percentile).toFixed(2))
              : null,
          valuationLabel: this.getValuationLabel(peTtmPercentile1y),
        }
      })

      industries.sort((a, b) => {
        const av = (a as any)[this.mapSortByField(sortBy)] ?? null
        const bv = (b as any)[this.mapSortByField(sortBy)] ?? null
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return order === 'asc' ? av - bv : bv - av
      })

      return { tradeDate: tradeDateStr, industries }
    })
  }

  // ─── 行业轮动总览 ─────────────────────────────────────────────────────────

  async getRotationOverview(query: RotationOverviewQueryDto) {
    const tradeDate = query.trade_date

    const [returns, momentum, flow, valuation] = await Promise.all([
      this.getReturnComparison({ trade_date: tradeDate, periods: [20], sort_period: 20, order: 'desc' }),
      this.getMomentumRanking({ trade_date: tradeDate, method: 'weighted', order: 'desc' }),
      this.getFlowAnalysis({ trade_date: tradeDate, days: 5, sort_by: 'cumulative_net', order: 'desc' }),
      this.getIndustryValuation({ trade_date: tradeDate, sort_by: 'pe_percentile_1y', order: 'asc' }),
    ])

    const tradeDateStr =
      (returns as any).tradeDate ?? (valuation as any).tradeDate ?? dayjs().format('YYYYMMDD')

    const returnIndustries = (returns as any).industries ?? []
    const momentumIndustries = (momentum as any).industries ?? []
    const flowIndustries = (flow as any).industries ?? []
    const valuationIndustries = (valuation as any).industries ?? []

    return {
      tradeDate: tradeDateStr,
      returnSnapshot: {
        topGainers: returnIndustries.slice(0, 5).map((i: any) => ({
          name: i.name,
          return20d: i.returns?.[20] ?? 0,
        })),
        topLosers: returnIndustries
          .slice(-5)
          .reverse()
          .map((i: any) => ({
            name: i.name,
            return20d: i.returns?.[20] ?? 0,
          })),
      },
      momentumSnapshot: {
        leaders: momentumIndustries.slice(0, 5).map((i: any) => ({
          name: i.name,
          momentumScore: i.momentumScore,
        })),
        laggards: momentumIndustries
          .slice(-5)
          .reverse()
          .map((i: any) => ({
            name: i.name,
            momentumScore: i.momentumScore,
          })),
      },
      flowSnapshot: {
        topInflow: flowIndustries.slice(0, 5).map((i: any) => ({
          name: i.name,
          cumulativeNetAmount: i.cumulativeNetAmount,
        })),
        topOutflow: [...flowIndustries]
          .sort((a: any, b: any) => a.cumulativeNetAmount - b.cumulativeNetAmount)
          .slice(0, 5)
          .map((i: any) => ({ name: i.name, cumulativeNetAmount: i.cumulativeNetAmount })),
      },
      valuationSnapshot: {
        undervalued: valuationIndustries.slice(0, 5).map((i: any) => ({
          name: i.industry,
          peTtmPercentile1y: i.peTtmPercentile1y,
        })),
        overvalued: [...valuationIndustries]
          .sort((a: any, b: any) => (b.peTtmPercentile1y ?? 0) - (a.peTtmPercentile1y ?? 0))
          .slice(0, 5)
          .map((i: any) => ({ name: i.industry, peTtmPercentile1y: i.peTtmPercentile1y })),
      },
    }
  }

  // ─── 单行业详情 ───────────────────────────────────────────────────────────

  async getIndustryDetail(query: IndustryDetailQueryDto) {
    const industry = query.industry
    const days = query.days ?? 20
    const cacheKey = `ind-rotation:detail:${encodeURIComponent(industry)}:${days}`

    return this.rememberCache(cacheKey, STANDARD_TTL, async () => {
      type CodeRow = { ts_code: string; name: string }
      const codeRows = await this.prisma.$queryRaw<CodeRow[]>(
        Prisma.sql`
          SELECT DISTINCT ts_code, name
          FROM sector_capital_flows
          WHERE content_type = '行业' AND name = ${industry}
          LIMIT 1
        `,
      )
      const tsCode = codeRows[0]?.ts_code ?? null

      const [latestSectorDate, latestDailyBasicDate] = await Promise.all([
        this.resolveLatestSectorTradeDate(),
        this.resolveLatestDailyBasicTradeDate(),
      ])

      let returnTrend: any[] = []
      let flowTrend: any[] = []
      if (tsCode && latestSectorDate) {
        type TrendRow = {
          trade_date: Date
          close: number | null
          pct_change: number | null
          net_amount: number | null
          buy_elg_amount: number | null
          buy_lg_amount: number | null
        }
        const trendRows = await this.prisma.$queryRaw<TrendRow[]>(
          Prisma.sql`
            SELECT trade_date, close, pct_change, net_amount, buy_elg_amount, buy_lg_amount
            FROM sector_capital_flows
            WHERE content_type = '行业'
              AND ts_code = ${tsCode}
              AND trade_date <= ${latestSectorDate}
            ORDER BY trade_date DESC
            LIMIT ${days}
          `,
        )
        trendRows.reverse()

        const firstClose = trendRows[0]?.close ?? null
        let cumulativeNet = 0
        returnTrend = trendRows.map((r) => ({
          tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
          close: r.close !== null ? Number(r.close) : 0,
          pctChange: r.pct_change !== null ? Number(r.pct_change) : 0,
          cumulativeReturn:
            firstClose && r.close
              ? Number(((Number(r.close) / Number(firstClose) - 1) * 100).toFixed(4))
              : 0,
        }))

        flowTrend = trendRows.map((r) => {
          cumulativeNet += r.net_amount !== null ? Number(r.net_amount) : 0
          return {
            tradeDate: dayjs(r.trade_date).format('YYYY-MM-DD'),
            netAmount: r.net_amount !== null ? Number(r.net_amount) : 0,
            cumulativeNet: Number(cumulativeNet.toFixed(2)),
            buyElgAmount: r.buy_elg_amount !== null ? Number(r.buy_elg_amount) : 0,
            buyLgAmount: r.buy_lg_amount !== null ? Number(r.buy_lg_amount) : 0,
          }
        })
      }

      let valuation: any = null
      if (latestDailyBasicDate) {
        const valResult = await this.getIndustryValuation({
          trade_date: dayjs(latestDailyBasicDate).format('YYYYMMDD'),
          industry,
        })
        const item = (valResult as any).industries?.[0] ?? null
        if (item) {
          valuation = {
            peTtmMedian: item.peTtmMedian,
            pbMedian: item.pbMedian,
            peTtmPercentile1y: item.peTtmPercentile1y,
            pbPercentile1y: item.pbPercentile1y,
            valuationLabel: item.valuationLabel,
          }
        }
      }

      type StockRow = {
        ts_code: string
        name: string
        pct_chg: number | null
        pe_ttm: number | null
        pb: number | null
        total_mv: string | null
      }
      const latestStockDate = latestDailyBasicDate
      let topStocks: any[] = []
      if (latestStockDate) {
        const stockRows = await this.prisma.$queryRaw<StockRow[]>(
          Prisma.sql`
            SELECT
              sb.ts_code, sb.name,
              d.pct_chg,
              db.pe_ttm, db.pb, db.total_mv
            FROM stock_basic_profiles sb
            LEFT JOIN stock_daily_prices d ON d.ts_code = sb.ts_code AND d.trade_date = ${latestStockDate}
            LEFT JOIN stock_daily_valuation_metrics db ON db.ts_code = sb.ts_code AND db.trade_date = ${latestStockDate}
            WHERE sb.industry = ${industry} AND sb.list_status = 'L'
            ORDER BY db.total_mv DESC NULLS LAST
            LIMIT 20
          `,
        )
        topStocks = stockRows.map((r) => ({
          tsCode: r.ts_code,
          name: r.name,
          pctChg: r.pct_chg !== null ? Number(r.pct_chg) : null,
          peTtm: r.pe_ttm !== null ? Number(r.pe_ttm) : null,
          pb: r.pb !== null ? Number(r.pb) : null,
          totalMv: r.total_mv !== null ? Number(r.total_mv) : null,
        }))
      }

      return { industry, tsCode, returnTrend, flowTrend, valuation, topStocks }
    })
  }

  // ─── 行业轮动热力图 ───────────────────────────────────────────────────────

  async getRotationHeatmap(query: RotationHeatmapQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestSectorTradeDate()
    if (!tradeDate)
      return { tradeDate: null, periods: query.periods ?? [1, 5, 10, 20, 60], industries: [] }

    const periods = (query.periods ?? [1, 5, 10, 20, 60]).slice(0, 10)
    const tradeDateStr = dayjs(tradeDate).format('YYYYMMDD')
    const cacheKey = `ind-rotation:heatmap:${tradeDateStr}:${periods.join(',')}`

    return this.rememberCache(cacheKey, STANDARD_TTL, async () => {
      const rows = await this.fetchReturnComparisonRows(tradeDate, periods)

      const industries = rows.map((r) => {
        const returns: Record<number, number | null> = {}
        for (const p of periods) {
          const raw = (r as any)[`return_${p}`]
          returns[p] = raw !== null && raw !== undefined ? Number((Number(raw) * 100).toFixed(4)) : null
        }
        return { tsCode: r.ts_code, name: r.name, returns }
      })

      industries.sort((a, b) => {
        const av = a.returns[1] ?? a.returns[periods[0]] ?? null
        const bv = b.returns[1] ?? b.returns[periods[0]] ?? null
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return bv - av
      })

      return { tradeDate: tradeDateStr, periods, industries }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 私有辅助方法
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchReturnComparisonRows(tradeDate: Date, periods: number[]) {
    const joinClauses = periods
      .map((p) => `LEFT JOIN ranked r${p} ON r${p}.ts_code = r0.ts_code AND r${p}.rn = ${p + 1}`)
      .join('\n    ')

    const selectClauses = periods
      .map((p) => `r0.close / NULLIF(r${p}.close, 0) - 1 AS return_${p}`)
      .join(',\n    ')

    type ReturnRow = {
      ts_code: string
      name: string
      latest_close: number | null
      latest_pct_change: number | null
      [key: string]: unknown
    }

    const sql = `
      WITH ranked AS (
        SELECT
          ts_code,
          name,
          trade_date,
          close,
          pct_change,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM sector_capital_flows
        WHERE content_type = '行业'
          AND trade_date <= $1
      )
      SELECT
        r0.ts_code,
        r0.name,
        r0.close AS latest_close,
        r0.pct_change AS latest_pct_change,
        ${selectClauses}
      FROM ranked r0
      ${joinClauses}
      WHERE r0.rn = 1
    `

    const rows = await this.prisma.$queryRawUnsafe<ReturnRow[]>(sql, tradeDate)
    return rows
  }

  private async resolveLatestSectorTradeDate() {
    const record = await this.prisma.moneyflowIndDc.findFirst({
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

  private parseDate(value: string) {
    return (dayjs as any).tz(value, 'YYYYMMDD', 'Asia/Shanghai').toDate()
  }

  private rememberCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.INDUSTRY_ROTATION,
      key,
      ttlSeconds,
      loader,
    })
  }

  private getValuationLabel(percentile: number | null): '低估' | '适中' | '偏高' | '高估' {
    if (percentile === null) return '适中'
    if (percentile < 25) return '低估'
    if (percentile < 50) return '适中'
    if (percentile < 75) return '偏高'
    return '高估'
  }

  private mapSortByField(sortBy: string): string {
    const map: Record<string, string> = {
      pe_ttm: 'peTtmMedian',
      pb: 'pbMedian',
      pe_percentile_1y: 'peTtmPercentile1y',
      pb_percentile_1y: 'pbPercentile1y',
    }
    return map[sortBy] ?? 'peTtmPercentile1y'
  }
}
