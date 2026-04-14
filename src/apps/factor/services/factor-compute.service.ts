import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { FactorSourceType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorValuesQueryDto } from '../dto/factor-values.dto'
import { FactorFieldMapping, FactorValueItem, FactorValueSummary } from '../types/factor.types'
import { FactorExpressionService } from './factor-expression.service'

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
  ep: 'CASE WHEN db.pe_ttm != 0 THEN 1.0 / db.pe_ttm ELSE NULL END',
  bp: 'CASE WHEN db.pb != 0 THEN 1.0 / db.pb ELSE NULL END',
  ln_market_cap: 'CASE WHEN db.total_mv > 0 THEN LN(db.total_mv * 10000) ELSE NULL END',
  ln_circ_mv: 'CASE WHEN db.circ_mv > 0 THEN LN(db.circ_mv * 10000) ELSE NULL END',
}

/** Maps DERIVED factor name → value expression using moneyflow columns */
const DERIVED_MONEYFLOW_MAP: Record<string, string> = {
  main_net_inflow: '(mf.buy_lg_amount + mf.buy_elg_amount) - (mf.sell_lg_amount + mf.sell_elg_amount)',
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
  private readonly logger = new Logger(FactorComputeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly expressionSvc: FactorExpressionService,
  ) {}

  // ── Snapshot-aware public entry points ───────────────────────────────────

  async getFactorValues(dto: FactorValuesQueryDto, factorSourceType: FactorSourceType, factorName: string) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const sortDir = dto.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const offset = (page - 1) * pageSize

    // 1. Try precomputed snapshot first (fast path)
    const snapshotResult = await this.getFactorValuesFromSnapshot(dto, factorName, page, pageSize, offset, sortDir)
    if (snapshotResult !== null) {
      return snapshotResult
    }

    // 2. Fallback to realtime computation
    this.logger.debug(`[${factorName}] ${dto.tradeDate} 无预计算快照，降级实时计算`)

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

    // CUSTOM_SQL: load expression from DB and compile
    if (factorSourceType === FactorSourceType.CUSTOM_SQL) {
      return this.getCustomSqlValues(dto, factorName, page, pageSize, offset, sortDir)
    }

    throw new NotFoundException(`因子 "${factorName}" 的计算逻辑尚未实现（复杂派生因子需要时序窗口）`)
  }

  // ── CUSTOM_SQL factor compute ─────────────────────────────────────────────

  private buildUniverseJoinStr(universe: string | undefined, tradeDate: string, alias: string): string {
    if (!universe) return ''
    // Validate inputs to prevent SQL injection (DTO validates format, but assert here for safety)
    if (!/^\d{6}\.[A-Z]{2}$/.test(universe)) throw new Error('Invalid universe format')
    if (!/^\d{8}$/.test(tradeDate)) throw new Error('Invalid tradeDate format')
    return `INNER JOIN index_constituent_weights iw
  ON iw.con_code = ${alias}.ts_code
  AND iw.index_code = '${universe}'
  AND iw.trade_date = (
    SELECT MAX(trade_date) FROM index_constituent_weights
    WHERE index_code = '${universe}' AND trade_date <= '${tradeDate}'
  )`
  }

  private async getCustomSqlValues(
    dto: FactorValuesQueryDto,
    factorName: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    const factor = await this.prisma.factorDefinition.findUnique({ where: { name: factorName } })
    if (!factor?.expression) throw new NotFoundException(`因子 "${factorName}" 未配置表达式`)

    const tradeDate = dto.tradeDate
    const ast = this.expressionSvc.parse(factor.expression)
    const compiled = this.expressionSvc.compile(ast, tradeDate)
    const universeJoinStr = this.buildUniverseJoinStr(dto.universe, tradeDate, 'db')

    interface FactorRow {
      ts_code: string
      stock_name: string | null
      industry: string | null
      factor_value: number | null
      percentile: number | null
    }
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

    const pagedSql = this.expressionSvc.buildPagedQuery(
      compiled,
      tradeDate,
      universeJoinStr,
      pageSize,
      offset,
      sortDir as 'ASC' | 'DESC',
    )
    const statsSql = this.expressionSvc.buildStatsQuery(compiled, tradeDate, universeJoinStr)

    const [rows, statsRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<FactorRow[]>(pagedSql),
      this.prisma.$queryRawUnsafe<StatsRow[]>(statsSql),
    ])

    const items: FactorValueItem[] = rows.map((r) => ({
      tsCode: r.ts_code,
      name: r.stock_name,
      industry: r.industry,
      value: r.factor_value != null ? Number(r.factor_value) : null,
      percentile: r.percentile != null ? Number(r.percentile) : null,
    }))

    const stats = statsRows[0]
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
      factorName,
      tradeDate,
      universe: dto.universe ?? null,
      total: summary.count - summary.missing,
      page,
      pageSize,
      items,
      summary,
    }
  }

  /**
   * Compute CUSTOM_SQL factor raw values for a date, without pagination.
   * Used by FactorPrecomputeService and FactorCustomService.test.
   */
  async computeCustomSqlForDate(
    expression: string,
    tradeDate: string,
    universe?: string,
  ): Promise<Array<{ tsCode: string; factorValue: number | null }>> {
    interface RawRow {
      ts_code: string
      factor_value: number | null
    }

    const ast = this.expressionSvc.parse(expression)
    const compiled = this.expressionSvc.compile(ast, tradeDate)
    const universeJoinStr = this.buildUniverseJoinStr(universe, tradeDate, 'db')
    const sql = this.expressionSvc.buildRawQuery(compiled, tradeDate, universeJoinStr)

    const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(sql)
    return rows.map((r) => ({
      tsCode: r.ts_code,
      factorValue: r.factor_value != null && Number.isFinite(Number(r.factor_value)) ? Number(r.factor_value) : null,
    }))
  }

  /**
   * Try to serve factor values page from precomputed snapshot table.
   * Returns null if no snapshot data exists for the requested (factorName, tradeDate).
   */
  private async getFactorValuesFromSnapshot(
    dto: FactorValuesQueryDto,
    factorName: string,
    page: number,
    pageSize: number,
    offset: number,
    sortDir: string,
  ) {
    interface SnapshotRow {
      ts_code: string
      stock_name: string | null
      industry: string | null
      factor_value: number | null
      percentile: number | null
    }

    const tradeDate = dto.tradeDate

    const universeJoin = dto.universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = fs.ts_code
          AND iw.index_code = ${dto.universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${dto.universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    // Check if snapshot exists for this (factorName, tradeDate) without universe filter
    const summaryCheck = await this.prisma.factorSnapshotSummary.findUnique({
      where: { factorName_tradeDate: { factorName, tradeDate } },
    })
    if (!summaryCheck) return null

    const rows = await this.prisma.$queryRaw<SnapshotRow[]>(Prisma.sql`
      SELECT
        fs.ts_code,
        sb.name AS stock_name,
        sb.industry,
        fs.value::float AS factor_value,
        fs.percentile::float AS percentile
      FROM factor_snapshots fs
      INNER JOIN stock_basic_profiles sb ON sb.ts_code = fs.ts_code
      ${universeJoin}
      WHERE fs.factor_name = ${factorName}
        AND fs.trade_date = ${tradeDate}
      ORDER BY fs.value ${Prisma.raw(sortDir)} NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `)

    const items: FactorValueItem[] = rows.map((r) => ({
      tsCode: r.ts_code,
      name: r.stock_name,
      industry: r.industry,
      value: r.factor_value != null ? Number(r.factor_value) : null,
      percentile: r.percentile != null ? Number(r.percentile) : null,
    }))

    const summary: FactorValueSummary = {
      count: summaryCheck.count,
      missing: summaryCheck.missing,
      mean: summaryCheck.mean != null ? Number(summaryCheck.mean) : null,
      median: summaryCheck.median != null ? Number(summaryCheck.median) : null,
      stdDev: summaryCheck.stdDev != null ? Number(summaryCheck.stdDev) : null,
      min: summaryCheck.min != null ? Number(summaryCheck.min) : null,
      max: summaryCheck.max != null ? Number(summaryCheck.max) : null,
      q25: summaryCheck.q25 != null ? Number(summaryCheck.q25) : null,
      q75: summaryCheck.q75 != null ? Number(summaryCheck.q75) : null,
    }

    return {
      factorName,
      tradeDate,
      universe: dto.universe ?? null,
      total: summaryCheck.count - summaryCheck.missing,
      page,
      pageSize,
      items,
      summary,
    }
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
      total: summary.count - summary.missing,
      page,
      pageSize,
      items,
      summary,
    }
  }

  /**
   * Get raw factor values for a given date without pagination.
   * Used by analysis services for IC/quantile/correlation computations.
   * Checks precomputed snapshot table first, falls back to realtime.
   */
  async getRawFactorValuesForDate(
    factorName: string,
    tradeDate: string,
    universe?: string,
  ): Promise<Array<{ tsCode: string; factorValue: number | null }>> {
    // 1. Try precomputed snapshot first
    const snapshot = await this.getRawFromSnapshot(factorName, tradeDate, universe)
    if (snapshot !== null) {
      return snapshot
    }

    // 2. Fallback to realtime computation
    this.logger.debug(`[${factorName}] ${tradeDate} 无预计算快照，降级实时计算`)
    return this.computeRealtimeRaw(factorName, tradeDate, universe)
  }

  private async getRawFromSnapshot(
    factorName: string,
    tradeDate: string,
    universe?: string,
  ): Promise<Array<{ tsCode: string; factorValue: number | null }> | null> {
    interface SnapshotRawRow {
      ts_code: string
      factor_value: number | null
    }

    const summaryCheck = await this.prisma.factorSnapshotSummary.findUnique({
      where: { factorName_tradeDate: { factorName, tradeDate } },
    })
    if (!summaryCheck) return null

    const universeJoin = universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = fs.ts_code
          AND iw.index_code = ${universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    const rows = await this.prisma.$queryRaw<SnapshotRawRow[]>(Prisma.sql`
      SELECT fs.ts_code, fs.value::float AS factor_value
      FROM factor_snapshots fs
      ${universeJoin}
      WHERE fs.factor_name = ${factorName}
        AND fs.trade_date = ${tradeDate}
    `)

    return rows.map((r) => ({
      tsCode: r.ts_code,
      factorValue: r.factor_value != null ? Number(r.factor_value) : null,
    }))
  }

  /**
   * Compute realtime raw factor values without snapshot lookup.
   * Used by FactorPrecomputeService to generate new snapshots.
   */
  async computeRealtimeForDate(
    factorName: string,
    tradeDate: string,
  ): Promise<Array<{ tsCode: string; factorValue: number | null }>> {
    return this.computeRealtimeRaw(factorName, tradeDate)
  }

  private async computeRealtimeRaw(
    factorName: string,
    tradeDate: string,
    universe?: string,
  ): Promise<Array<{ tsCode: string; factorValue: number | null }>> {
    interface RawRow {
      ts_code: string
      factor_value: number | null
    }

    const universeJoin = universe
      ? Prisma.sql`INNER JOIN index_constituent_weights iw
          ON iw.con_code = sb.ts_code
          AND iw.index_code = ${universe}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${universe} AND trade_date <= ${tradeDate}
          )`
      : Prisma.sql``

    // FIELD_REF: daily_basic
    if (FIELD_REF_MAP[factorName]?.table === 'daily_basic') {
      const col = Prisma.raw(FIELD_REF_MAP[factorName].column)
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT db.ts_code, db.${col}::float AS factor_value
        FROM stock_daily_valuation_metrics db
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
        WHERE db.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
      `)
      return rows.map((r) => ({
        tsCode: r.ts_code,
        factorValue: r.factor_value != null ? Number(r.factor_value) : null,
      }))
    }

    // FIELD_REF: fina_indicator (PIT)
    if (FIELD_REF_MAP[factorName]?.table === 'fina_indicator') {
      const col = Prisma.raw(FIELD_REF_MAP[factorName].column)
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        WITH pit_fina AS (
          SELECT DISTINCT ON (ts_code) ts_code, ${col}
          FROM financial_indicator_snapshots
          WHERE ann_date IS NOT NULL AND ann_date <= ${tradeDate}::date
          ORDER BY ts_code, ann_date DESC
        )
        SELECT sb.ts_code, fi.${col}::float AS factor_value
        FROM stock_basic_profiles sb
        INNER JOIN pit_fina fi ON fi.ts_code = sb.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = sb.ts_code AND sp.trade_date = ${tradeDate}
        WHERE sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
      `)
      return rows.map((r) => ({
        tsCode: r.ts_code,
        factorValue: r.factor_value != null ? Number(r.factor_value) : null,
      }))
    }

    // FIELD_REF: moneyflow
    if (FIELD_REF_MAP[factorName]?.table === 'moneyflow') {
      const col = Prisma.raw(FIELD_REF_MAP[factorName].column)
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT mf.ts_code, mf.${col}::float AS factor_value
        FROM stock_capital_flows mf
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
        WHERE mf.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
      `)
      return rows.map((r) => ({
        tsCode: r.ts_code,
        factorValue: r.factor_value != null ? Number(r.factor_value) : null,
      }))
    }

    // DERIVED: daily_basic
    if (DERIVED_DAILY_BASIC_MAP[factorName]) {
      const exprRaw = Prisma.raw(DERIVED_DAILY_BASIC_MAP[factorName])
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT db.ts_code, (${exprRaw})::float AS factor_value
        FROM stock_daily_valuation_metrics db
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = db.ts_code AND sp.trade_date = ${tradeDate}
        WHERE db.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
      `)
      return rows.map((r) => ({
        tsCode: r.ts_code,
        factorValue: r.factor_value != null ? Number(r.factor_value) : null,
      }))
    }

    // DERIVED: moneyflow
    if (DERIVED_MONEYFLOW_MAP[factorName]) {
      const exprRaw = Prisma.raw(DERIVED_MONEYFLOW_MAP[factorName])
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT mf.ts_code, (${exprRaw})::float AS factor_value
        FROM stock_capital_flows mf
        INNER JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
        ${universeJoin}
        LEFT JOIN stock_suspend_events sp ON sp.ts_code = mf.ts_code AND sp.trade_date = ${tradeDate}
        WHERE mf.trade_date = ${tradeDate}::date
          AND sb.name NOT LIKE '%ST%'
          AND sb.name NOT LIKE '%退%'
          AND sp.ts_code IS NULL
          AND (sb.list_date IS NULL OR sb.list_date <= (${tradeDate}::date - INTERVAL '60 days'))
      `)
      return rows.map((r) => ({
        tsCode: r.ts_code,
        factorValue: r.factor_value != null ? Number(r.factor_value) : null,
      }))
    }

    // CUSTOM_SQL: expression-based compute (universe join from Prisma.sql not available here, use string)
    const factorDef = await this.prisma.factorDefinition.findUnique({ where: { name: factorName } })
    if (factorDef?.sourceType === FactorSourceType.CUSTOM_SQL && factorDef.expression) {
      return this.computeCustomSqlForDate(factorDef.expression, tradeDate, universe)
    }

    return []
  }
}
