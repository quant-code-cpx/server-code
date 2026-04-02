import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import {
  BacktestConfig,
  DailyBar,
  FactorScreeningRotationStrategyConfig,
  SignalOutput,
} from '../types/backtest-engine.types'
import { IBacktestStrategy } from './backtest-strategy.interface'

/**
 * Factor screening rotation strategy — rebalances at each signal date
 * by running multi-factor screening conditions and selecting top-N stocks.
 *
 * The screening conditions are serialised in strategyConfig as JSON so that
 * the backtest module does NOT depend on FactorModule at the module level.
 */
export class FactorScreeningRotationStrategy implements IBacktestStrategy<'FACTOR_SCREENING_ROTATION'> {
  async generateSignal(
    signalDate: Date,
    config: BacktestConfig<'FACTOR_SCREENING_ROTATION'>,
    _barData: Map<string, DailyBar>,
    _historicalBars: Map<string, DailyBar[]>,
    prisma: PrismaService,
  ): Promise<SignalOutput> {
    const cfg: FactorScreeningRotationStrategyConfig = config.strategyConfig
    const { conditions, sortBy, sortOrder = 'desc', topN = 20, weightMethod = 'equal_weight' } = cfg

    const tradeDateStr = signalDate.toISOString().slice(0, 10)

    // 1. Retrieve factor values for all referenced factors
    const allFactorNames = new Set<string>(conditions.map((c) => c.factorName))
    if (sortBy) allFactorNames.add(sortBy)

    const factorMaps = new Map<string, Map<string, number>>()
    for (const factorName of allFactorNames) {
      const map = await this.loadFactorValues(prisma, factorName, tradeDateStr, config)
      factorMaps.set(factorName, map)
    }

    // 2. Start with all stocks from first condition's factor
    const firstMap = factorMaps.get(conditions[0]?.factorName)
    if (!firstMap || firstMap.size === 0) return { targets: [] }

    let candidateCodes = Array.from(firstMap.keys())

    // 3. Apply each condition
    for (const cond of conditions) {
      const fMap = factorMaps.get(cond.factorName)
      if (!fMap) {
        candidateCodes = []
        break
      }

      if (cond.operator === 'top_pct' || cond.operator === 'bottom_pct') {
        const pct = cond.percent ?? 20
        const vals = candidateCodes
          .map((code) => ({ code, val: fMap.get(code) }))
          .filter((x): x is { code: string; val: number } => x.val != null)
          .sort((a, b) => a.val - b.val)
        const cutN = Math.max(1, Math.ceil(vals.length * (pct / 100)))
        const passSet =
          cond.operator === 'bottom_pct'
            ? new Set(vals.slice(0, cutN).map((v) => v.code))
            : new Set(vals.slice(-cutN).map((v) => v.code))
        candidateCodes = candidateCodes.filter((c) => passSet.has(c))
      } else {
        candidateCodes = candidateCodes.filter((code) => {
          const v = fMap.get(code)
          if (v == null) return false
          switch (cond.operator) {
            case 'gt':
              return v > (cond.value ?? 0)
            case 'gte':
              return v >= (cond.value ?? 0)
            case 'lt':
              return v < (cond.value ?? 0)
            case 'lte':
              return v <= (cond.value ?? 0)
            case 'between':
              return v >= (cond.min ?? -Infinity) && v <= (cond.max ?? Infinity)
            default:
              return true
          }
        })
      }
    }

    // 4. Sort & take topN
    const sortMap = sortBy ? factorMaps.get(sortBy) : factorMaps.get(conditions[0]?.factorName)
    if (sortMap) {
      candidateCodes.sort((a, b) => {
        const va = sortMap.get(a) ?? -Infinity
        const vb = sortMap.get(b) ?? -Infinity
        return sortOrder === 'asc' ? va - vb : vb - va
      })
    }
    candidateCodes = candidateCodes.slice(0, topN)

    // 5. Assign weights
    if (weightMethod === 'factor_weight' && sortMap) {
      const totalAbs = candidateCodes.reduce((s, c) => s + Math.abs(sortMap.get(c) ?? 0), 0)
      if (totalAbs > 0) {
        return {
          targets: candidateCodes.map((code) => ({
            tsCode: code,
            weight: Math.abs(sortMap.get(code) ?? 0) / totalAbs,
          })),
        }
      }
    }

    return { targets: candidateCodes.map((code) => ({ tsCode: code })) }
  }

  // ── Factor value loading (self-contained, no FactorModule dependency) ─────

  private async loadFactorValues(
    prisma: PrismaService,
    factorName: string,
    tradeDateStr: string,
    config: BacktestConfig<'FACTOR_SCREENING_ROTATION'>,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>()

    // First: try precomputed factor snapshots
    const snapshotRows = await prisma.$queryRaw<Array<{ ts_code: string; value: number }>>(Prisma.sql`
      SELECT ts_code, value::float AS value
      FROM factor_snapshots
      WHERE factor_name = ${factorName} AND trade_date = ${tradeDateStr}
    `)

    if (snapshotRows.length > 0) {
      for (const row of snapshotRows) {
        if (row.value != null) map.set(row.ts_code, Number(row.value))
      }
      return map
    }

    // Fallback: direct query from daily_basic / fina tables
    const DAILY_BASIC_COLS: Record<string, string> = {
      pe_ttm: 'pe_ttm',
      pb: 'pb',
      ps_ttm: 'ps_ttm',
      dv_ttm: 'dv_ttm',
      turnover_rate_f: 'turnover_rate_f',
      volume_ratio: 'volume_ratio',
      total_mv: 'total_mv',
      circ_mv: 'circ_mv',
    }

    const col = DAILY_BASIC_COLS[factorName]
    if (col) {
      const rows = await prisma.$queryRawUnsafe<Array<{ ts_code: string; val: number }>>(
        `SELECT db.ts_code, db.${col}::float AS val
         FROM stock_daily_valuation_metrics db
         INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
         WHERE db.trade_date = $1::date
           AND sb.list_status = 'L'
           AND db.${col} IS NOT NULL`,
        tradeDateStr,
      )
      for (const r of rows) if (r.val != null) map.set(r.ts_code, Number(r.val))
    }

    return map
  }
}
