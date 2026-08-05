import { Injectable } from '@nestjs/common'
import { BacktestAttributionService } from './services/backtest-attribution.service'
import { BacktestComparisonService } from './services/backtest-comparison.service'
import { BacktestCostSensitivityService } from './services/backtest-cost-sensitivity.service'
import { BacktestMonteCarloService } from './services/backtest-monte-carlo.service'
import { BacktestParamSensitivityService } from './services/backtest-param-sensitivity.service'
import { BacktestWalkForwardService } from './services/backtest-walk-forward.service'
import type { BacktestAnalyticsReadPort } from './ports/backtest-analytics-read.port'

@Injectable()
export class BacktestAnalyticsReadAdapter implements BacktestAnalyticsReadPort {
  constructor(
    private readonly monteCarloService: BacktestMonteCarloService,
    private readonly attributionService: BacktestAttributionService,
    private readonly costService: BacktestCostSensitivityService,
    private readonly paramService: BacktestParamSensitivityService,
    private readonly walkForwardService: BacktestWalkForwardService,
    private readonly comparisonService: BacktestComparisonService,
  ) {}

  monteCarlo(runId: string, userId: number, input: { simulations: number; seed: number; confidenceLevels: number[] }) {
    return this.monteCarloService.runMonteCarloSimulation(
      runId,
      { numSimulations: input.simulations, seed: input.seed, confidenceLevels: input.confidenceLevels },
      userId,
    )
  }

  brinson(
    runId: string,
    userId: number,
    input: { industryLevel: 'L1' | 'L2'; granularity: 'WEEKLY' | 'MONTHLY'; benchmarkCode: string },
  ) {
    return this.attributionService.brinson(
      {
        runId,
        industryLevel: input.industryLevel,
        granularity: input.granularity,
        benchmarkTsCode: input.benchmarkCode,
      },
      userId,
    )
  }

  costSensitivity(runId: string, userId: number, input: { commissionRates?: number[]; slippageBps?: number[] }) {
    return this.costService.analyze(
      { runId, commissionRates: input.commissionRates, slippageBpsList: input.slippageBps },
      userId,
    )
  }

  getParamSweepResult(sweepId: string, userId: number) {
    return this.paramService.getResult(sweepId, userId)
  }

  async getWalkForwardResult(walkForwardRunId: string, userId: number) {
    const [detail, equity] = await Promise.all([
      this.walkForwardService.getWalkForwardRunDetail(walkForwardRunId, userId),
      this.walkForwardService.getWalkForwardEquity(walkForwardRunId, userId),
    ])
    return { detail, equity }
  }

  async getComparisonResult(comparisonGroupId: string, userId: number) {
    const [detail, equity] = await Promise.all([
      this.comparisonService.getComparisonDetail(comparisonGroupId, userId),
      this.comparisonService.getComparisonEquity(comparisonGroupId, userId),
    ])
    return { detail, equity }
  }
}
