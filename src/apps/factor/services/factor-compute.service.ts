import { Injectable, NotFoundException } from '@nestjs/common'
import { FactorSourceType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorValuesQueryDto } from '../dto/factor-values.dto'
import { FactorFieldMapping, FactorValueItem, FactorValueSummary } from '../types/factor.types'

/** Days after IPO to exclude new listings from factor analysis */
const NEW_LISTING_EXCLUSION_DAYS = 60

/** Maps factor name → DB column in daily_basic or related tables */
const FIELD_REF_MAP: Record<string, FactorFieldMapping> = {
  pe_ttm: { table: 'daily_basic', column: 'pe_ttm' },
  pb: { table: 'daily_basic', column: 'pb' },
  ps_ttm: { table: 'daily_basic', column: 'ps_ttm' },
  dv_ttm: { table: 'daily_basic', column: 'dv_ttm' },
  turnover_rate_f: { table: 'daily_basic', column: 'turnover_rate_f' },
  volume_ratio: { table: 'daily_basic', column: 'volume_ratio' },
  roe: { table: 'fina_indicator', column: 'roe', pointInTime: true },
  roe_dt: { table: 'fina_indicator', column: 'dt_roe', pointInTime: true },
  roa: { table: 'fina_indicator', column: 'roa', pointInTime: true },
  gross_profit_margin: { table: 'fina_indicator', column: 'grossprofit_margin', pointInTime: true },
  net_profit_margin: { table: 'fina_indicator', column: 'netprofit_margin', pointInTime: true },
  debt_to_assets: { table: 'fina_indicator', column: 'debt_to_assets', pointInTime: true },
  current_ratio: { table: 'fina_indicator', column: 'current_ratio', pointInTime: true },
  quick_ratio: { table: 'fina_indicator', column: 'quick_ratio', pointInTime: true },
  revenue_yoy: { table: 'fina_indicator', column: 'revenue_yoy', pointInTime: true },
  net_profit_yoy: { table: 'fina_indicator', column: 'netprofit_yoy', pointInTime: true },
  net_mf_amount: { table: 'moneyflow', column: 'net_mf_amount' },
}

/** Maps DERIVED factor name → value expression using daily_basic columns */
const DERIVED_DAILY_BASIC_MAP: Record<string, string> = {
  ep: 'CASE WHEN db.pe_ttm > 0 THEN 1.0 / db.pe_ttm ELSE NULL END',
  bp: 'CASE WHEN db.pb > 0 THEN 1.0 / db.pb ELSE NULL END',
  ln_market_cap: 'CASE WHEN db.total_mv > 0 THEN LN(db.total_mv * 10000) ELSE NULL END',
  ln_circ_mv: 'CASE WHEN db.circ_mv > 0 THEN LN(db.circ_mv * 10000) ELSE NULL END',
}

/** Maps DERIVED factor name → value expression using moneyflow columns */
const DERIVED_MONEYFLOW_MAP: Record<string, string> = {
  main_net_inflow:
    '(mf.buy_lg_amount + mf.buy_elg_amount) - (mf.sell_lg_amount + mf.sell_elg_amount)',
  main_net_inflow_pct:
    'CASE WHEN (mf.buy_sm_amount + mf.buy_md_amount + mf.buy_lg_amount + mf.buy_elg_amount) > 0 THEN ((mf.buy_lg_amount + mf.buy_elg_amount) - (mf.sell_lg_amount + mf.sell_elg_amount)) / (mf.buy_sm_amount + mf.buy_md_amount + mf.buy_lg_amount + mf.buy_elg_amount) ELSE NULL END',
}

/** Raw query row from factor values query */
interface FactorRow {
  ts_code: string
  stock_name: string | null
  industry: string | null
  factor_value: number | null
  percentile: number | null
}

/** Stats row from aggregate query */
interface StatsRow {
  cnt: number | bigint
  missing: number | bigint
  mean_val: number | null
  median_val: number | null
  std_val: number | null
  min_val: number | null
  max_val: number | null
  q25_val: number | null
  q75_val: number | null
}

@Injectable()
export class FactorComputeService {
  constructor(private readonly prisma: PrismaService) {}

  async getFactorValues(dto: FactorValuesQueryDto, factorSourceType: FactorSourceType, factorName: string) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const sortDir = dto.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const offset = (page - 1) * pageSize

    // Determine which query strategy to use
    if (FIELD_REF_MAP[factorName]) {
      return this.getFieldRefValues(dto, factorName, page, pageSize, offset, sortDir)
    }
    if (DERIVED_DAILY_BASIC_MAP[factorName]) {
      return this.getDerivedDailyBasicValues(dto, factorName, page, pageSize, offset, sortDir)
    }
    if (DERIVED_MONEYFLOW_MAP[factorName]) {
      return this.getDerivedMoneyflowValues(dto, factorName, page, pageSize, offset, sortDir)
    }

    throw new NotFoundException(`因子 "${factorName}" 的计算逻辑尚未实现（复杂派生因子需要时序窗口）`)
  }

  private async getFieldRefValues(
    dto: FactorValuesQueryDto,
    factorName: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const mapping = FIELD_REF_MAP[factorName]

    if (mapping.table === 'daily_basic') {
      return this.queryDailyBasicFactor(dto, mapping.column, page, pageSize, offset, sortDir)
    }
    if (mapping.table === 'fina_indicator') {
      return this.queryFinaIndicatorFactor(dto, mapping.column, page, pageSize, offset, sortDir)
    }
    if (mapping.table === 'moneyflow') {
      return this.queryMoneyflowFactor(dto, mapping.column, page, pageSize, offset, sortDir)
    }

    throw new NotFoundException(`不支持的数据表: ${mapping.table}`)
  }

  private async getDerivedDailyBasicValues(
    dto: FactorValuesQueryDto,
    factorName: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const expression = DERIVED_DAILY_BASIC_MAP[factorName]
    const tradeDate = dto.tradeDate
    const exprRaw = Prisma.raw(expression)

    // Build universe JOIN
    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    const sql = Prisma.sql`
      WITH base AS (
        SELECT
          db.ts_code,
          sb.name AS stock_name,
          sb.industry,
          ${exprRaw} AS raw_value
        FROM stock_daily_valuation_metrics db
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp
          ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
        WHERE db.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (
            sb.list_date IS NULL
            OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days')
          )
          AND ${exprRaw} IS NOT NULL
      ),
      ranked AS (
        SELECT
          ts_code,
          stock_name,
          industry,
          raw_value AS factor_value,
          PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
        FROM base
      )
      SELECT ts_code, stock_name, industry, factor_value,
             ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
      FROM ranked
      ORDER BY factor_value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countSql = Prisma.sql`
      SELECT
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE ${exprRaw} IS NULL) AS missing,
        AVG(${exprRaw}) AS mean_val,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${exprRaw}) AS median_val,
        STDDEV_SAMP(${exprRaw}) AS std_val,
        MIN(${exprRaw}) AS min_val,
        MAX(${exprRaw}) AS max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${exprRaw}) AS q25_val,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${exprRaw}) AS q75_val
      FROM stock_daily_valuation_metrics db
      INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
      ${universeJoin}
      LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
      WHERE db.trade_date = ${tradeDate}::date
        AND sb.name NOT LIKE '%ST%'
        AND sb.name NOT LIKE '%退%'
        AND sp.ts_code IS NULL
        AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
    `

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRaw<FactorRow[]>(sql),
      this.prisma.$queryRaw<StatsRow[]>(countSql),
    ])

    return this.buildResponse(dto, factorName, rows, statsRows[0], page, pageSize)
  }

  private async queryDailyBasicFactor(
    dto: FactorValuesQueryDto,
    column: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const tradeDate = dto.tradeDate
    const col = Prisma.raw(column)

    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    const sql = Prisma.sql`
      WITH base AS (
        SELECT
          db.ts_code,
          sb.name AS stock_name,
          sb.industry,
          db.${col} AS raw_value
        FROM stock_daily_valuation_metrics db
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
        WHERE db.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
          AND db.${col} IS NOT NULL
      ),
      ranked AS (
        SELECT ts_code, stock_name, industry, raw_value AS factor_value,
               PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
        FROM base
      )
      SELECT ts_code, stock_name, industry, factor_value,
             ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
      FROM ranked
      ORDER BY factor_value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countSql = Prisma.sql`
      SELECT
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE db.${col} IS NULL) AS missing,
        AVG(db.${col}) AS mean_val,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.${col}) AS median_val,
        STDDEV_SAMP(db.${col}) AS std_val,
        MIN(db.${col}) AS min_val,
        MAX(db.${col}) AS max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY db.${col}) AS q25_val,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY db.${col}) AS q75_val
      FROM stock_daily_valuation_metrics db
      INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
      ${universeJoin}
      LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
      WHERE db.trade_date = ${tradeDate}::date
        AND sb.name NOT LIKE '%ST%'
        AND sb.name NOT LIKE '%退%'
        AND sp.ts_code IS NULL
        AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
    `

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRaw<FactorRow[]>(sql),
      this.prisma.$queryRaw<StatsRow[]>(countSql),
    ])

    return this.buildResponse(dto, column, rows, statsRows[0], page, pageSize)
  }

  private async queryFinaIndicatorFactor(
    dto: FactorValuesQueryDto,
    column: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const tradeDate = dto.tradeDate
    const col = Prisma.raw(column)

    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    // Point-in-time: latest ann_date <= trade_date
    const sql = Prisma.sql`
      WITH pit_fina AS (
        SELECT DISTINCT ON (ts_code)
          ts_code, ${col}
        FROM financial_indicator_snapshots
        WHERE ann_date IS NOT NULL
          AND ann_date <= ${tradeDate}::date
        ORDER BY ts_code, ann_date DESC
      ),
      base AS (
        SELECT
          sb.ts_code,
          sb.name AS stock_name,
          sb.industry,
          fi.${col} AS raw_value
        FROM stock_basic_profiles sb
        INNER JOIN pit_fina fi ON fi.ts_code = sb.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = sb.ts_code AND sp.trade_date = ${tradeDate}
        WHERE sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
          AND fi.${col} IS NOT NULL
      ),
      ranked AS (
        SELECT ts_code, stock_name, industry, raw_value AS factor_value,
               PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
        FROM base
      )
      SELECT ts_code, stock_name, industry, factor_value,
             ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
      FROM ranked
      ORDER BY factor_value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countSql = Prisma.sql`
      WITH pit_fina AS (
        SELECT DISTINCT ON (ts_code)
          ts_code, ${col}
        FROM financial_indicator_snapshots
        WHERE ann_date IS NOT NULL AND ann_date <= ${tradeDate}::date
        ORDER BY ts_code, ann_date DESC
      )
      SELECT
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE fi.${col} IS NULL) AS missing,
        AVG(fi.${col}) AS mean_val,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fi.${col}) AS median_val,
        STDDEV_SAMP(fi.${col}) AS std_val,
        MIN(fi.${col}) AS min_val,
        MAX(fi.${col}) AS max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY fi.${col}) AS q25_val,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fi.${col}) AS q75_val
      FROM stock_basic_profiles sb
      INNER JOIN pit_fina fi ON fi.ts_code = sb.ts_code
      ${universeJoin}
      LEFT JOIN stock_suspend_events sp ON sp.ts_code = sb.ts_code AND sp.trade_date = ${tradeDate}
      WHERE sb.name NOT LIKE '%ST%'
        AND sb.name NOT LIKE '%退%'
        AND sp.ts_code IS NULL
        AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
    `

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRaw<FactorRow[]>(sql),
      this.prisma.$queryRaw<StatsRow[]>(countSql),
    ])

    return this.buildResponse(dto, column, rows, statsRows[0], page, pageSize)
  }

  private async queryMoneyflowFactor(
    dto: FactorValuesQueryDto,
    column: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const tradeDate = dto.tradeDate
    const col = Prisma.raw(column)

    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    const sql = Prisma.sql`
      WITH base AS (
        SELECT
          mf.ts_code,
          sb.name AS stock_name,
          sb.industry,
          mf.${col} AS raw_value
        FROM stock_capital_flows mf
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
        WHERE mf.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
          AND mf.${col} IS NOT NULL
      ),
      ranked AS (
        SELECT ts_code, stock_name, industry, raw_value AS factor_value,
               PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
        FROM base
      )
      SELECT ts_code, stock_name, industry, factor_value,
             ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
      FROM ranked
      ORDER BY factor_value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countSql = Prisma.sql`
      SELECT
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE mf.${col} IS NULL) AS missing,
        AVG(mf.${col}) AS mean_val,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mf.${col}) AS median_val,
        STDDEV_SAMP(mf.${col}) AS std_val,
        MIN(mf.${col}) AS min_val,
        MAX(mf.${col}) AS max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY mf.${col}) AS q25_val,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY mf.${col}) AS q75_val
      FROM stock_capital_flows mf
      INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
      ${universeJoin}
      LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
      WHERE mf.trade_date = ${tradeDate}::date
        AND sb.name NOT LIKE '%ST%'
        AND sb.name NOT LIKE '%退%'
        AND sp.ts_code IS NULL
        AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
    `

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRaw<FactorRow[]>(sql),
      this.prisma.$queryRaw<StatsRow[]>(countSql),
    ])

    return this.buildResponse(dto, column, rows, statsRows[0], page, pageSize)
  }

  private async getDerivedMoneyflowValues(
    dto: FactorValuesQueryDto,
    factorName: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const expression = DERIVED_MONEYFLOW_MAP[factorName]
    const tradeDate = dto.tradeDate

    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    const exprRaw = Prisma.raw(expression)

    const sql = Prisma.sql`
      WITH base AS (
        SELECT
          mf.ts_code,
          sb.name AS stock_name,
          sb.industry,
          ${exprRaw} AS raw_value
        FROM stock_capital_flows mf
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
        WHERE mf.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
          AND ${exprRaw} IS NOT NULL
      ),
      ranked AS (
        SELECT ts_code, stock_name, industry, raw_value AS factor_value,
               PERCENT_RANK() OVER (ORDER BY raw_value) AS percentile
        FROM base
      )
      SELECT ts_code, stock_name, industry, factor_value,
             ROUND(CAST(percentile AS NUMERIC), 4) AS percentile
      FROM ranked
      ORDER BY factor_value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const countSql = Prisma.sql`
      SELECT
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE ${exprRaw} IS NULL) AS missing,
        AVG(${exprRaw}) AS mean_val,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${exprRaw}) AS median_val,
        STDDEV_SAMP(${exprRaw}) AS std_val,
        MIN(${exprRaw}) AS min_val,
        MAX(${exprRaw}) AS max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${exprRaw}) AS q25_val,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${exprRaw}) AS q75_val
      FROM stock_capital_flows mf
      INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
      ${universeJoin}
      LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
      WHERE mf.trade_date = ${tradeDate}::date
        AND sb.name NOT LIKE '%ST%'
        AND sb.name NOT LIKE '%退%'
        AND sp.ts_code IS NULL
        AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
    `

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRaw<FactorRow[]>(sql),
      this.prisma.$queryRaw<StatsRow[]>(countSql),
    ])

    return this.buildResponse(dto, factorName, rows, statsRows[0], page, pageSize)
  }

  private buildResponse(
    dto: FactorValuesQueryDto,
    _factorKey: string,
    rows: FactorRow[],
    stats: StatsRow | undefined,
    page: number,
    pageSize: number,
  ) {
    const items: FactorValueItem[] = rows.map((r) => ({
      tsCode: r.ts_code,
      name: r.stock_name,
      industry: r.industry,
      value: r.factor_value != null ? Number(r.factor_value) : null,
      percentile: r.percentile != null ? Number(r.percentile) : null,
    }))

    const summary: FactorValueSummary = {
      count: stats ? Number(stats.cnt) : 0,
      missing: stats ? Number(stats.missing) : 0,
      mean: stats?.mean_val != null ? Number(stats.mean_val) : null,
      median: stats?.median_val != null ? Number(stats.median_val) : null,
      stdDev: stats?.std_val != null ? Number(stats.std_val) : null,
      min: stats?.min_val != null ? Number(stats.min_val) : null,
      max: stats?.max_val != null ? Number(stats.max_val) : null,
      q25: stats?.q25_val != null ? Number(stats.q25_val) : null,
      q75: stats?.q75_val != null ? Number(stats.q75_val) : null,
    }

    return {
      factorName: dto.factorName,
      tradeDate: dto.tradeDate,
      universe: dto.universe ?? null,
      total: summary.count,
      page,
      pageSize,
      items,
      summary,
    }
  }
}
