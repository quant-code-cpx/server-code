import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, DailyBar, SignalOutput } from '../types/backtest-engine.types'

export interface IBacktestStrategy {
  /** Called once before the backtest loop to allow strategy initialization */
  initialize?(config: BacktestConfig, prisma: PrismaService): Promise<void>
  /** Generate target portfolio for the given signal date */
  generateSignal(
    signalDate: Date,
    config: BacktestConfig,
    barData: Map<string, DailyBar>,
    historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput>
}
