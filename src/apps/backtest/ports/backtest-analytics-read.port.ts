export const BACKTEST_ANALYTICS_READ_PORT = Symbol('BACKTEST_ANALYTICS_READ_PORT')

export interface BacktestAnalyticsReadPort {
  monteCarlo(
    runId: string,
    userId: number,
    input: { simulations: number; seed: number; confidenceLevels: number[] },
  ): Promise<unknown>
  brinson(
    runId: string,
    userId: number,
    input: { industryLevel: 'L1' | 'L2'; granularity: 'WEEKLY' | 'MONTHLY'; benchmarkCode: string },
  ): Promise<unknown>
  costSensitivity(
    runId: string,
    userId: number,
    input: { commissionRates?: number[]; slippageBps?: number[] },
  ): Promise<unknown>
  getParamSweepResult(sweepId: string, userId: number): Promise<unknown>
  getWalkForwardResult(walkForwardRunId: string, userId: number): Promise<unknown>
  getComparisonResult(comparisonGroupId: string, userId: number): Promise<unknown>
}
