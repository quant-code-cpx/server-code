import { PrismaService } from 'src/shared/prisma.service'
import {
  BacktestConfig,
  CustomPoolRebalanceStrategyConfig,
  DailyBar,
  SignalOutput,
} from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

export class CustomPoolRebalanceStrategy implements IBacktestStrategy<'CUSTOM_POOL_REBALANCE'> {
  async generateSignal(
    _signalDate: Date,
    config: BacktestConfig<'CUSTOM_POOL_REBALANCE'>,
    _barData: Map<string, DailyBar>,
    _historicalBars: Map<string, DailyBar[]>,
    _prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg: CustomPoolRebalanceStrategyConfig = config.strategyConfig
    const { tsCodes = [], weightMode = 'EQUAL', customWeights = [] } = cfg

    if (tsCodes.length === 0) return { targets: [] }

    if (weightMode === 'CUSTOM' && customWeights.length > 0) {
      const weightMap = new Map(customWeights.map((w) => [w.tsCode, w.weight]))
      return {
        targets: tsCodes.map((tsCode) => ({
          tsCode,
          weight: weightMap.get(tsCode),
        })),
      }
    }

    // Equal weight
    return {
      targets: tsCodes.map((tsCode) => ({ tsCode })),
    }
  }
}
