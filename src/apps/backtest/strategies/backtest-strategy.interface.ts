import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, BacktestStrategyType, DailyBar, SignalOutput } from '../types/backtest-engine.types'

export interface IBacktestStrategy<T extends BacktestStrategyType = BacktestStrategyType> {
  /** Called once before the backtest loop to allow strategy initialization */
  initialize?(config: BacktestConfig<T>, prisma: PrismaService): Promise<void>
  /** Generate target portfolio for the given signal date */
  generateSignal(
    signalDate: Date,
    config: BacktestConfig<T>,
    barData: Map<string, DailyBar>,
    historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput>
}
