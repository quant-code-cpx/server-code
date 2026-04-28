import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
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

/** Row returned from $queryRawUnsafe — column values from PostgreSQL */
type RawRow = Record<string, string | number | bigint | boolean | Date | null>

dayjs.extend(utc)
dayjs.extend(timezone)

const STANDARD_CACHE_TTL = 4 * 3600
const EXTENDED_CACHE_TTL = 8 * 3600

@Injectable()
export class IndustryRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ─── 3.1 行业收益对比 ─────────────────────────────────────────────────────

  async getReturnComparison(query: ReturnComparisonQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: '', industries: [] }

    const periods = query.periods ?? [5, 20, 60]
    const sortPeriod = query.sort_period ?? 20
    const order = query.order ?? 'desc'
    const tradeDateStr = this.formatDateStr(tradeDate)
    // sortPeriod 必须存在于 SELECT 列中；若不在 periods 里则追加，确保别名 return_N 可被 ORDER BY 引用
    const effectivePeriods = periods.includes(sortPeriod) ? periods : [...periods, sortPeriod]
    const maxPeriod = Math.max(...effectivePeriods)

    const cacheKey = this.cacheService.buildKey('ind-rotation:return', {
      tradeDateStr,
      periods,
      sortPeriod,
      order,
    })

    return this.rememberCache(cacheKey, STANDARD_CACHE_TTL, async () => {
      // Build dynamic columns for each period
      const periodColumns = effectivePeriods
        .map((p) => `MAX(CASE WHEN rn = ${p + 1} THEN close END) AS close_${p}`)
        .join(',\n      ')

      const returnColumns = effectivePeriods
        .map((p) => `ROUND((((latest.close / NULLIF(agg.close_${p}, 0)) - 1) * 100)::numeric, 4) AS return_${p}`)
        .join(',\n    ')

      const sortColumn = `return_${sortPeriod}`
      const orderDir = order === 'asc' ? 'ASC' : 'DESC'

      // Dynamic periods require raw SQL string approach
      const rawSql = `
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
            AND trade_date <= '${tradeDateStr}'::date
        ),
        latest AS (
          SELECT ts_code, name, close, pct_change
          FROM ranked
          WHERE rn = 1
        ),
        agg AS (
          SELECT
            ts_code,
            ${periodColumns}
          FROM ranked
          WHERE rn <= ${maxPeriod + 1}
          GROUP BY ts_code
        )
        SELECT
          latest.ts_code,
          latest.name,
          latest.close AS latest_close,
          latest.pct_change AS latest_pct_change,
          ${returnColumns}
        FROM latest
        JOIN agg ON agg.ts_code = latest.ts_code
        ORDER BY ${sortColumn} ${orderDir} NULLS LAST
      `

      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(rawSql)

      return {
        tradeDate: tradeDateStr,
        industries: rows.map((r) => ({
          tsCode: r.ts_code,
          name: r.name,
          returns: Object.fromEntries(
            periods.map((p) => [p, r[`return_${p}`] != null ? Number(r[`return_${p}`]) : null]),
          ),
          latestPctChange: r.latest_pct_change != null ? Number(r.latest_pct_change) : null,
          latestClose: r.latest_close != null ? Number(r.latest_close) : null,
        })),
      }
    })
  }

  // ─── 3.2 行业动量排名 ─────────────────────────────────────────────────────

  async getMomentumRanking(query: MomentumRankingQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) return { tradeDate: '', method: query.method ?? 'weighted', industries: [] }

    const method = query.method ?? 'weighted'
    const weights = query.weights ?? [0.3, 0.4, 0.3]
    const limit = query.limit
    const order = query.order ?? 'desc'
    const tradeDateStr = this.formatDateStr(tradeDate)

    const cacheKey = this.cacheService.buildKey('ind-rotation:momentum', {
      tradeDateStr,
      method,
      order,
      limit,
    })

    return this.rememberCache(cacheKey, STANDARD_CACHE_TTL, async () => {
      // Reuse return-comparison logic to get 5/20/60 returns
      const returnData = await this.getReturnComparison({
        trade_date: tradeDateStr,
        periods: [5, 20, 60],
        sort_period: 20,
        order: 'desc',
      })

      // Normalize weights
      const wSum = weights[0] + weights[1] + weights[2]
      const w = [weights[0] / wSum, weights[1] / wSum, weights[2] / wSum]

      let industries = returnData.industries.map((ind) => {
        const r5 = ind.returns[5]
        const r20 = ind.returns[20]
        const r60 = ind.returns[60]

        let momentumScore: number
        if (method === 'simple') {
          momentumScore = r20 ?? 0
        } else {
          // weighted: handle nulls by redistributing weight
          const available: { val: number; weight: number }[] = []
          if (r5 != null) available.push({ val: r5, weight: w[0] })
          if (r20 != null) available.push({ val: r20, weight: w[1] })
          if (r60 != null) available.push({ val: r60, weight: w[2] })

          if (available.length === 0) {
            momentumScore = 0
          } else {
            const totalW = available.reduce((s, a) => s + a.weight, 0)
            momentumScore = available.reduce((s, a) => s + (a.val * a.weight) / totalW, 0)
          }
        }

        return {
          tsCode: ind.tsCode,
          name: ind.name,
          momentumScore: Math.round(momentumScore * 10000) / 10000,
          return5d: r5,
          return20d: r20,
          return60d: r60,
          latestPctChange: ind.latestPctChange,
          rank: 0,
        }
      })

      // Sort
      industries.sort((a, b) =>
        order === 'desc' ? b.momentumScore - a.momentumScore : a.momentumScore - b.momentumScore,
      )

      // Assign ranks
      industries.forEach((ind, i) => {
        ind.rank = i + 1
      })

      // Limit
      if (limit) {
        industries = industries.slice(0, limit)
      }

      return {
        tradeDate: tradeDateStr,
        method,
        industries,
      }
    })
  }

  // ─── 3.3 行业资金流转分析 ──────────────────────────────────────────────────

  async getFlowAnalysis(query: FlowAnalysisQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate)
      return {
        tradeDate: '',
        days: query.days ?? 5,
        industries: [],
        summary: { inflowCount: 0, outflowCount: 0, topInflowNames: [], topOutflowNames: [] },
      }

    const days = query.days ?? 5
    const sortBy = query.sort_by ?? 'cumulative_net'
    const order = query.order ?? 'desc'
    const limit = query.limit
    const tradeDateStr = this.formatDateStr(tradeDate)
    const halfDays = Math.floor(days / 2)
    const daysX2 = days * 2

    const cacheKey = this.cacheService.buildKey('ind-rotation:flow', {
      tradeDateStr,
      days,
      sortBy,
      order,
    })

    return this.rememberCache(cacheKey, STANDARD_CACHE_TTL, async () => {
      const sortColumnMap: Record<string, string> = {
        cumulative_net: 'cumulative_net',
        avg_daily_net: 'avg_daily_net',
        flow_momentum: 'flow_momentum',
      }
      const sortCol = sortColumnMap[sortBy] ?? 'cumulative_net'
      const orderDir = order === 'asc' ? 'ASC' : 'DESC'

      const rawSql = `
        WITH date_range AS (
          SELECT DISTINCT trade_date
          FROM sector_capital_flows
          WHERE content_type = '行业' AND trade_date <= '${tradeDateStr}'::date
          ORDER BY trade_date DESC
          LIMIT ${daysX2}
        ),
        recent AS (
          SELECT scf.*,
            ROW_NUMBER() OVER (PARTITION BY scf.ts_code ORDER BY scf.trade_date DESC) AS day_rn
          FROM sector_capital_flows scf
          JOIN date_range dr ON dr.trade_date = scf.trade_date
          WHERE scf.content_type = '行业'
        ),
        latest_rank AS (
          SELECT ts_code, rank
          FROM recent
          WHERE day_rn = 1
        )
        SELECT
          r.ts_code,
          MAX(r.name) AS name,
          COALESCE(SUM(r.net_amount) FILTER (WHERE r.day_rn <= ${days}), 0) AS cumulative_net,
          COALESCE(AVG(r.net_amount) FILTER (WHERE r.day_rn <= ${days}), 0) AS avg_daily_net,
          COALESCE(SUM(r.buy_elg_amount) FILTER (WHERE r.day_rn <= ${days}), 0) AS cum_buy_elg,
          COALESCE(SUM(r.buy_lg_amount) FILTER (WHERE r.day_rn <= ${days}), 0) AS cum_buy_lg,
          COALESCE(SUM(r.net_amount) FILTER (WHERE r.day_rn <= ${halfDays}), 0) AS recent_half_net,
          COALESCE(SUM(r.net_amount) FILTER (WHERE r.day_rn > ${halfDays} AND r.day_rn <= ${days}), 0) AS earlier_half_net,
          SUM(r.net_amount) FILTER (WHERE r.day_rn > ${days} AND r.day_rn <= ${daysX2}) AS prev_period_net,
          lr.rank AS latest_rank
        FROM recent r
        LEFT JOIN latest_rank lr ON lr.ts_code = r.ts_code
        GROUP BY r.ts_code, lr.rank
        ORDER BY ${sortCol} ${orderDir} NULLS LAST
      `

      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(rawSql)

      // Calculate cumulative return from close prices
      const returnSql = `
        WITH ranked AS (
          SELECT ts_code, close,
            ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
          FROM sector_capital_flows
          WHERE content_type = '行业' AND trade_date <= '${tradeDateStr}'::date
        )
        SELECT
          r1.ts_code,
          ROUND((((r1.close / NULLIF(r2.close, 0)) - 1) * 100)::numeric, 4) AS cumulative_return
        FROM ranked r1
        LEFT JOIN ranked r2 ON r2.ts_code = r1.ts_code AND r2.rn = ${days + 1}
        WHERE r1.rn = 1
      `
      const returnRows = await this.prisma.$queryRawUnsafe<RawRow[]>(returnSql)
      const returnMap = new Map(returnRows.map((r) => [r.ts_code, r.cumulative_return]))

      let industries = rows.map((r) => {
        const cumulativeNet = Number(r.cumulative_net)
        const totalNet = Number(r.cum_buy_elg) + Number(r.cum_buy_lg)
        return {
          tsCode: r.ts_code,
          name: r.name,
          cumulativeNetAmount: Math.round(cumulativeNet * 100) / 100,
          avgDailyNetAmount: Math.round(Number(r.avg_daily_net) * 100) / 100,
          cumulativeReturn: returnMap.get(r.ts_code) != null ? Number(returnMap.get(r.ts_code)) : null,
          flowMomentum: Math.round((Number(r.recent_half_net) - Number(r.earlier_half_net)) * 100) / 100,
          flowAcceleration:
            r.prev_period_net != null ? Math.round((cumulativeNet - Number(r.prev_period_net)) * 100) / 100 : null,
          cumulativeBuyElg: Math.round(Number(r.cum_buy_elg) * 100) / 100,
          cumulativeBuyLg: Math.round(Number(r.cum_buy_lg) * 100) / 100,
          mainForceRatio: cumulativeNet !== 0 ? Math.round((totalNet / Math.abs(cumulativeNet)) * 10000) / 10000 : null,
          latestDayRank: r.latest_rank != null ? Number(r.latest_rank) : null,
        }
      })

      if (limit) {
        industries = industries.slice(0, limit)
      }

      // Summary
      const allIndustries = rows.map((r) => ({
        name: r.name as string,
        net: Number(r.cumulative_net),
      }))
      const sorted = [...allIndustries].sort((a, b) => b.net - a.net)

      return {
        tradeDate: tradeDateStr,
        days,
        industries,
        summary: {
          inflowCount: allIndustries.filter((i) => i.net > 0).length,
          outflowCount: allIndustries.filter((i) => i.net < 0).length,
          topInflowNames: sorted
            .filter((i) => i.net > 0)
            .slice(0, 5)
            .map((i) => i.name),
          topOutflowNames: sorted
            .filter((i) => i.net < 0)
            .slice(-5)
            .reverse()
            .map((i) => i.name),
        },
      }
    })
  }

  // ─── 3.4 行业估值分位 ─────────────────────────────────────────────────────

  async getIndustryValuation(query: IndustryValuationQueryDto) {
    const tradeDate = query.trade_date
      ? this.parseDate(query.trade_date)
      : await this.resolveLatestDailyBasicTradeDate()
    if (!tradeDate) return { tradeDate: '', industries: [] }

    const sortBy = query.sort_by ?? 'pe_percentile_1y'
    const order = query.order ?? 'asc'
    const industryFilter = query.industry
    const tradeDateStr = this.formatDateStr(tradeDate)

    const cacheKey = this.cacheService.buildKey('ind-rotation:val', {
      tradeDateStr,
      industry: industryFilter,
      sortBy,
      order,
    })

    return this.rememberCache(cacheKey, EXTENDED_CACHE_TTL, async () => {
      const oneYearAgo = dayjs(tradeDate).tz('Asia/Shanghai').subtract(1, 'year').format('YYYYMMDD')
      const threeYearAgo = dayjs(tradeDate).tz('Asia/Shanghai').subtract(3, 'year').format('YYYYMMDD')

      // Use pre-computed valuation_daily_medians table (populated by syncDailyBasic).
      // Scanning ~22k pre-aggregated rows is orders of magnitude faster than the
      // previous approach of scanning ~4M raw stock rows with PERCENTILE_CONT.
      const industryCondition = industryFilter ? 'AND scope = $4' : ''
      const params: (string | number)[] = [tradeDateStr, oneYearAgo, threeYearAgo]
      if (industryFilter) params.push(industryFilter)

      type PrecomputedRow = {
        industry: string
        stock_count: number
        pe_ttm_median: number | null
        pb_median: number | null
        pe_pctl_1y: number | null
        pb_pctl_1y: number | null
        pe_pctl_3y: number | null
        pb_pctl_3y: number | null
      }

      const rows = await this.prisma.$queryRawUnsafe<PrecomputedRow[]>(
        `
        WITH medians AS (
          SELECT scope AS industry, trade_date, pe_ttm_median, pb_median, stock_count
          FROM valuation_daily_medians
          WHERE scope != '__ALL__'
            AND trade_date >= $3::date AND trade_date <= $1::date
            ${industryCondition}
        ),
        pctl_1y AS (
          SELECT
            industry, trade_date,
            PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pe_ttm_median) AS pe_pctl,
            PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pb_median) AS pb_pctl
          FROM medians
          WHERE trade_date >= $2::date
        ),
        pctl_3y AS (
          SELECT
            industry, trade_date,
            PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pe_ttm_median) AS pe_pctl,
            PERCENT_RANK() OVER (PARTITION BY industry ORDER BY pb_median) AS pb_pctl
          FROM medians
        )
        SELECT
          t.industry,
          t.stock_count,
          t.pe_ttm_median,
          t.pb_median,
          ROUND((p1.pe_pctl * 100)::numeric, 2) AS pe_pctl_1y,
          ROUND((p1.pb_pctl * 100)::numeric, 2) AS pb_pctl_1y,
          ROUND((p3.pe_pctl * 100)::numeric, 2) AS pe_pctl_3y,
          ROUND((p3.pb_pctl * 100)::numeric, 2) AS pb_pctl_3y
        FROM medians t
        LEFT JOIN pctl_1y p1 ON p1.industry = t.industry AND p1.trade_date = $1::date
        LEFT JOIN pctl_3y p3 ON p3.industry = t.industry AND p3.trade_date = $1::date
        WHERE t.trade_date = $1::date
        `,
        ...params,
      )

      if (rows.length === 0) {
        return { tradeDate: tradeDateStr, industries: [] }
      }

      const sortColumnMap: Record<
        string,
        (r: {
          peTtmMedian: number | null
          pbMedian: number | null
          peTtmPercentile1y: number | null
          pbPercentile1y: number | null
        }) => number | null
      > = {
        pe_ttm: (r) => r.peTtmMedian,
        pb: (r) => r.pbMedian,
        pe_percentile_1y: (r) => r.peTtmPercentile1y,
        pb_percentile_1y: (r) => r.pbPercentile1y,
      }
      const getSortVal = sortColumnMap[sortBy] ?? sortColumnMap.pe_percentile_1y

      const industries = rows.map((r) => {
        const pePctl1y = r.pe_pctl_1y != null ? Number(r.pe_pctl_1y) : null
        return {
          industry: r.industry,
          stockCount: Number(r.stock_count),
          peTtmMedian: r.pe_ttm_median != null ? Math.round(Number(r.pe_ttm_median) * 100) / 100 : null,
          pbMedian: r.pb_median != null ? Math.round(Number(r.pb_median) * 100) / 100 : null,
          peTtmPercentile1y: pePctl1y,
          peTtmPercentile3y: r.pe_pctl_3y != null ? Number(r.pe_pctl_3y) : null,
          pbPercentile1y: r.pb_pctl_1y != null ? Number(r.pb_pctl_1y) : null,
          pbPercentile3y: r.pb_pctl_3y != null ? Number(r.pb_pctl_3y) : null,
          valuationLabel: this.getValuationLabel(pePctl1y),
        }
      })

      industries.sort((a, b) => {
        const va = getSortVal(a)
        const vb = getSortVal(b)
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        return order === 'asc' ? va - vb : vb - va
      })

      return { tradeDate: tradeDateStr, industries }
    })
  }

  // ─── 3.5 行业轮动总览 ─────────────────────────────────────────────────────

  async getOverview(query: RotationOverviewQueryDto) {
    const tradeDateStr = query.trade_date

    const [returns, momentum, flow, valuation] = await Promise.all([
      this.getReturnComparison({ trade_date: tradeDateStr, periods: [20], sort_period: 20, order: 'desc' }),
      this.getMomentumRanking({ trade_date: tradeDateStr, method: 'weighted', order: 'desc' }),
      this.getFlowAnalysis({ trade_date: tradeDateStr, days: 5, sort_by: 'cumulative_net', order: 'desc' }),
      this.getIndustryValuation({ trade_date: tradeDateStr, sort_by: 'pe_percentile_1y', order: 'asc' }),
    ])

    const tradeDate = returns.tradeDate || momentum.tradeDate || flow.tradeDate || valuation.tradeDate

    // Return snapshot: top 5 gainers / losers by 20d return
    const returnInds = returns.industries
    const topGainers = returnInds.slice(0, 5).map((i) => ({ name: i.name, value: i.returns[20] ?? 0 }))
    const topLosers = returnInds
      .slice(-5)
      .reverse()
      .map((i) => ({ name: i.name, value: i.returns[20] ?? 0 }))

    // Momentum snapshot
    const momInds = momentum.industries
    const leaders = momInds.slice(0, 5).map((i) => ({ name: i.name, value: i.momentumScore }))
    const laggards = momInds
      .slice(-5)
      .reverse()
      .map((i) => ({ name: i.name, value: i.momentumScore }))

    // Flow snapshot
    const flowInds = flow.industries
    const topInflow = flowInds.slice(0, 5).map((i) => ({ name: i.name, value: i.cumulativeNetAmount }))
    const topOutflow = flowInds
      .slice(-5)
      .reverse()
      .map((i) => ({ name: i.name, value: i.cumulativeNetAmount }))

    // Valuation snapshot: most undervalued (lowest percentile) / overvalued (highest)
    const valInds = valuation.industries
    const undervalued = valInds
      .filter((i) => i.peTtmPercentile1y != null)
      .slice(0, 5)
      .map((i) => ({
        name: i.industry,
        value: i.peTtmPercentile1y!,
      }))
    const overvalued = valInds
      .filter((i) => i.peTtmPercentile1y != null)
      .slice(-5)
      .reverse()
      .map((i) => ({ name: i.industry, value: i.peTtmPercentile1y! }))

    return {
      tradeDate,
      returnSnapshot: { topGainers, topLosers },
      momentumSnapshot: { leaders, laggards },
      flowSnapshot: { topInflow, topOutflow },
      valuationSnapshot: { undervalued, overvalued },
    }
  }

  // ─── 3.6 单行业详情 ───────────────────────────────────────────────────────

  async getDetail(query: IndustryDetailQueryDto) {
    const { tsCode: inputTsCode, industry } = query
    const days = query.days ?? 20

    // tsCode 和 industry 至少传一个
    if (!inputTsCode && !industry) {
      return { industry: '', tsCode: null, returnTrend: [], flowTrend: [], valuation: null, topStocks: [] }
    }

    const cacheKey = this.cacheService.buildKey('ind-rotation:detail', {
      tsCode: inputTsCode,
      industry,
      days,
    })

    return this.rememberCache(cacheKey, STANDARD_CACHE_TTL, async () => {
      // Step 1: Resolve sector code — tsCode 优先，其次按 industry 名称查
      let tsCode: string | null = null
      let resolvedIndustry = industry ?? ''

      if (inputTsCode) {
        // 直接使用 tsCode，同时尝试解析 name 用于展示
        tsCode = inputTsCode
        const nameRows = await this.prisma.$queryRawUnsafe<RawRow[]>(
          `SELECT name FROM sector_capital_flows WHERE content_type = '行业' AND ts_code = $1 LIMIT 1`,
          inputTsCode,
        )
        if (nameRows.length > 0 && nameRows[0].name) {
          resolvedIndustry = nameRows[0].name as string
        }
      } else if (industry) {
        // 按名称解析 tsCode（兼容旧逻辑）
        const sectorRows = await this.prisma.$queryRawUnsafe<RawRow[]>(
          `SELECT DISTINCT ts_code, name FROM sector_capital_flows WHERE content_type = '行业' AND name = $1 LIMIT 1`,
          industry,
        )
        tsCode = sectorRows.length > 0 ? (sectorRows[0].ts_code as string) : null
      }

      // Step 2: Return trend
      let returnTrend: { tradeDate: string; close: number; pctChange: number; cumulativeReturn: number }[] = []
      if (tsCode) {
        const trendRows = await this.prisma.$queryRawUnsafe<RawRow[]>(
          `
          SELECT trade_date, close, pct_change
          FROM sector_capital_flows
          WHERE content_type = '行业' AND ts_code = $1
          ORDER BY trade_date DESC
          LIMIT ${days}
        `,
          tsCode,
        )
        trendRows.reverse()
        const firstClose = trendRows[0]?.close
        returnTrend = trendRows.map((r) => ({
          tradeDate: this.formatDateStr(r.trade_date as Date),
          close: Number(r.close),
          pctChange: r.pct_change != null ? Number(r.pct_change) : 0,
          cumulativeReturn: firstClose ? Math.round((Number(r.close) / Number(firstClose) - 1) * 10000) / 100 : 0,
        }))
      }

      // Step 3: Flow trend
      let flowTrend: {
        tradeDate: string
        netAmount: number
        cumulativeNet: number
        buyElgAmount: number
        buyLgAmount: number
      }[] = []
      if (tsCode) {
        const flowRows = await this.prisma.$queryRawUnsafe<RawRow[]>(
          `
          SELECT trade_date, net_amount, buy_elg_amount, buy_lg_amount
          FROM sector_capital_flows
          WHERE content_type = '行业' AND ts_code = $1
          ORDER BY trade_date DESC
          LIMIT ${days}
        `,
          tsCode,
        )
        flowRows.reverse()
        let cumulativeNet = 0
        flowTrend = flowRows.map((r) => {
          cumulativeNet += Number(r.net_amount) || 0
          return {
            tradeDate: this.formatDateStr(r.trade_date as Date),
            netAmount: Math.round((Number(r.net_amount) || 0) * 100) / 100,
            cumulativeNet: Math.round(cumulativeNet * 100) / 100,
            buyElgAmount: Math.round((Number(r.buy_elg_amount) || 0) * 100) / 100,
            buyLgAmount: Math.round((Number(r.buy_lg_amount) || 0) * 100) / 100,
          }
        })
      }

      // Step 4: Valuation snapshot
      let valuation = null
      try {
        const valResult = await this.getIndustryValuation({ industry: resolvedIndustry, sort_by: 'pe_percentile_1y', order: 'asc' })
        if (valResult.industries.length > 0) {
          const v = valResult.industries[0]
          valuation = {
            peTtmMedian: v.peTtmMedian,
            pbMedian: v.pbMedian,
            peTtmPercentile1y: v.peTtmPercentile1y,
            pbPercentile1y: v.pbPercentile1y,
            valuationLabel: v.valuationLabel,
          }
        }
      } catch {
        // valuation is optional, don't fail the whole request
      }

      // Step 5: Top stocks
      const latestTradeDate = await this.resolveLatestDailyBasicTradeDate()
      let topStocks: {
        tsCode: string
        name: string | null
        pctChg: number | null
        peTtm: number | null
        pb: number | null
        totalMv: number | null
      }[] = []
      if (latestTradeDate) {
        const latestDateStr = this.formatDateStr(latestTradeDate)
        const stockRows = await this.prisma.$queryRawUnsafe<RawRow[]>(
          `
          SELECT
            sb.ts_code, sb.name,
            d.pct_chg,
            db.pe_ttm, db.pb, db.total_mv
          FROM stock_basic_profiles sb
          LEFT JOIN stock_daily_prices d ON d.ts_code = sb.ts_code AND d.trade_date = $1::date
          LEFT JOIN stock_daily_valuation_metrics db ON db.ts_code = sb.ts_code AND db.trade_date = $1::date
          WHERE sb.industry = $2 AND sb.list_status = 'L'
          ORDER BY db.total_mv DESC NULLS LAST
          LIMIT 20
        `,
          latestDateStr,
          resolvedIndustry,
        )

        topStocks = stockRows.map((r) => ({
          tsCode: r.ts_code as string,
          name: r.name as string | null,
          pctChg: r.pct_chg != null ? Number(r.pct_chg) : null,
          peTtm: r.pe_ttm != null ? Number(r.pe_ttm) : null,
          pb: r.pb != null ? Number(r.pb) : null,
          totalMv: r.total_mv != null ? Number(r.total_mv) : null,
        }))
      }

      return {
        industry: resolvedIndustry,
        tsCode,
        returnTrend,
        flowTrend,
        valuation,
        topStocks,
      }
    })
  }

  // ─── 3.7 行业轮动热力图 ───────────────────────────────────────────────────

  async getHeatmap(query: RotationHeatmapQueryDto) {
    const periods = query.periods ?? [1, 5, 10, 20, 60]
    const returnData = await this.getReturnComparison({
      trade_date: query.trade_date,
      periods,
      sort_period: periods[0],
      order: 'desc',
    })

    return {
      tradeDate: returnData.tradeDate,
      periods,
      industries: returnData.industries.map((i) => ({
        tsCode: i.tsCode,
        name: i.name,
        returns: i.returns,
      })),
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private parseDate(value: string) {
    return dayjs.tz(value, 'YYYYMMDD', 'Asia/Shanghai').toDate()
  }

  private formatDateStr(date: Date): string {
    return dayjs(date).tz('Asia/Shanghai').format('YYYYMMDD')
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

  private getValuationLabel(percentile: number | null): string {
    if (percentile == null) return '适中'
    if (percentile <= 25) return '低估'
    if (percentile <= 50) return '适中'
    if (percentile <= 75) return '偏高'
    return '高估'
  }

  private rememberCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.INDUSTRY_ROTATION,
      key,
      ttlSeconds,
      loader,
    })
  }
}
