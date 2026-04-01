import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, DailyBar, SignalOutput } from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

interface MaCrossSingleConfig {
  tsCode: string
  shortWindow: number
  longWindow: number
  priceField?: 'close'
  allowFlat?: boolean
}

export class MaCrossSingleStrategy implements IBacktestStrategy {
  async generateSignal(
    signalDate: Date,
    config: BacktestConfig,
    _barData: Map<string, DailyBar>,
    historicalBars: Map<string, DailyBar[]>,
    _prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg = config.strategyConfig as unknown as MaCrossSingleConfig
    const { tsCode, shortWindow = 5, longWindow = 20 } = cfg

    const bars = historicalBars.get(tsCode) ?? []
    // Filter bars up to and including signalDate, sorted ascending
    const signalTs = signalDate.getTime()
    const history = bars.filter((b) => b.tradeDate.getTime() <= signalTs && b.close !== null)

    if (history.length < longWindow) {
      return { targets: [] }
    }

    const closes = history.map((b) => b.close as number)
    const shortMa = closes.slice(-shortWindow).reduce((a, b) => a + b, 0) / shortWindow
    const longMa = closes.slice(-longWindow).reduce((a, b) => a + b, 0) / longWindow

    if (shortMa > longMa) {
      return { targets: [{ tsCode, weight: 1.0 }] }
    }

    return { targets: [] }
  }
}
