import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import {
  BrinsonAttributionDto,
  BrinsonAttributionResponseDto,
  BrinsonIndustryDetailDto,
  BrinsonPeriodDto,
} from '../dto/brinson-attribution.dto'

// ── Pure helpers (module-level, no side effects) ──────────────────────────────

/** Format Date to 'YYYYMMDD' string */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Format Date to 'YYYY-MM-DD' string */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Compound return from an array of daily decimal returns (e.g. 0.01 = 1%).
 * Used for BacktestDailyNav.dailyReturn values.
 */
function compoundDecimal(returns: number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1
}

/**
 * Compound return from an array of pctChg values (e.g. 1.0 = 1%).
 * Used for Daily.pctChg values from Tushare.
 */
function compoundPctChg(pctChgs: number[]): number {
  return pctChgs.reduce((acc, r) => acc * (1 + r / 100), 1) - 1
}

/** ISO year-week string, e.g. '2024-W03' — used for WEEKLY period grouping */
function isoWeekKey(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const weekStart = new Date(jan4.getTime() - ((jan4.getDay() + 6) % 7) * 86400000)
  const week = Math.floor((d.getTime() - weekStart.getTime()) / (7 * 86400000)) + 1
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Split an ordered array of trading dates into periods based on granularity.
 * Each period contains {start, end, dateStrs[]}.
 */
function splitPeriods(
  tradeDates: Date[],
  granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY',
): Array<{ start: Date; end: Date; dateStrs: string[] }> {
  if (tradeDates.length === 0) return []

  if (granularity === 'DAILY') {
    return tradeDates.map((d) => ({ start: d, end: d, dateStrs: [toDateStr(d)] }))
  }

  const periodKey = (d: Date): string =>
    granularity === 'MONTHLY' ? `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}` : isoWeekKey(d)

  const periods: Array<{ start: Date; end: Date; dateStrs: string[] }> = []
  let pStart = tradeDates[0]
  let pKey = periodKey(tradeDates[0])
  let pDateStrs: string[] = [toDateStr(tradeDates[0])]

  for (let i = 1; i < tradeDates.length; i++) {
    const curr = tradeDates[i]
    const k = periodKey(curr)
    if (k !== pKey) {
      periods.push({ start: pStart, end: tradeDates[i - 1], dateStrs: pDateStrs })
      pStart = curr
      pKey = k
      pDateStrs = [toDateStr(curr)]
    } else {
      pDateStrs.push(toDateStr(curr))
    }
  }
  periods.push({ start: pStart, end: tradeDates[tradeDates.length - 1], dateStrs: pDateStrs })
  return periods
}

/**
 * Forward-fill lookup: given a sorted array of keys and a map,
 * return the value for the latest key <= targetKey.
 */
function forwardFill<T>(sortedKeys: string[], map: Map<string, T>, targetKey: string): T | null {
  let result: T | null = null
  for (const k of sortedKeys) {
    if (k <= targetKey) result = map.get(k) ?? null
    else break
  }
  return result
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class BacktestAttributionService {
  constructor(private readonly prisma: PrismaService) {}

  async brinson(dto: BrinsonAttributionDto, userId: number): Promise<BrinsonAttributionResponseDto> {
    const { runId } = dto
    const industryLevel = dto.industryLevel ?? 'L1'
    const granularity = dto.granularity ?? 'MONTHLY'

    // ── Step 1: Validate run ───────────────────────────────────────────────────
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException('回测任务不存在')
    if (run.status !== 'COMPLETED') throw new BadRequestException('回测任务尚未完成')
    if (run.userId !== userId) throw new ForbiddenException('无权访问该回测任务')

    const benchmarkTsCode = dto.benchmarkTsCode ?? run.benchmarkTsCode

    // ── Step 2: Load position snapshots (all rebalance dates) ─────────────────
    const allSnapshots = await this.prisma.backtestPositionSnapshot.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, tsCode: true, weight: true },
    })
    if (allSnapshots.length === 0) throw new BadRequestException('该回测无持仓数据')

    // Map: 'YYYYMMDD' → [{tsCode, weight}]
    const snapshotsByDate = new Map<string, Array<{ tsCode: string; weight: number }>>()
    for (const s of allSnapshots) {
      const ds = toDateStr(s.tradeDate)
      if (!snapshotsByDate.has(ds)) snapshotsByDate.set(ds, [])
      snapshotsByDate.get(ds)!.push({ tsCode: s.tsCode, weight: s.weight ?? 0 })
    }
    const snapshotDates = [...snapshotsByDate.keys()].sort()

    // ── Step 3: Load daily NAVs (trading day sequence) ────────────────────────
    const dailyNavs = await this.prisma.backtestDailyNav.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, dailyReturn: true, benchmarkReturn: true },
    })
    const tradeDates = dailyNavs.map((n) => n.tradeDate)
    if (tradeDates.length === 0) {
      return this.emptyResponse(runId, benchmarkTsCode, industryLevel, granularity)
    }

    // Map: 'YYYYMMDD' → {dr, br} (decimal returns, e.g. 0.01 = 1%)
    const navByDate = new Map<string, { dr: number; br: number }>()
    for (const n of dailyNavs) {
      navByDate.set(toDateStr(n.tradeDate), { dr: n.dailyReturn ?? 0, br: n.benchmarkReturn ?? 0 })
    }

    // ── Step 4: Load industry mapping ─────────────────────────────────────────
    const industryMembers = await this.prisma.indexMemberAll.findMany({
      where: { isNew: 'Y' },
      select: { tsCode: true, l1Code: true, l1Name: true, l2Code: true, l2Name: true },
    })
    const industryMap = new Map<string, { code: string; name: string }>()
    const industryNameLookup = new Map<string, string>() // code → name
    for (const m of industryMembers) {
      const entry = industryLevel === 'L1' ? { code: m.l1Code, name: m.l1Name } : { code: m.l2Code, name: m.l2Name }
      industryMap.set(m.tsCode, entry)
      industryNameLookup.set(entry.code, entry.name)
    }
    industryNameLookup.set('OTHER', '其他')

    // ── Step 5: Load benchmark constituent weights ────────────────────────────
    const endDateStr = toDateStr(tradeDates[tradeDates.length - 1])
    const rawBenchmarkWeights = await this.prisma.indexWeight.findMany({
      where: { indexCode: benchmarkTsCode, tradeDate: { lte: endDateStr } },
      select: { tradeDate: true, conCode: true, weight: true },
      orderBy: { tradeDate: 'asc' },
    })
    // Map: 'YYYYMMDD' → Map<conCode, weight (decimal, 0-1)>
    const benchmarkByDate = new Map<string, Map<string, number>>()
    for (const w of rawBenchmarkWeights) {
      if (!benchmarkByDate.has(w.tradeDate)) benchmarkByDate.set(w.tradeDate, new Map())
      benchmarkByDate.get(w.tradeDate)!.set(w.conCode, Number(w.weight ?? 0) / 100)
    }
    const benchmarkDates = [...benchmarkByDate.keys()].sort()

    // ── Step 6: Load daily stock prices ───────────────────────────────────────
    const allCodes = new Set<string>()
    allSnapshots.forEach((s) => allCodes.add(s.tsCode))
    rawBenchmarkWeights.forEach((w) => allCodes.add(w.conCode))

    const allDaily = await this.prisma.daily.findMany({
      where: {
        tsCode: { in: [...allCodes] },
        tradeDate: { gte: tradeDates[0], lte: tradeDates[tradeDates.length - 1] },
      },
      select: { tsCode: true, tradeDate: true, pctChg: true },
    })
    // Map: '${tsCode}_${YYYYMMDD}' → pctChg (percentage, e.g. 1.5 = 1.5%)
    const priceMap = new Map<string, number>()
    for (const d of allDaily) {
      priceMap.set(`${d.tsCode}_${toDateStr(d.tradeDate)}`, d.pctChg ?? 0)
    }

    // ── Step 7: Split periods ─────────────────────────────────────────────────
    const periods = splitPeriods(tradeDates, granularity)

    // ── Step 8: Per-period Brinson attribution ────────────────────────────────
    interface IndustryAgg {
      name: string
      totalAA: number
      totalSS: number
      totalIN: number
      sumPortfolioWeight: number // Σ wp_i across periods
      sumBenchmarkWeight: number // Σ wb_i across periods
      sumWpRp: number // Σ (wp_i × Rp_i) — for weighted avg return
      sumWbRb: number // Σ (wb_i × Rb_i)
      periodCount: number
    }
    const industryAgg = new Map<string, IndustryAgg>()
    const periodResults: BrinsonPeriodDto[] = []

    for (const period of periods) {
      const pStart = toDateStr(period.start)

      // Forward-fill portfolio positions
      const positions = forwardFill(snapshotDates, snapshotsByDate, pStart) ?? []
      if (positions.length === 0) continue

      // Forward-fill benchmark weights (graceful degradation: empty map if missing)
      const bwConMap = forwardFill(benchmarkDates, benchmarkByDate, pStart) ?? new Map<string, number>()

      // Portfolio industry weights: tsCode.weight → industry.weight
      const pwIndustry = new Map<string, number>()
      for (const pos of positions) {
        const ind = industryMap.get(pos.tsCode) ?? { code: 'OTHER', name: '其他' }
        pwIndustry.set(ind.code, (pwIndustry.get(ind.code) ?? 0) + pos.weight)
      }

      // Benchmark industry weights: benchmark conCode.weight → industry.weight
      const bwIndustry = new Map<string, number>()
      for (const [conCode, weight] of bwConMap) {
        const ind = industryMap.get(conCode) ?? { code: 'OTHER', name: '其他' }
        bwIndustry.set(ind.code, (bwIndustry.get(ind.code) ?? 0) + weight)
      }

      // All industry codes appearing in either portfolio or benchmark
      const allIndCodes = new Set([...pwIndustry.keys(), ...bwIndustry.keys()])

      // Per-industry portfolio stocks grouped by industry code
      const portfolioStocksByInd = new Map<string, Array<{ tsCode: string; weight: number }>>()
      for (const pos of positions) {
        const ind = industryMap.get(pos.tsCode) ?? { code: 'OTHER', name: '其他' }
        if (!portfolioStocksByInd.has(ind.code)) portfolioStocksByInd.set(ind.code, [])
        portfolioStocksByInd.get(ind.code)!.push(pos)
      }

      // Per-industry benchmark stocks grouped by industry code
      const benchmarkStocksByInd = new Map<string, Map<string, number>>()
      for (const [conCode, weight] of bwConMap) {
        const ind = industryMap.get(conCode) ?? { code: 'OTHER', name: '其他' }
        if (!benchmarkStocksByInd.has(ind.code)) benchmarkStocksByInd.set(ind.code, new Map())
        benchmarkStocksByInd.get(ind.code)!.set(conCode, weight)
      }

      // Compute industry returns & Brinson factors for this period
      let periodAA = 0
      let periodSS = 0
      let periodIN = 0

      for (const indCode of allIndCodes) {
        const wp = pwIndustry.get(indCode) ?? 0
        const wb = bwIndustry.get(indCode) ?? 0

        // Portfolio industry return (weighted avg of stock pctChg, then compound)
        const pStocks = portfolioStocksByInd.get(indCode) ?? []
        const Rp = this.industryReturn(pStocks, wp, period.dateStrs, priceMap, 'portfolio', industryMap)

        // Benchmark industry return (weighted avg of stock pctChg, then compound)
        const bStocks = benchmarkStocksByInd.get(indCode) ?? new Map<string, number>()
        const Rb = this.benchmarkIndustryReturn(bStocks, wb, period.dateStrs, priceMap)

        const AA = (wp - wb) * Rb
        const SS = wb * (Rp - Rb)
        const IN = (wp - wb) * (Rp - Rb)
        periodAA += AA
        periodSS += SS
        periodIN += IN

        // Accumulate industry aggregates
        if (!industryAgg.has(indCode)) {
          industryAgg.set(indCode, {
            name: industryNameLookup.get(indCode) ?? '其他',
            totalAA: 0,
            totalSS: 0,
            totalIN: 0,
            sumPortfolioWeight: 0,
            sumBenchmarkWeight: 0,
            sumWpRp: 0,
            sumWbRb: 0,
            periodCount: 0,
          })
        }
        const agg = industryAgg.get(indCode)!
        agg.totalAA += AA
        agg.totalSS += SS
        agg.totalIN += IN
        agg.sumPortfolioWeight += wp
        agg.sumBenchmarkWeight += wb
        agg.sumWpRp += wp * Rp
        agg.sumWbRb += wb * Rb
        agg.periodCount++
      }

      // Period portfolio and benchmark returns from NAV data
      const periodPortfolioReturn = compoundDecimal(period.dateStrs.map((ds) => navByDate.get(ds)?.dr ?? 0))
      const periodBenchmarkReturn = compoundDecimal(period.dateStrs.map((ds) => navByDate.get(ds)?.br ?? 0))

      periodResults.push({
        startDate: toIsoDate(period.start),
        endDate: toIsoDate(period.end),
        portfolioReturn: periodPortfolioReturn,
        benchmarkReturn: periodBenchmarkReturn,
        allocationEffect: periodAA,
        selectionEffect: periodSS,
        interactionEffect: periodIN,
        excessReturn: periodPortfolioReturn - periodBenchmarkReturn,
      })
    }

    // ── Step 9: Aggregate industry details ────────────────────────────────────
    const industries: BrinsonIndustryDetailDto[] = []
    for (const [code, agg] of industryAgg) {
      const n = agg.periodCount || 1
      const avgPw = agg.sumPortfolioWeight / n
      const avgBw = agg.sumBenchmarkWeight / n
      // Weighted-average returns (avoid divide-by-zero)
      const avgRp = agg.sumPortfolioWeight > 0 ? agg.sumWpRp / agg.sumPortfolioWeight : 0
      const avgRb = agg.sumBenchmarkWeight > 0 ? agg.sumWbRb / agg.sumBenchmarkWeight : 0

      industries.push({
        industryCode: code,
        industryName: agg.name,
        portfolioWeight: avgPw,
        benchmarkWeight: avgBw,
        portfolioReturn: avgRp,
        benchmarkReturn: avgRb,
        allocationEffect: agg.totalAA,
        selectionEffect: agg.totalSS,
        interactionEffect: agg.totalIN,
        totalEffect: agg.totalAA + agg.totalSS + agg.totalIN,
      })
    }
    // Sort by absolute total effect descending
    industries.sort((a, b) => Math.abs(b.totalEffect) - Math.abs(a.totalEffect))

    // ── Step 10: Assemble response ────────────────────────────────────────────
    const allDrs = dailyNavs.map((n) => n.dailyReturn ?? 0)
    const allBrs = dailyNavs.map((n) => n.benchmarkReturn ?? 0)
    const totalPortfolioReturn = compoundDecimal(allDrs)
    const totalBenchmarkReturn = compoundDecimal(allBrs)

    let totalAA = 0
    let totalSS = 0
    let totalIN = 0
    for (const p of periodResults) {
      totalAA += p.allocationEffect
      totalSS += p.selectionEffect
      totalIN += p.interactionEffect
    }

    return {
      runId,
      benchmarkTsCode,
      industryLevel,
      granularity,
      startDate: toIsoDate(tradeDates[0]),
      endDate: toIsoDate(tradeDates[tradeDates.length - 1]),
      portfolioReturn: totalPortfolioReturn,
      benchmarkReturn: totalBenchmarkReturn,
      excessReturn: totalPortfolioReturn - totalBenchmarkReturn,
      totalAllocationEffect: totalAA,
      totalSelectionEffect: totalSS,
      totalInteractionEffect: totalIN,
      industries,
      periods: periodResults,
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Compute portfolio industry return for a given industry over the period.
   * Uses pctChg values (percentage scale) from priceMap.
   * Strategy: compute daily weighted-average pctChg across stocks in the industry,
   * then compound the daily returns.
   */
  private industryReturn(
    stocks: Array<{ tsCode: string; weight: number }>,
    totalWeight: number,
    dateStrs: string[],
    priceMap: Map<string, number>,
    _side: 'portfolio',
    _industryMap: Map<string, { code: string; name: string }>,
  ): number {
    if (stocks.length === 0 || totalWeight <= 0) return 0
    const dailyPctChgs = dateStrs.map((ds) => {
      let weighted = 0
      for (const s of stocks) {
        weighted += (s.weight / totalWeight) * (priceMap.get(`${s.tsCode}_${ds}`) ?? 0)
      }
      return weighted
    })
    return compoundPctChg(dailyPctChgs)
  }

  /**
   * Compute benchmark industry return for a given industry over the period.
   * bStocks: Map<conCode, weight (decimal, 0-1)>
   */
  private benchmarkIndustryReturn(
    bStocks: Map<string, number>,
    totalWeight: number,
    dateStrs: string[],
    priceMap: Map<string, number>,
  ): number {
    if (bStocks.size === 0 || totalWeight <= 0) return 0
    const dailyPctChgs = dateStrs.map((ds) => {
      let weighted = 0
      for (const [conCode, weight] of bStocks) {
        weighted += (weight / totalWeight) * (priceMap.get(`${conCode}_${ds}`) ?? 0)
      }
      return weighted
    })
    return compoundPctChg(dailyPctChgs)
  }

  private emptyResponse(
    runId: string,
    benchmarkTsCode: string,
    industryLevel: string,
    granularity: string,
  ): BrinsonAttributionResponseDto {
    return {
      runId,
      benchmarkTsCode,
      industryLevel,
      granularity,
      startDate: '',
      endDate: '',
      portfolioReturn: 0,
      benchmarkReturn: 0,
      excessReturn: 0,
      totalAllocationEffect: 0,
      totalSelectionEffect: 0,
      totalInteractionEffect: 0,
      industries: [],
      periods: [],
    }
  }
}
