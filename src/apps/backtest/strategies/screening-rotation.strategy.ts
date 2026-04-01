import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, DailyBar, SignalOutput } from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

interface ScreeningRotationConfig {
  rankBy?: string
  rankOrder?: 'asc' | 'desc'
  topN: number
  minDaysListed?: number
}

// Supported rankBy fields mapped to DailyBasic columns
const RANK_FIELD_MAP: Record<string, string> = {
  totalMv: 'total_mv',
  peTtm: 'pe_ttm',
  pb: 'pb',
  dvTtm: 'dv_ttm',
  turnoverRate: 'turnover_rate',
  turnoverRateF: 'turnover_rate_f',
}

export class ScreeningRotationStrategy implements IBacktestStrategy {
  async generateSignal(
    signalDate: Date,
    config: BacktestConfig,
    _barData: Map<string, DailyBar>,
    _historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg = config.strategyConfig as unknown as ScreeningRotationConfig
    const { rankBy = 'totalMv', rankOrder = 'desc', topN = 20, minDaysListed = 60 } = cfg

    const dbColumn = RANK_FIELD_MAP[rankBy] ?? 'total_mv'
    const orderDir = rankOrder === 'asc' ? 'ASC' : 'DESC'

    const minListDate = new Date(signalDate.getTime() - minDaysListed * 24 * 60 * 60 * 1000)
    const tradeDateStr = signalDate.toISOString().slice(0, 10)

    // dbColumn and orderDir are derived from whitelist maps (RANK_FIELD_MAP), safe to interpolate
    if (!dbColumn.match(/^[a-z_]+$/)) {
      return { targets: [] }
    }

    // Query top-N stocks from daily_basic joined with stock_basic_profiles
    const rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string }>>(
      `SELECT db.ts_code
       FROM stock_daily_valuation_metrics db
       INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
       WHERE db.trade_date = $1::date
         AND sb.list_status = 'L'
         AND (sb.list_date IS NULL OR sb.list_date <= $2::date)
         AND db.${dbColumn} IS NOT NULL
         AND db.${dbColumn} > 0
       ORDER BY db.${dbColumn} ${orderDir}
       LIMIT $3`,
      tradeDateStr,
      minListDate.toISOString().slice(0, 10),
      topN,
    )

    const targets = rows.map((r) => ({ tsCode: r.ts_code }))
    return { targets }
  }
}
