import { PrismaService } from 'src/shared/prisma.service'
import { BacktestConfig, DailyBar, SignalOutput, UNIVERSE_INDEX_CODE } from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

interface FactorRankingConfig {
  factorName: string
  rankOrder: 'asc' | 'desc'
  topN?: number
  minDaysListed?: number
  optionalFilters?: {
    minTotalMv?: number
    minTurnoverRate?: number
    maxPeTtm?: number
  }
}

// Market factors from stock_daily_valuation_metrics
const MARKET_FACTORS: Record<string, string> = {
  pe_ttm: 'pe_ttm',
  pb: 'pb',
  total_mv: 'total_mv',
  turnover_rate_f: 'turnover_rate_f',
  dv_ttm: 'dv_ttm',
  turnover_rate: 'turnover_rate',
}

// Fundamental factors from financial_indicator_snapshots
const FINA_FACTORS: Record<string, string> = {
  roe: 'roe',
  roa: 'roa',
  revenue_yoy: 'revenue_yoy',
  netprofit_yoy: 'netprofit_yoy',
  grossprofit_margin: 'grossprofit_margin',
  netprofit_margin: 'netprofit_margin',
}

export class FactorRankingStrategy implements IBacktestStrategy {
  async generateSignal(
    signalDate: Date,
    config: BacktestConfig,
    _barData: Map<string, DailyBar>,
    _historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg = config.strategyConfig as unknown as FactorRankingConfig
    const { factorName, rankOrder = 'desc', topN = 20, minDaysListed = 60, optionalFilters } = cfg

    const orderDir = rankOrder === 'asc' ? 'ASC' : 'DESC'
    const minListDate = new Date(signalDate.getTime() - minDaysListed * 24 * 60 * 60 * 1000)
    const tradeDateStr = signalDate.toISOString().slice(0, 10)
    const minListDateStr = minListDate.toISOString().slice(0, 10)

    // Determine universe filter
    let universeSql = ''
    const universalParams: unknown[] = [tradeDateStr, minListDateStr, topN]

    if (config.universe !== 'ALL_A' && config.universe !== 'CUSTOM') {
      const indexCode = UNIVERSE_INDEX_CODE[config.universe]
      if (indexCode) {
        universeSql = `AND db.ts_code IN (
          SELECT iw.con_code FROM index_constituent_weights iw
          WHERE iw.index_code = '${indexCode}'
            AND iw.trade_date = (
              SELECT MAX(iw2.trade_date) FROM index_constituent_weights iw2
              WHERE iw2.index_code = '${indexCode}' AND iw2.trade_date <= '${tradeDateStr}'
            )
        )`
      }
    } else if (config.universe === 'CUSTOM' && config.customUniverseTsCodes?.length) {
      const codes = config.customUniverseTsCodes.map((c) => `'${c}'`).join(',')
      universeSql = `AND db.ts_code IN (${codes})`
    }

    // Build optional filters
    let filterSql = ''
    if (optionalFilters?.minTotalMv) filterSql += ` AND db.total_mv >= ${optionalFilters.minTotalMv}`
    if (optionalFilters?.minTurnoverRate) filterSql += ` AND db.turnover_rate_f >= ${optionalFilters.minTurnoverRate}`
    if (optionalFilters?.maxPeTtm) filterSql += ` AND db.pe_ttm <= ${optionalFilters.maxPeTtm} AND db.pe_ttm > 0`

    let rows: Array<{ ts_code: string }> = []

    if (MARKET_FACTORS[factorName]) {
      const col = MARKET_FACTORS[factorName]
      rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string }>>(
        `SELECT db.ts_code
         FROM stock_daily_valuation_metrics db
         INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
         WHERE db.trade_date = $1::date
           AND sb.list_status = 'L'
           AND (sb.list_date IS NULL OR sb.list_date <= $2::date)
           AND db.${col} IS NOT NULL
           ${universeSql}
           ${filterSql}
         ORDER BY db.${col} ${orderDir}
         LIMIT $3`,
        ...universalParams,
      )
    } else if (FINA_FACTORS[factorName]) {
      const col = FINA_FACTORS[factorName]
      rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string }>>(
        `SELECT fi.ts_code
         FROM financial_indicator_snapshots fi
         INNER JOIN stock_basic_profiles sb ON sb.ts_code = fi.ts_code
         INNER JOIN stock_daily_valuation_metrics db ON db.ts_code = fi.ts_code AND db.trade_date = $1::date
         WHERE sb.list_status = 'L'
           AND (sb.list_date IS NULL OR sb.list_date <= $2::date)
           AND fi.${col} IS NOT NULL
           AND fi.end_date = (
             SELECT MAX(fi2.end_date) FROM financial_indicator_snapshots fi2
             WHERE fi2.ts_code = fi.ts_code AND fi2.end_date <= $1::date
           )
           ${universeSql}
           ${filterSql}
         ORDER BY fi.${col} ${orderDir}
         LIMIT $3`,
        ...universalParams,
      )
    }

    const targets = rows.map((r) => ({ tsCode: r.ts_code }))
    return { targets }
  }
}
