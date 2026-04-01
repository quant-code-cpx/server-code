import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, DailyBar, SignalOutput } from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

interface CustomPoolRebalanceConfig {
  tsCodes: string[]
  weightMode: 'EQUAL' | 'CUSTOM'
  customWeights?: Array<{ tsCode: string; weight: number }>
}

export class CustomPoolRebalanceStrategy implements IBacktestStrategy {
  async generateSignal(
    _signalDate: Date,
    config: BacktestConfig,
    _barData: Map<string, DailyBar>,
    _historicalBars: Map<string, DailyBar[]>,
    _prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg = config.strategyConfig as unknown as CustomPoolRebalanceConfig
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
