import type { Prisma } from '@prisma/client'
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { RunMonteCarloDto } from '../dto/monte-carlo.dto'

const TRADING_DAYS_PER_YEAR = 252

interface MonteCarloOptions {
  numSimulations: number
  confidenceLevels: number[]
  seed?: number
}

@Injectable()
export class BacktestMonteCarloService {
  constructor(private readonly prisma: PrismaService) {}

  async runMonteCarloSimulation(runId: string, dto: RunMonteCarloDto) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    const navRows = await this.prisma.backtestDailyNav.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
      select: { nav: true, dailyReturn: true },
    })

    if (navRows.length < 2) {
      throw new NotFoundException(`Not enough NAV data for backtest run ${runId}`)
    }

    const firstNav = Number(navRows[0].nav ?? 0)
    if (firstNav === 0) {
      throw new NotFoundException(`Initial NAV is zero for backtest run ${runId}`)
    }

    const options: MonteCarloOptions = {
      numSimulations: dto.numSimulations ?? 1000,
      confidenceLevels: [0.05, 0.25, 0.5, 0.75, 0.95],
      seed: dto.seed,
    }

    return this.compute(navRows, options)
  }

  private compute(
    navRows: Array<{ nav: Prisma.Decimal | null; dailyReturn: number | null }>,
    options: MonteCarloOptions,
  ) {
    const { numSimulations, confidenceLevels, seed } = options
    const n = navRows.length
    const originalNavs = navRows.map((r) => Number(r.nav ?? 1))
    const dailyReturns = navRows
      .map((r) => r.dailyReturn ?? 0)
      .filter((r) => isFinite(r))

    const originalFinalNav = originalNavs[n - 1] / originalNavs[0]
    const originalTotalReturn = originalFinalNav - 1

    // Seeded pseudo-random (simple LCG for reproducibility)
    const rng = this.makeRng(seed)

    // Run simulations
    const finalNavs: number[] = []
    const maxDrawdowns: number[] = []
    const annualizedReturns: number[] = []
    // For time-series percentiles: track nav paths (sparse, every step)
    const allPaths: number[][] = []

    for (let s = 0; s < numSimulations; s++) {
      // Bootstrap resample daily returns
      const sampledReturns = Array.from({ length: dailyReturns.length }, () => {
        const idx = Math.floor(rng() * dailyReturns.length)
        return dailyReturns[idx]
      })

      // Compute NAV path from returns
      const path: number[] = [1.0]
      let peak = 1.0
      let maxDd = 0

      for (const r of sampledReturns) {
        const newNav = path[path.length - 1] * (1 + r)
        path.push(newNav)
        if (newNav > peak) peak = newNav
        const dd = peak > 0 ? newNav / peak - 1 : 0
        if (dd < maxDd) maxDd = dd
      }

      const finalNav = path[path.length - 1]
      finalNavs.push(finalNav)
      maxDrawdowns.push(maxDd)
      if (dailyReturns.length > 0) {
        annualizedReturns.push(Math.pow(finalNav, TRADING_DAYS_PER_YEAR / dailyReturns.length) - 1)
      } else {
        annualizedReturns.push(0)
      }
      allPaths.push(path)
    }

    // Helper: compute percentile
    const percentile = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = p * (sorted.length - 1)
      const lo = Math.floor(idx)
      const hi = Math.ceil(idx)
      if (lo === hi) return sorted[lo]
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
    }

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const std = (arr: number[]) => {
      const m = mean(arr)
      return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)
    }

    const finalNavPercentiles: Record<string, number> = {}
    const annRetPercentiles: Record<string, number> = {}
    for (const p of confidenceLevels) {
      const key = String(Math.round(p * 100))
      finalNavPercentiles[key] = percentile(finalNavs, p)
      annRetPercentiles[key] = percentile(annualizedReturns, p)
    }

    const positiveReturnProbability = finalNavs.filter((v) => v > 1).length / numSimulations

    // Time-series percentiles (sampled at each step)
    const steps = dailyReturns.length + 1
    const timeSeries = Array.from({ length: steps }, (_, dayIdx) => {
      const navAtStep = allPaths.map((path) => path[Math.min(dayIdx, path.length - 1)])
      const ps: Record<string, number> = {}
      for (const p of confidenceLevels) {
        ps[String(Math.round(p * 100))] = percentile(navAtStep, p)
      }
      return { dayIndex: dayIdx, percentiles: ps }
    })

    return {
      numSimulations,
      originalFinalNav,
      originalTotalReturn,
      finalNavDistribution: {
        mean: mean(finalNavs),
        median: percentile(finalNavs, 0.5),
        std: std(finalNavs),
        percentiles: finalNavPercentiles,
        positiveReturnProbability,
      },
      maxDrawdownDistribution: {
        mean: mean(maxDrawdowns),
        median: percentile(maxDrawdowns, 0.5),
        percentile95: percentile(maxDrawdowns, 0.95),
      },
      annualizedReturnDistribution: {
        mean: mean(annualizedReturns),
        median: percentile(annualizedReturns, 0.5),
        std: std(annualizedReturns),
        percentiles: annRetPercentiles,
      },
      timeSeries,
    }
  }

  /** Simple seeded LCG random number generator */
  private makeRng(seed?: number): () => number {
    let s = seed ?? Date.now()
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff
      return (s >>> 0) / 0xffffffff
    }
  }
}
