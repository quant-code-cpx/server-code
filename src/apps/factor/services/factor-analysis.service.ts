import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorComputeService } from './factor-compute.service'
import {
  FactorCorrelationDto,
  FactorCorrelationResponseDto,
  FactorDecayAnalysisDto,
  FactorDistributionDto,
  FactorIcAnalysisDto,
  FactorQuantileAnalysisDto,
} from '../dto/factor-analysis.dto'

// ── Stat helpers ────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0
  const m = mu ?? mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

function rankArray(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array<number>(arr.length)
  indexed.forEach(({ i }, rank) => {
    ranks[i] = rank + 1
  })
  return ranks
}

function pearsonCorr(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = mean(xs),
    my = mean(ys)
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0))
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0))
  if (dx === 0 || dy === 0) return null
  return num / (dx * dy)
}

function spearmanCorr(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  return pearsonCorr(rankArray(xs), rankArray(ys))
}

function maxDrawdown(cumReturns: number[]): number {
  let peak = cumReturns[0] ?? 1
  let maxDD = 0
  for (const v of cumReturns) {
    if (v > peak) peak = v
    const dd = (peak - v) / peak
    if (dd > maxDD) maxDD = dd
  }
  return -maxDD
}

function annualisedReturn(totalReturn: number, tradingDays: number): number {
  if (tradingDays <= 0) return 0
  return (1 + totalReturn) ** (252 / tradingDays) - 1
}

function sharpe(returns: number[]): number {
  if (returns.length < 2) return 0
  const m = mean(returns)
  const s = stdDev(returns, m)
  if (s === 0) return 0
  return (m / s) * Math.sqrt(252)
}

function formatTradeDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

// ────────────────────────────────────────────────────────────────────────────

interface AdjReturnRow {
  ts_code: string
  forward_return: number | null
}

interface TradeCalRow {
  cal_date: Date
}

interface ForwardTradeCalRow extends TradeCalRow {
  forward_date: Date | null
}

interface ForwardPeriodTradeCalRow extends TradeCalRow {
  period: number
  forward_date: Date | null
}

interface AdjReturnByPeriodRow extends AdjReturnRow {
  period: number
}

const FACTOR_ANALYSIS_CACHE_TTL_SECONDS = 24 * 3600
const FACTOR_IC_ANALYSIS_CONCURRENCY = Math.max(1, Number(process.env.FACTOR_IC_ANALYSIS_CONCURRENCY) || 8)
const FACTOR_DECAY_ANALYSIS_CONCURRENCY = Math.max(1, Number(process.env.FACTOR_DECAY_ANALYSIS_CONCURRENCY) || 4)

@Injectable()
export class FactorAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
    private readonly cacheService: CacheService,
  ) {}

  // ── Trading-day helpers ──────────────────────────────────────────────────

  private async getTradeDates(startDate: string, endDate: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date >= ${startDate}::date
        AND cal_date <= ${endDate}::date
      ORDER BY cal_date ASC
    `)
    return rows.map((r) => formatTradeDate(r.cal_date))
  }

  private async getForwardTradeDatePairs(
    startDate: string,
    endDate: string,
    forwardDays: number,
  ): Promise<Array<{ tradeDate: string; forwardDate: string | null }>> {
    const rows = await this.prisma.$queryRaw<ForwardTradeCalRow[]>(Prisma.sql`
      WITH open_days AS (
        SELECT
          cal_date,
          LEAD(cal_date, ${forwardDays}::int) OVER (ORDER BY cal_date ASC) AS forward_date
        FROM exchange_trade_calendars
        WHERE exchange = 'SSE' AND is_open = '1'
      )
      SELECT cal_date, forward_date
      FROM open_days
      WHERE cal_date >= ${startDate}::date
        AND cal_date <= ${endDate}::date
      ORDER BY cal_date ASC
    `)

    return rows.map((r) => ({
      tradeDate: formatTradeDate(r.cal_date),
      forwardDate: r.forward_date ? formatTradeDate(r.forward_date) : null,
    }))
  }

  private async getForwardTradeDateMatrix(
    startDate: string,
    endDate: string,
    periods: number[],
  ): Promise<Map<string, Map<number, string | null>>> {
    if (!periods.length) return new Map()

    const periodValues = Prisma.join(periods.map((period) => Prisma.sql`(${period}::int)`))
    const rows = await this.prisma.$queryRaw<ForwardPeriodTradeCalRow[]>(Prisma.sql`
      WITH periods(period) AS (
        VALUES ${periodValues}
      ),
      open_days AS (
        SELECT
          cal_date,
          ROW_NUMBER() OVER (ORDER BY cal_date ASC) AS rn
        FROM exchange_trade_calendars
        WHERE exchange = 'SSE' AND is_open = '1'
      )
      SELECT
        d0.cal_date,
        p.period,
        d1.cal_date AS forward_date
      FROM open_days d0
      CROSS JOIN periods p
      LEFT JOIN open_days d1 ON d1.rn = d0.rn + p.period
      WHERE d0.cal_date >= ${startDate}::date
        AND d0.cal_date <= ${endDate}::date
      ORDER BY d0.cal_date ASC, p.period ASC
    `)

    const matrix = new Map<string, Map<number, string | null>>()
    for (const row of rows) {
      const tradeDate = formatTradeDate(row.cal_date)
      const periodMap = matrix.get(tradeDate) ?? new Map<number, string | null>()
      periodMap.set(Number(row.period), row.forward_date ? formatTradeDate(row.forward_date) : null)
      matrix.set(tradeDate, periodMap)
    }
    return matrix
  }

  private async getAdjReturns(fromDate: string, toDate: string, tsCodes: string[]): Promise<Record<string, number>> {
    if (!tsCodes.length) return {}
    const requestedCodes = new Set(tsCodes)
    const rows = await this.prisma.$queryRaw<AdjReturnRow[]>(Prisma.sql`
      SELECT
        d0.ts_code,
        ((d1.close::numeric * af1.adj_factor::numeric) /
          NULLIF(d0.close::numeric * af0.adj_factor::numeric, 0) - 1)::float AS forward_return
      FROM stock_daily_prices d0
      JOIN stock_adjustment_factors af0
        ON af0.ts_code = d0.ts_code AND af0.trade_date = d0.trade_date
      JOIN stock_daily_prices d1
        ON d1.ts_code = d0.ts_code AND d1.trade_date = ${toDate}::date
      JOIN stock_adjustment_factors af1
        ON af1.ts_code = d1.ts_code AND af1.trade_date = d1.trade_date
      WHERE d0.trade_date = ${fromDate}::date
    `)
    const map: Record<string, number> = {}
    for (const r of rows) {
      if (r.forward_return != null && requestedCodes.has(r.ts_code)) map[r.ts_code] = Number(r.forward_return)
    }
    return map
  }

  private async getAdjReturnsByPeriod(
    fromDate: string,
    forwardDatesByPeriod: Map<number, string>,
    tsCodes: string[],
  ): Promise<Map<number, Record<string, number>>> {
    if (!tsCodes.length || forwardDatesByPeriod.size === 0) return new Map()

    const requestedCodes = new Set(tsCodes)
    const requestedValues = Prisma.join(
      [...forwardDatesByPeriod.entries()].map(
        ([period, forwardDate]) => Prisma.sql`(${period}::int, ${forwardDate}::date)`,
      ),
    )

    const rows = await this.prisma.$queryRaw<AdjReturnByPeriodRow[]>(Prisma.sql`
      WITH requested(period, forward_date) AS (
        VALUES ${requestedValues}
      ),
      base AS MATERIALIZED (
        SELECT d0.ts_code, d0.close, af0.adj_factor
        FROM stock_daily_prices d0
        JOIN stock_adjustment_factors af0
          ON af0.ts_code = d0.ts_code AND af0.trade_date = d0.trade_date
        WHERE d0.trade_date = ${fromDate}::date
      ),
      future_prices AS MATERIALIZED (
        SELECT requested.period, d1.ts_code, d1.close
        FROM requested
        JOIN stock_daily_prices d1
          ON d1.trade_date = requested.forward_date
      ),
      future_factors AS MATERIALIZED (
        SELECT requested.period, af1.ts_code, af1.adj_factor
        FROM requested
        JOIN stock_adjustment_factors af1
          ON af1.trade_date = requested.forward_date
      ),
      future AS MATERIALIZED (
        SELECT fp.period, fp.ts_code, fp.close, ff.adj_factor
        FROM future_prices fp
        JOIN future_factors ff
          ON ff.period = fp.period AND ff.ts_code = fp.ts_code
      )
      SELECT
        future.period,
        base.ts_code,
        ((future.close::numeric * future.adj_factor::numeric) /
          NULLIF(base.close::numeric * base.adj_factor::numeric, 0) - 1)::float AS forward_return
      FROM base
      JOIN future ON future.ts_code = base.ts_code
    `)

    const returnsByPeriod = new Map<number, Record<string, number>>()
    for (const row of rows) {
      if (row.forward_return == null || !requestedCodes.has(row.ts_code)) continue
      const period = Number(row.period)
      const returnMap = returnsByPeriod.get(period) ?? {}
      returnMap[row.ts_code] = Number(row.forward_return)
      returnsByPeriod.set(period, returnMap)
    }
    return returnsByPeriod
  }

  // ── IC Analysis ──────────────────────────────────────────────────────────

  async getIcAnalysis(dto: FactorIcAnalysisDto) {
    const cacheKey = `factor:ic:${dto.factorName}:${dto.startDate}:${dto.endDate}:${dto.universe ?? 'all'}:${dto.forwardDays ?? 5}:${dto.icMethod ?? 'rank'}`

    return this.rememberFactorAnalysisCache(cacheKey, async () => {
      const forwardDays = dto.forwardDays ?? 5
      const icMethod = dto.icMethod ?? 'rank'

      const tradeDatePairs = await this.getForwardTradeDatePairs(dto.startDate, dto.endDate, forwardDays)
      const seriesWithEmpty = await mapWithConcurrency(
        tradeDatePairs,
        FACTOR_IC_ANALYSIS_CONCURRENCY,
        async ({ tradeDate, forwardDate }) => {
          if (!forwardDate) return null
          const factorValues = await this.compute.getRawFactorValuesForDate(dto.factorName, tradeDate, dto.universe)
          const valid = factorValues.filter((v) => v.factorValue != null)
          if (!valid.length) return null

          const returnMap = await this.getAdjReturns(
            tradeDate,
            forwardDate,
            valid.map((v) => v.tsCode),
          )

          const pairs: Array<{ f: number; r: number }> = []
          for (const { tsCode, factorValue } of valid) {
            const ret = returnMap[tsCode]
            if (ret != null && factorValue != null) pairs.push({ f: factorValue, r: ret })
          }
          if (pairs.length < 5) return null

          const fs = pairs.map((p) => p.f)
          const rs = pairs.map((p) => p.r)
          const ic = icMethod === 'rank' ? spearmanCorr(fs, rs) : pearsonCorr(fs, rs)
          if (ic == null) return null
          return { tradeDate, ic: Math.round(ic * 1e6) / 1e6, stockCount: pairs.length }
        },
      )

      const series = seriesWithEmpty.filter(
        (item): item is { tradeDate: string; ic: number; stockCount: number } => item !== null,
      )

      const ics = series.map((s) => s.ic)
      const icMean = ics.length ? mean(ics) : 0
      const icStd = ics.length ? stdDev(ics, icMean) : 0
      const icIr = icStd !== 0 ? icMean / icStd : 0
      const icPositiveRate = ics.length ? ics.filter((v) => v > 0).length / ics.length : 0
      const icAboveThreshold = ics.length ? ics.filter((v) => Math.abs(v) > 0.03).length / ics.length : 0
      const tStat = icStd !== 0 ? (icMean / icStd) * Math.sqrt(ics.length) : 0

      return {
        factorName: dto.factorName,
        forwardDays,
        icMethod,
        startDate: dto.startDate,
        endDate: dto.endDate,
        summary: {
          icMean: Math.round(icMean * 1e6) / 1e6,
          icStd: Math.round(icStd * 1e6) / 1e6,
          icIr: Math.round(icIr * 1e4) / 1e4,
          icPositiveRate: Math.round(icPositiveRate * 1e4) / 1e4,
          icAboveThreshold: Math.round(icAboveThreshold * 1e4) / 1e4,
          tStat: Math.round(tStat * 1e4) / 1e4,
        },
        series,
      }
    })
  }

  // ── Quantile Backtest ────────────────────────────────────────────────────

  async getQuantileAnalysis(dto: FactorQuantileAnalysisDto) {
    const quantiles = dto.quantiles ?? 5
    const rebalanceDays = dto.rebalanceDays ?? 5

    const cacheKey = `factor:quantile:${dto.factorName}:${dto.startDate}:${dto.endDate}:${dto.universe ?? 'all'}:${quantiles}:${rebalanceDays}`

    return this.rememberFactorAnalysisCache(cacheKey, async () => {
      const tradeDates = await this.getTradeDates(dto.startDate, dto.endDate)
      if (tradeDates.length < 2) throw new NotFoundException('分析期内交易日数量不足')

      const rebalanceDates: string[] = []
      for (let i = 0; i < tradeDates.length - 1; i += rebalanceDays) {
        rebalanceDates.push(tradeDates[i])
      }
      if (rebalanceDates[rebalanceDates.length - 1] !== tradeDates[tradeDates.length - 1]) {
        rebalanceDates.push(tradeDates[tradeDates.length - 1])
      }

      const groupCumSeries: Array<Array<{ tradeDate: string; cumReturn: number }>> = Array.from(
        { length: quantiles },
        () => [{ tradeDate: rebalanceDates[0], cumReturn: 0 }],
      )
      const lsSeries: Array<{ tradeDate: string; cumReturn: number }> = [{ tradeDate: rebalanceDates[0], cumReturn: 0 }]
      const bmSeries: Array<{ tradeDate: string; cumReturn: number }> = [{ tradeDate: rebalanceDates[0], cumReturn: 0 }]

      const groupPeriodReturns: number[][] = Array.from({ length: quantiles }, () => [])
      const lsPeriodReturns: number[] = []
      const bmPeriodReturns: number[] = []

      for (let i = 0; i < rebalanceDates.length - 1; i++) {
        const fromDate = rebalanceDates[i]
        const toDate = rebalanceDates[i + 1]

        const factorValues = await this.compute.getRawFactorValuesForDate(dto.factorName, fromDate, dto.universe)
        const valid = factorValues.filter((v) => v.factorValue != null)
        if (valid.length < quantiles) continue

        valid.sort((a, b) => (a.factorValue as number) - (b.factorValue as number))
        const size = Math.floor(valid.length / quantiles)

        const groups: string[][] = Array.from({ length: quantiles }, (_, q) => {
          const start = q * size
          const end = q === quantiles - 1 ? valid.length : start + size
          return valid.slice(start, end).map((v) => v.tsCode)
        })

        const allCodes = valid.map((v) => v.tsCode)
        const returnMap = await this.getAdjReturns(fromDate, toDate, allCodes)

        const groupRets = groups.map((codes) => {
          const rets = codes.map((c) => returnMap[c] ?? 0)
          return rets.length ? mean(rets) : 0
        })

        const bmRet = allCodes.length ? mean(allCodes.map((c) => returnMap[c] ?? 0)) : 0
        const lsRet = groupRets[quantiles - 1] - groupRets[0]

        for (let q = 0; q < quantiles; q++) {
          const prev = groupCumSeries[q][groupCumSeries[q].length - 1].cumReturn
          const newCum = (1 + prev) * (1 + groupRets[q]) - 1
          groupCumSeries[q].push({ tradeDate: toDate, cumReturn: Math.round(newCum * 1e6) / 1e6 })
          groupPeriodReturns[q].push(groupRets[q])
        }
        const prevLs = lsSeries[lsSeries.length - 1].cumReturn
        const newLsCum = (1 + prevLs) * (1 + lsRet) - 1
        lsSeries.push({ tradeDate: toDate, cumReturn: Math.round(newLsCum * 1e6) / 1e6 })
        lsPeriodReturns.push(lsRet)

        const prevBm = bmSeries[bmSeries.length - 1].cumReturn
        const newBmCum = (1 + prevBm) * (1 + bmRet) - 1
        bmSeries.push({ tradeDate: toDate, cumReturn: Math.round(newBmCum * 1e6) / 1e6 })
        bmPeriodReturns.push(bmRet)
      }

      const totalDays = tradeDates.length

      const groups = groupCumSeries.map((series, q) => {
        const totalReturn = series[series.length - 1]?.cumReturn ?? 0
        const cumValues = series.map((s) => 1 + s.cumReturn)
        return {
          group: `Q${q + 1}`,
          label: q === 0 ? '因子值最小组' : q === quantiles - 1 ? '因子值最大组' : `Q${q + 1}`,
          totalReturn: Math.round(totalReturn * 1e6) / 1e6,
          annualizedReturn: Math.round(annualisedReturn(totalReturn, totalDays) * 1e6) / 1e6,
          maxDrawdown: Math.round(maxDrawdown(cumValues) * 1e6) / 1e6,
          sharpeRatio: Math.round(sharpe(groupPeriodReturns[q]) * 1e4) / 1e4,
          series,
        }
      })

      const lsTotalReturn = lsSeries[lsSeries.length - 1]?.cumReturn ?? 0
      const lsCumValues = lsSeries.map((s) => 1 + s.cumReturn)

      return {
        factorName: dto.factorName,
        quantiles,
        rebalanceDays,
        startDate: dto.startDate,
        endDate: dto.endDate,
        groups,
        longShort: {
          totalReturn: Math.round(lsTotalReturn * 1e6) / 1e6,
          annualizedReturn: Math.round(annualisedReturn(lsTotalReturn, totalDays) * 1e6) / 1e6,
          maxDrawdown: Math.round(maxDrawdown(lsCumValues) * 1e6) / 1e6,
          sharpeRatio: Math.round(sharpe(lsPeriodReturns) * 1e4) / 1e4,
          series: lsSeries,
        },
        benchmark: {
          totalReturn: Math.round((bmSeries[bmSeries.length - 1]?.cumReturn ?? 0) * 1e6) / 1e6,
          series: bmSeries,
        },
      }
    })
  }

  // ── Decay Analysis ───────────────────────────────────────────────────────

  async getDecayAnalysis(dto: FactorDecayAnalysisDto) {
    const periods = dto.periods ?? [1, 3, 5, 10, 20]
    const cacheKey = `factor:decay:${dto.factorName}:${dto.startDate}:${dto.endDate}:${dto.universe ?? 'all'}:${periods.join(',')}`

    return this.rememberFactorAnalysisCache(cacheKey, async () => {
      const uniquePeriods = [...new Set(periods)]
      const tradeDateMatrix = await this.getForwardTradeDateMatrix(dto.startDate, dto.endDate, uniquePeriods)
      const tradeDates = [...tradeDateMatrix.keys()]
      const factorValuesByDate = await this.compute.getRawFactorValuesForDates(dto.factorName, tradeDates, dto.universe)
      const icRowsByDate = await mapWithConcurrency(
        tradeDates,
        FACTOR_DECAY_ANALYSIS_CONCURRENCY,
        async (tradeDate) => {
          const forwardDatesByPeriod = new Map<number, string>()
          const periodMap = tradeDateMatrix.get(tradeDate)
          for (const period of uniquePeriods) {
            const forwardDate = periodMap?.get(period)
            if (forwardDate) forwardDatesByPeriod.set(period, forwardDate)
          }
          if (forwardDatesByPeriod.size === 0) return []

          const factorValues = factorValuesByDate.get(tradeDate) ?? []
          const valid = factorValues.filter((v): v is { tsCode: string; factorValue: number } => v.factorValue != null)
          if (!valid.length) return []

          const returnsByPeriod = await this.getAdjReturnsByPeriod(
            tradeDate,
            forwardDatesByPeriod,
            valid.map((v) => v.tsCode),
          )

          const icRows: Array<{ period: number; ic: number }> = []
          for (const period of uniquePeriods) {
            const returnMap = returnsByPeriod.get(period)
            if (!returnMap) continue

            const pairs: Array<{ f: number; r: number }> = []
            for (const { tsCode, factorValue } of valid) {
              const ret = returnMap[tsCode]
              if (ret != null) pairs.push({ f: factorValue, r: ret })
            }
            if (pairs.length < 5) continue

            const fs = pairs.map((p) => p.f)
            const rs = pairs.map((p) => p.r)
            const ic = spearmanCorr(fs, rs)
            if (ic != null) icRows.push({ period, ic: Math.round(ic * 1e6) / 1e6 })
          }
          return icRows
        },
      )

      const icsByPeriod = new Map<number, number[]>()
      for (const rows of icRowsByDate) {
        for (const row of rows) {
          const ics = icsByPeriod.get(row.period) ?? []
          ics.push(row.ic)
          icsByPeriod.set(row.period, ics)
        }
      }

      const summaryByPeriod = new Map(
        uniquePeriods.map((period) => {
          const ics = icsByPeriod.get(period) ?? []
          const icMean = ics.length ? mean(ics) : 0
          const icStd = ics.length ? stdDev(ics, icMean) : 0
          const icIr = icStd !== 0 ? icMean / icStd : 0
          const icPositiveRate = ics.length ? ics.filter((v) => v > 0).length / ics.length : 0
          return [
            period,
            {
              period,
              icMean: Math.round(icMean * 1e6) / 1e6,
              icIr: Math.round(icIr * 1e4) / 1e4,
              icPositiveRate: Math.round(icPositiveRate * 1e4) / 1e4,
            },
          ] as const
        }),
      )

      const results = periods.map(
        (period) => summaryByPeriod.get(period) ?? { period, icMean: 0, icIr: 0, icPositiveRate: 0 },
      )

      return { factorName: dto.factorName, results }
    })
  }

  // ── Distribution ─────────────────────────────────────────────────────────

  async getDistribution(dto: FactorDistributionDto) {
    const bins = dto.bins ?? 50
    const cacheKey = `factor:dist:${dto.factorName}:${dto.tradeDate}:${dto.universe ?? 'all'}:${bins}`

    return this.rememberFactorAnalysisCache(cacheKey, async () => {
      const values = await this.compute.getRawFactorValuesForDate(dto.factorName, dto.tradeDate, dto.universe)
      const valid = values.map((v) => v.factorValue).filter((v): v is number => v != null)

      if (!valid.length) {
        return { factorName: dto.factorName, tradeDate: dto.tradeDate, stats: null, histogram: [] }
      }

      valid.sort((a, b) => a - b)
      const n = valid.length
      const total = values.length
      const missing = total - n
      const mu = mean(valid)
      const sd = stdDev(valid, mu)
      const median = n % 2 === 0 ? (valid[n / 2 - 1] + valid[n / 2]) / 2 : valid[Math.floor(n / 2)]
      const q5 = valid[Math.max(0, Math.floor(n * 0.05))]
      const q25 = valid[Math.max(0, Math.floor(n * 0.25))]
      const q75 = valid[Math.max(0, Math.floor(n * 0.75))]
      const q95 = valid[Math.min(n - 1, Math.floor(n * 0.95))]
      const minVal = valid[0]
      const maxVal = valid[n - 1]

      const skewness = sd !== 0 ? valid.reduce((s, v) => s + ((v - mu) / sd) ** 3, 0) / n : 0
      const kurtosis = sd !== 0 ? valid.reduce((s, v) => s + ((v - mu) / sd) ** 4, 0) / n - 3 : 0

      const binWidth = (maxVal - minVal) / bins
      const histogram: Array<{ binStart: number; binEnd: number; count: number }> = []
      for (let i = 0; i < bins; i++) {
        const binStart = minVal + i * binWidth
        const binEnd = binStart + binWidth
        const count = valid.filter((v) => v >= binStart && (i === bins - 1 ? v <= binEnd : v < binEnd)).length
        histogram.push({
          binStart: Math.round(binStart * 1e4) / 1e4,
          binEnd: Math.round(binEnd * 1e4) / 1e4,
          count,
        })
      }

      return {
        factorName: dto.factorName,
        tradeDate: dto.tradeDate,
        stats: {
          count: n,
          missing,
          missingRate: Math.round((missing / total) * 1e4) / 1e4,
          mean: Math.round(mu * 1e4) / 1e4,
          median: Math.round(median * 1e4) / 1e4,
          stdDev: Math.round(sd * 1e4) / 1e4,
          skewness: Math.round(skewness * 1e4) / 1e4,
          kurtosis: Math.round(kurtosis * 1e4) / 1e4,
          min: Math.round(minVal * 1e4) / 1e4,
          max: Math.round(maxVal * 1e4) / 1e4,
          q5: Math.round(q5 * 1e4) / 1e4,
          q25: Math.round(q25 * 1e4) / 1e4,
          q75: Math.round(q75 * 1e4) / 1e4,
          q95: Math.round(q95 * 1e4) / 1e4,
        },
        histogram,
      }
    })
  }

  // ── Correlation ──────────────────────────────────────────────────────────

  async getCorrelation(dto: FactorCorrelationDto): Promise<FactorCorrelationResponseDto> {
    const method = dto.method ?? 'spearman'
    // cacheKey 和 loader 都使用 sorted 顺序，保证任意输入顺序命中同一缓存且结果一致
    const sorted = [...dto.factorNames].sort()
    const cacheKey = `factor:corr:${sorted.join(',')}:${dto.tradeDate}:${dto.universe ?? 'all'}:${method}`

    return this.rememberFactorAnalysisCache(cacheKey, async () => {
      // 按 sorted 顺序加载因子数据
      const factorMaps: Array<Record<string, number>> = []
      for (const factorName of sorted) {
        const vals = await this.compute.getRawFactorValuesForDate(factorName, dto.tradeDate, dto.universe)
        const map: Record<string, number> = {}
        for (const v of vals) {
          if (v.factorValue != null) map[v.tsCode] = v.factorValue
        }
        factorMaps.push(map)
      }

      // 查询因子显示标签（不存在时 fallback 到因子名）
      const defRows = await this.prisma.factorDefinition.findMany({
        where: { name: { in: sorted } },
        select: { name: true, label: true },
      })
      const labelMap = new Map(defRows.map((r) => [r.name, r.label]))

      const nFactors = sorted.length

      // matrix: 两两独立取交集（pairwise），无法计算时为 null 而非 0
      const matrix: (number | null)[][] = Array.from({ length: nFactors }, (_, i) =>
        Array.from({ length: nFactors }, (_, j) => (i === j ? 1 : null)),
      )
      // nMatrix: 对角线为单因子有效值数量；非对角线为两两交集数
      const nMatrix: number[][] = Array.from({ length: nFactors }, (_, i) =>
        Array.from({ length: nFactors }, (_, j) => (i === j ? Object.keys(factorMaps[i]).length : 0)),
      )

      for (let i = 0; i < nFactors; i++) {
        for (let j = i + 1; j < nFactors; j++) {
          const pairCodes = Object.keys(factorMaps[i]).filter((c) => c in factorMaps[j])
          const n = pairCodes.length
          nMatrix[i][j] = n
          nMatrix[j][i] = n

          const vi = pairCodes.map((c) => factorMaps[i][c])
          const vj = pairCodes.map((c) => factorMaps[j][c])
          const corr = method === 'spearman' ? spearmanCorr(vi, vj) : pearsonCorr(vi, vj)
          const val = corr != null ? Math.round(corr * 1e3) / 1e3 : null
          matrix[i][j] = val
          matrix[j][i] = val
        }
      }

      // coverage：有效值股票数 / 所有参与因子覆盖的并集股票数
      const allCodes = new Set<string>()
      factorMaps.forEach((m) => Object.keys(m).forEach((c) => allCodes.add(c)))
      const unionSize = allCodes.size
      const coverage = factorMaps.map((m) => (unionSize > 0 ? Object.keys(m).length / unionSize : 0))

      return {
        tradeDate: dto.tradeDate,
        method,
        factors: sorted,
        factorLabels: sorted.map((f) => labelMap.get(f) ?? f),
        matrix,
        nMatrix,
        coverage,
        meta: {
          universe: dto.universe ?? 'all',
          computedAt: new Date().toISOString(),
          matrixMode: 'pairwise' as const,
          minSampleForCorr: 3,
          rankTiesMethod: 'ordinal',
        },
      }
    })
  }

  private rememberFactorAnalysisCache<T>(key: string, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.FACTOR_ANALYSIS,
      key,
      ttlSeconds: FACTOR_ANALYSIS_CACHE_TTL_SECONDS,
      loader,
    })
  }
}
