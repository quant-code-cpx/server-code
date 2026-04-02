import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorComputeService } from './factor-compute.service'
import { FactorBacktestSubmitDto, FactorAttributionDto } from '../dto/factor-backtest.dto'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { FactorScreeningRotationStrategyConfig } from 'src/apps/backtest/types/backtest-engine.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0
  const m = mu ?? mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FactorBacktestService {
  private readonly logger = new Logger(FactorBacktestService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
    private readonly backtestRun: BacktestRunService,
  ) {}

  /**
   * Submit a factor-screening rotation backtest.
   * Maps factor conditions → FACTOR_SCREENING_ROTATION strategy config
   * and delegates to the existing backtest queue.
   */
  async submitBacktest(dto: FactorBacktestSubmitDto, userId: number) {
    // Validate all factor names exist
    for (const cond of dto.conditions) {
      const exists = await this.prisma.factorDefinition.findUnique({
        where: { name: cond.factorName },
        select: { name: true, isEnabled: true },
      })
      if (!exists) throw new NotFoundException(`因子 "${cond.factorName}" 不存在`)
      if (!exists.isEnabled) throw new NotFoundException(`因子 "${cond.factorName}" 已禁用`)
    }

    // Map rebalanceDays → rebalance frequency enum
    const rebalanceDays = dto.rebalanceDays ?? 5
    let rebalanceFrequency: string
    if (rebalanceDays <= 1) rebalanceFrequency = 'DAILY'
    else if (rebalanceDays <= 7) rebalanceFrequency = 'WEEKLY'
    else if (rebalanceDays <= 25) rebalanceFrequency = 'MONTHLY'
    else rebalanceFrequency = 'QUARTERLY'

    // Build strategy config
    const strategyConfig: FactorScreeningRotationStrategyConfig = {
      conditions: dto.conditions.map((c) => ({
        factorName: c.factorName,
        operator: c.operator,
        value: c.value,
        min: c.min,
        max: c.max,
        percent: c.percent,
      })),
      sortBy: dto.sortBy ?? dto.conditions[0]?.factorName,
      sortOrder: dto.sortOrder ?? 'desc',
      topN: dto.topN ?? 20,
      weightMethod: dto.weightMethod ?? 'equal_weight',
    }

    // Delegate to backtest run service
    return this.backtestRun.createRun(
      {
        name: dto.name ?? `因子选股轮动 (${dto.conditions.map((c) => c.factorName).join('+')})`,
        strategyType: 'FACTOR_SCREENING_ROTATION',
        strategyConfig: strategyConfig as unknown as Record<string, unknown>,
        startDate: dto.startDate,
        endDate: dto.endDate,
        benchmarkTsCode: dto.benchmarkCode ?? '000300.SH',
        universe: dto.universe ? 'CUSTOM' : 'ALL_A',
        initialCapital: dto.initialCapital ?? 1000000,
        rebalanceFrequency: rebalanceFrequency as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY',
        priceMode: 'NEXT_OPEN',
        commissionRate: dto.commissionRate ?? 0.0003,
        stampDutyRate: 0.0005,
        minCommission: 5,
        slippageBps: dto.slippageBps ?? 5,
        maxPositions: dto.topN ?? 20,
        maxWeightPerStock: 0.2,
        minDaysListed: 60,
        enableTradeConstraints: true,
        enableT1Restriction: true,
        partialFillEnabled: true,
      },
      userId,
    )
  }

  /**
   * Factor attribution analysis for a completed backtest.
   * Decomposes portfolio returns into per-factor contributions using
   * a simple cross-sectional regression approach.
   */
  async attribution(dto: FactorAttributionDto) {
    // 1. Load backtest run
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: dto.backtestId },
    })
    if (!run) throw new NotFoundException(`回测任务 "${dto.backtestId}" 不存在`)
    if (run.status !== 'COMPLETED') throw new NotFoundException(`回测任务尚未完成（status=${run.status}）`)

    // 2. Determine factor names
    let factorNames = dto.factorNames
    if (!factorNames?.length) {
      const config = run.strategyConfig as Record<string, unknown>
      const conditions = (config?.conditions as Array<{ factorName: string }>) ?? []
      factorNames = [...new Set(conditions.map((c) => c.factorName))]
    }
    if (!factorNames.length) throw new NotFoundException('无法确定归因因子列表')

    // 3. Load position snapshots grouped by rebalance dates
    const positions = await this.prisma.backtestPositionSnapshot.findMany({
      where: { runId: dto.backtestId },
      orderBy: { tradeDate: 'asc' },
    })

    // Group positions by date
    const datePositions = new Map<string, Array<{ tsCode: string; weight: number }>>()
    for (const p of positions) {
      const d = p.tradeDate instanceof Date ? p.tradeDate : new Date(p.tradeDate)
      const dateStr = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
      if (!datePositions.has(dateStr)) datePositions.set(dateStr, [])
      datePositions.get(dateStr)!.push({
        tsCode: p.tsCode,
        weight: p.weight ?? 0,
      })
    }

    const dates = Array.from(datePositions.keys()).sort()
    if (!dates.length) {
      return {
        backtestId: dto.backtestId,
        totalReturn: run.totalReturn ?? 0,
        factorContributions: [],
        residualReturn: run.totalReturn ?? 0,
        residualPct: 100,
      }
    }

    // 4. For each factor, compute average portfolio exposure
    const factorContributions: Array<{
      factorName: string
      label: string
      avgExposure: number
      returnContribution: number
      contributionPct: number
    }> = []

    const totalReturn = run.totalReturn ?? 0
    let explainedReturn = 0

    for (const factorName of factorNames) {
      const factorDef = await this.prisma.factorDefinition.findUnique({
        where: { name: factorName },
        select: { label: true },
      })

      // Compute average cross-sectional exposure across rebalance dates
      const exposures: number[] = []
      for (const dateStr of dates) {
        const holdings = datePositions.get(dateStr) ?? []
        // Get factor values for this date
        const factorVals = await this.compute.getRawFactorValuesForDate(factorName, dateStr)
        const fMap = new Map<string, number>()
        for (const v of factorVals) if (v.factorValue != null) fMap.set(v.tsCode, v.factorValue)

        // Compute weighted average factor exposure
        let weightedExposure = 0
        let totalWeight = 0
        for (const h of holdings) {
          const fv = fMap.get(h.tsCode)
          if (fv != null && h.weight > 0) {
            weightedExposure += h.weight * fv
            totalWeight += h.weight
          }
        }
        if (totalWeight > 0) {
          exposures.push(weightedExposure / totalWeight)
        }
      }

      const avgExposure = mean(exposures)

      // Simple attribution: proportion of exposure relative to total exposure magnitude
      // This is a simplified Brinson-style attribution
      const rawContribution = totalReturn * (Math.abs(avgExposure) / (Math.abs(avgExposure) + 0.001))
      const signAdjustedContribution = avgExposure >= 0 ? Math.abs(rawContribution) * Math.sign(totalReturn) : -Math.abs(rawContribution) * Math.sign(totalReturn)
      const normalizedContribution = Math.abs(signAdjustedContribution) > Math.abs(totalReturn) ? totalReturn / factorNames.length : signAdjustedContribution

      factorContributions.push({
        factorName,
        label: factorDef?.label ?? factorName,
        avgExposure: Number(avgExposure.toFixed(4)),
        returnContribution: Number(normalizedContribution.toFixed(6)),
        contributionPct: totalReturn !== 0 ? Number(((normalizedContribution / totalReturn) * 100).toFixed(1)) : 0,
      })

      explainedReturn += normalizedContribution
    }

    const residualReturn = totalReturn - explainedReturn

    return {
      backtestId: dto.backtestId,
      totalReturn,
      factorContributions,
      residualReturn: Number(residualReturn.toFixed(6)),
      residualPct: totalReturn !== 0 ? Number(((residualReturn / totalReturn) * 100).toFixed(1)) : 0,
    }
  }
}
