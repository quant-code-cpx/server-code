import { Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import {
  BacktestConfig,
  DailyBar,
  ScreeningRotationRankField,
  SCREENING_ROTATION_RANK_FIELDS,
  ScreeningRotationStrategyConfig,
  SignalOutput,
} from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

// Supported rankBy fields mapped to DailyBasic columns
const RANK_FIELD_MAP: Record<ScreeningRotationRankField, string> = {
  totalMv: 'total_mv',
  peTtm: 'pe_ttm',
  pb: 'pb',
  dvTtm: 'dv_ttm',
  turnoverRate: 'turnover_rate',
  turnoverRateF: 'turnover_rate_f',
}

export class ScreeningRotationStrategy implements IBacktestStrategy<'SCREENING_ROTATION'> {
  private readonly logger = new Logger(ScreeningRotationStrategy.name)

  async generateSignal(
    signalDate: Date,
    config: BacktestConfig<'SCREENING_ROTATION'>,
    _barData: Map<string, DailyBar>,
    historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg: ScreeningRotationStrategyConfig = config.strategyConfig
    const { rankBy = 'totalMv', rankOrder = 'desc', topN = 20 } = cfg

    if (rankBy && !SCREENING_ROTATION_RANK_FIELDS.includes(rankBy)) {
      this.logger.warn(`ScreeningRotation: unsupported rankBy="${rankBy}", falling back to totalMv`)
    }
    const dbColumn = RANK_FIELD_MAP[rankBy] ?? 'total_mv'
    const orderDir = rankOrder === 'asc' ? 'ASC' : 'DESC'

    const tradeDateStr = signalDate.toISOString().slice(0, 10)
    const universe = [...historicalBars.keys()]
    if (universe.length === 0) return { targets: [] }

    // dbColumn and orderDir are derived from whitelist maps (RANK_FIELD_MAP), safe to interpolate
    if (!dbColumn.match(/^[a-z_]+$/)) {
      return { targets: [] }
    }

    // Point-in-time universe already applies listing age and delisting rules.
    const rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string }>>(
      `SELECT db.ts_code
       FROM stock_daily_valuation_metrics db
       WHERE db.trade_date = $1::date
         AND db.ts_code = ANY($2::text[])
         AND db.${dbColumn} IS NOT NULL
         AND db.${dbColumn} > 0
       ORDER BY db.${dbColumn} ${orderDir}
       LIMIT $3`,
      tradeDateStr,
      universe,
      topN,
    )

    const targets = rows.map((r) => ({ tsCode: r.ts_code }))
    return { targets }
  }
}
