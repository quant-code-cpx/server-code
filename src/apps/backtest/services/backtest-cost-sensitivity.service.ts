import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { CostSensitivityDto, CostSensitivityPointDto, CostSensitivityResponseDto } from '../dto/cost-sensitivity.dto'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_COMMISSION_RATES = [0.0001, 0.0002, 0.0003, 0.0005, 0.001]
const DEFAULT_SLIPPAGE_BPS_LIST = [0, 2, 5, 10, 20]
const MAX_PARAM_VALUES = 10
const TRADING_DAYS_PER_YEAR = 252
const RISK_FREE_RATE = 0.02

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Compute new trade cost with given parameters.
 * Mirrors the logic in BacktestExecutionService.
 */
function computeNewCost(
  side: string,
  amount: number,
  commissionRate: number,
  slippageBps: number,
  stampDutyRate: number,
  minCommission: number,
): number {
  const commission = Math.max(amount * commissionRate, minCommission)
  const stampDuty = side === 'SELL' ? amount * stampDutyRate : 0
  const slippageCost = (amount * slippageBps) / 10000
  return commission + stampDuty + slippageCost
}

/**
 * Compute key metrics from an array of NAV values (absolute monetary values).
 * Uses the same formulas as BacktestMetricsService but only for the 4 metrics needed.
 */
function computeMetrics(navs: number[]): {
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  maxDrawdown: number
} {
  if (navs.length < 2) return { totalReturn: 0, annualizedReturn: 0, sharpeRatio: 0, maxDrawdown: 0 }

  const first = navs[0]
  const last = navs[navs.length - 1]
  const totalReturn = first > 0 ? last / first - 1 : 0
  const years = navs.length / TRADING_DAYS_PER_YEAR
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0

  // Daily returns
  const dailyRets: number[] = []
  for (let i = 1; i < navs.length; i++) {
    dailyRets.push(navs[i - 1] > 0 ? navs[i] / navs[i - 1] - 1 : 0)
  }

  // Sharpe
  const rfDaily = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR
  const excesses = dailyRets.map(r => r - rfDaily)
  const mean = excesses.reduce((a, b) => a + b, 0) / excesses.length
  const variance = excesses.reduce((a, b) => a + (b - mean) ** 2, 0) / excesses.length
  const annualizedStd = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
  const sharpeRatio = annualizedStd > 1e-8 ? (annualizedReturn - RISK_FREE_RATE) / annualizedStd : 0

  // Max drawdown
  let peak = navs[0]
  let maxDrawdown = 0
  for (const n of navs) {
    if (n > peak) peak = n
    const dd = peak > 0 ? (n - peak) / peak : 0
    if (dd < maxDrawdown) maxDrawdown = dd
  }

  return { totalReturn, annualizedReturn, sharpeRatio, maxDrawdown }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class BacktestCostSensitivityService {
  constructor(private readonly prisma: PrismaService) {}

  async analyze(dto: CostSensitivityDto, userId: number): Promise<CostSensitivityResponseDto> {
    const { runId } = dto

    // ── Step 1: Validate run ──────────────────────────────────────────────────
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      select: {
        userId: true,
        status: true,
        commissionRate: true,
        stampDutyRate: true,
        minCommission: true,
        slippageBps: true,
        initialCapital: true,
        totalReturn: true,
      },
    })
    if (!run) throw new NotFoundException('回测任务不存在')
    if (run.status !== 'COMPLETED') throw new BadRequestException('回测任务尚未完成')
    if (run.userId !== userId) throw new ForbiddenException('无权访问该回测任务')

    const origCommissionRate = Number(run.commissionRate ?? 0.0003)
    const origStampDutyRate = Number(run.stampDutyRate ?? 0.0005)
    const origMinCommission = Number(run.minCommission ?? 5)
    const origSlippageBps = run.slippageBps ?? 5
    const initialCapital = Number(run.initialCapital)

    // ── Step 2: Validate param arrays ─────────────────────────────────────────
    const commissionRates = dto.commissionRates ?? DEFAULT_COMMISSION_RATES
    const slippageBpsList = dto.slippageBpsList ?? DEFAULT_SLIPPAGE_BPS_LIST
    if (commissionRates.length > MAX_PARAM_VALUES || slippageBpsList.length > MAX_PARAM_VALUES) {
      throw new BadRequestException(`参数数组长度不能超过 ${MAX_PARAM_VALUES}`)
    }

    // ── Step 3: Load trades ───────────────────────────────────────────────────
    const trades = await this.prisma.backtestTrade.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, side: true, amount: true, commission: true, stampDuty: true, slippageCost: true },
    })
    if (trades.length === 0) throw new BadRequestException('该回测无交易记录')

    // ── Step 4: Load NAV sequence ─────────────────────────────────────────────
    const navRows = await this.prisma.backtestDailyNav.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, nav: true },
    })
    if (navRows.length < 2) throw new BadRequestException('该回测 NAV 数据不足')

    // Build date → original NAV map
    const navMap = new Map<string, number>()
    for (const n of navRows) {
      navMap.set(toDateStr(n.tradeDate), Number(n.nav))
    }
    const tradeDates = navRows.map(n => toDateStr(n.tradeDate))
    const originalNavs = tradeDates.map(ds => navMap.get(ds) ?? 0)

    // ── Step 5: Build per-day original cost for each trade ────────────────────
    // Map: YYYYMMDD → original total cost
    const dailyOrigCost = new Map<string, number>()
    for (const t of trades) {
      const ds = toDateStr(t.tradeDate)
      const c = Number(t.commission ?? 0) + Number(t.stampDuty ?? 0) + Number(t.slippageCost ?? 0)
      dailyOrigCost.set(ds, (dailyOrigCost.get(ds) ?? 0) + c)
    }

    // ── Step 6: Compute grid ──────────────────────────────────────────────────
    const points: CostSensitivityPointDto[] = []

    for (const cr of commissionRates) {
      for (const sbps of slippageBpsList) {
        // Per-day new cost and delta
        const dailyNewCost = new Map<string, number>()
        let totalNewCost = 0

        for (const t of trades) {
          const ds = toDateStr(t.tradeDate)
          const nc = computeNewCost(t.side, Number(t.amount), cr, sbps, origStampDutyRate, origMinCommission)
          dailyNewCost.set(ds, (dailyNewCost.get(ds) ?? 0) + nc)
          totalNewCost += nc
        }

        // Build adjusted NAV series
        let cumulativeDelta = 0
        const adjustedNavs: number[] = []
        for (const ds of tradeDates) {
          const origC = dailyOrigCost.get(ds) ?? 0
          const newC = dailyNewCost.get(ds) ?? 0
          cumulativeDelta += newC - origC
          const origNav = navMap.get(ds) ?? 0
          adjustedNavs.push(Math.max(origNav - cumulativeDelta, 0))
        }

        const metrics = computeMetrics(adjustedNavs)
        points.push({
          commissionRate: cr,
          slippageBps: sbps,
          totalReturn: metrics.totalReturn,
          annualizedReturn: metrics.annualizedReturn,
          sharpeRatio: metrics.sharpeRatio,
          maxDrawdown: metrics.maxDrawdown,
          totalCost: totalNewCost,
          costCapitalRatio: initialCapital > 0 ? totalNewCost / initialCapital : 0,
        })
      }
    }

    return {
      runId,
      originalCommissionRate: origCommissionRate,
      originalSlippageBps: origSlippageBps,
      baselineTotalReturn: run.totalReturn ?? originalNavs.length >= 2
        ? (originalNavs[originalNavs.length - 1] - originalNavs[0]) / originalNavs[0]
        : 0,
      points,
    }
  }
}
