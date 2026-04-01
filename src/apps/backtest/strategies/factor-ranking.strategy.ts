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

    let rows: Array<{ ts_code: string }> = []

    if (MARKET_FACTORS[factorName]) {
      // col comes from whitelist-validated MARKET_FACTORS map, safe to interpolate
      const col = MARKET_FACTORS[factorName]

      // Build universe clause for queries against stock_daily_valuation_metrics (alias db)
      let marketUniverseSql = ''
      const marketParams: unknown[] = [tradeDateStr, minListDateStr, topN]
      if (config.universe !== 'ALL_A' && config.universe !== 'CUSTOM') {
        const indexCode = UNIVERSE_INDEX_CODE[config.universe]
        if (indexCode) {
          marketUniverseSql = `AND db.ts_code IN (
            SELECT iw.con_code FROM index_constituent_weights iw
            WHERE iw.index_code = $${marketParams.length + 1}
              AND iw.trade_date = (
                SELECT MAX(iw2.trade_date) FROM index_constituent_weights iw2
                WHERE iw2.index_code = $${marketParams.length + 1} AND iw2.trade_date <= $1
              )
          )`
          marketParams.push(indexCode)
        }
      } else if (config.universe === 'CUSTOM' && config.customUniverseTsCodes?.length) {
        const placeholders = config.customUniverseTsCodes
          .map((_, i) => `$${marketParams.length + i + 1}`)
          .join(',')
        marketUniverseSql = `AND db.ts_code IN (${placeholders})`
        marketParams.push(...config.customUniverseTsCodes)
      }

      // Build optional filters (joined db table for market queries)
      let marketFilterSql = ''
      if (optionalFilters?.minTotalMv !== undefined) {
        marketParams.push(optionalFilters.minTotalMv)
        marketFilterSql += ` AND db.total_mv >= $${marketParams.length}`
      }
      if (optionalFilters?.minTurnoverRate !== undefined) {
        marketParams.push(optionalFilters.minTurnoverRate)
        marketFilterSql += ` AND db.turnover_rate_f >= $${marketParams.length}`
      }
      if (optionalFilters?.maxPeTtm !== undefined) {
        marketParams.push(optionalFilters.maxPeTtm)
        marketFilterSql += ` AND db.pe_ttm <= $${marketParams.length} AND db.pe_ttm > 0`
      }

      rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string }>>(
        `SELECT db.ts_code
         FROM stock_daily_valuation_metrics db
         INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
         WHERE db.trade_date = $1::date
           AND sb.list_status = 'L'
           AND (sb.list_date IS NULL OR sb.list_date <= $2::date)
           AND db.${col} IS NOT NULL
           ${marketUniverseSql}
           ${marketFilterSql}
         ORDER BY db.${col} ${orderDir}
         LIMIT $3`,
        ...marketParams,
      )
    } else if (FINA_FACTORS[factorName]) {
      const col = FINA_FACTORS[factorName]

      // Build universe clause for queries against financial_indicator_snapshots (alias fi)
      let finaUniverseSql = ''
      const finaParams: unknown[] = [tradeDateStr, minListDateStr, topN]
      if (config.universe !== 'ALL_A' && config.universe !== 'CUSTOM') {
        const indexCode = UNIVERSE_INDEX_CODE[config.universe]
        if (indexCode) {
          finaUniverseSql = `AND fi.ts_code IN (
            SELECT iw.con_code FROM index_constituent_weights iw
            WHERE iw.index_code = $${finaParams.length + 1}
              AND iw.trade_date = (
                SELECT MAX(iw2.trade_date) FROM index_constituent_weights iw2
                WHERE iw2.index_code = $${finaParams.length + 1} AND iw2.trade_date <= $1
              )
          )`
          finaParams.push(indexCode)
        }
      } else if (config.universe === 'CUSTOM' && config.customUniverseTsCodes?.length) {
        const placeholders = config.customUniverseTsCodes
          .map((_, i) => `$${finaParams.length + i + 1}`)
          .join(',')
        finaUniverseSql = `AND fi.ts_code IN (${placeholders})`
        finaParams.push(...config.customUniverseTsCodes)
      }

      // Build optional filters (joined db table for market filters even in fina query)
      let finaFilterSql = ''
      if (optionalFilters?.minTotalMv !== undefined) {
        finaParams.push(optionalFilters.minTotalMv)
        finaFilterSql += ` AND db.total_mv >= $${finaParams.length}`
      }
      if (optionalFilters?.minTurnoverRate !== undefined) {
        finaParams.push(optionalFilters.minTurnoverRate)
        finaFilterSql += ` AND db.turnover_rate_f >= $${finaParams.length}`
      }
      if (optionalFilters?.maxPeTtm !== undefined) {
        finaParams.push(optionalFilters.maxPeTtm)
        finaFilterSql += ` AND db.pe_ttm <= $${finaParams.length} AND db.pe_ttm > 0`
      }

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
           ${finaUniverseSql}
           ${finaFilterSql}
         ORDER BY fi.${col} ${orderDir}
         LIMIT $3`,
        ...finaParams,
      )
    }

    const targets = rows.map((r) => ({ tsCode: r.ts_code }))
    return { targets }
  }
}
