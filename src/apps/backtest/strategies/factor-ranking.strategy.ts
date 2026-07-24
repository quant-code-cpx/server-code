import { PrismaService } from 'src/shared/prisma.service'
import {
  BacktestConfig,
  DailyBar,
  FACTOR_RANKING_FACTOR_NAMES,
  FactorRankingFactorName,
  FactorRankingStrategyConfig,
  SignalOutput,
} from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'
import { PointInTimeFinancialService } from '../services/point-in-time-financial.service'

// Market factors from stock_daily_valuation_metrics
const MARKET_FACTORS: Partial<Record<FactorRankingFactorName, string>> = {
  pe_ttm: 'pe_ttm',
  pb: 'pb',
  total_mv: 'total_mv',
  turnover_rate_f: 'turnover_rate_f',
  dv_ttm: 'dv_ttm',
  turnover_rate: 'turnover_rate',
}

// Fundamental factors from financial_indicator_snapshots
const FINA_FACTORS: Partial<Record<FactorRankingFactorName, string>> = {
  roe: 'roe',
  roa: 'roa',
  revenue_yoy: 'revenue_yoy',
  netprofit_yoy: 'netprofit_yoy',
  grossprofit_margin: 'grossprofit_margin',
  netprofit_margin: 'netprofit_margin',
}

export class FactorRankingStrategy implements IBacktestStrategy<'FACTOR_RANKING'> {
  async generateSignal(
    signalDate: Date,
    config: BacktestConfig<'FACTOR_RANKING'>,
    _barData: Map<string, DailyBar>,
    historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg: FactorRankingStrategyConfig = config.strategyConfig
    const { factorName, rankOrder = 'desc', topN = 20, optionalFilters } = cfg

    if (!FACTOR_RANKING_FACTOR_NAMES.includes(factorName)) {
      return { targets: [] }
    }

    const orderDir = rankOrder === 'asc' ? 'ASC' : 'DESC'
    const tradeDateStr = signalDate.toISOString().slice(0, 10)
    const universe = [...historicalBars.keys()]
    if (universe.length === 0) return { targets: [] }

    let rows: Array<{ ts_code: string }> = []

    if (MARKET_FACTORS[factorName]) {
      // col comes from whitelist-validated MARKET_FACTORS map, safe to interpolate
      const col = MARKET_FACTORS[factorName]

      const marketParams: unknown[] = [tradeDateStr, universe, topN]

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
         WHERE db.trade_date = $1::date
           AND db.ts_code = ANY($2::text[])
           AND db.${col} IS NOT NULL
           ${marketFilterSql}
         ORDER BY db.${col} ${orderDir}
         LIMIT $3`,
        ...marketParams,
      )
    } else if (FINA_FACTORS[factorName]) {
      let universe = [...historicalBars.keys()]
      if (optionalFilters && universe.length > 0) {
        const eligibleRows = await prisma.dailyBasic.findMany({
          where: {
            tsCode: { in: universe },
            tradeDate: signalDate,
            ...(optionalFilters.minTotalMv !== undefined ? { totalMv: { gte: optionalFilters.minTotalMv } } : {}),
            ...(optionalFilters.minTurnoverRate !== undefined
              ? { turnoverRateF: { gte: optionalFilters.minTurnoverRate } }
              : {}),
            ...(optionalFilters.maxPeTtm !== undefined ? { peTtm: { gt: 0, lte: optionalFilters.maxPeTtm } } : {}),
          },
          select: { tsCode: true },
        })
        universe = eligibleRows.map((row) => row.tsCode)
      }
      const visibleValues = await new PointInTimeFinancialService(prisma).loadLatestVisibleMetric(
        factorName,
        signalDate,
        universe,
      )
      rows = [...visibleValues.values()]
        .sort((a, b) => (orderDir === 'ASC' ? a.value - b.value : b.value - a.value))
        .slice(0, topN)
        .map((row) => ({ ts_code: row.tsCode }))
    }

    const universeSet = new Set(historicalBars.keys())
    const targets = rows.filter((row) => universeSet.has(row.ts_code)).map((r) => ({ tsCode: r.ts_code }))
    return { targets }
  }
}
