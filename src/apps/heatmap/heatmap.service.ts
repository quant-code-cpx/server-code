import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { HeatmapQueryDto } from './dto/heatmap-query.dto'
import { HeatmapItemDto } from './dto/heatmap-response.dto'

@Injectable()
export class HeatmapService {
  constructor(private readonly prisma: PrismaService) {}

  async getHeatmap(query: HeatmapQueryDto): Promise<HeatmapItemDto[]> {
    const tradeDate = await this.resolveTradeDate(query.trade_date)

    let result: HeatmapItemDto[]
    switch (query.group_by ?? 'industry') {
      case 'industry':
        result = await this.getIndustryHeatmap(tradeDate)
        break
      case 'index':
        result = await this.getIndexHeatmap(tradeDate, query.index_code ?? '000300.SH')
        break
      case 'concept':
        result = await this.getConceptHeatmap(tradeDate)
        break
      default:
        result = await this.getIndustryHeatmap(tradeDate)
    }

    return query.limit ? result.slice(0, query.limit) : result
  }

  // ── 工具方法 ─────────────────────────────────────────────────────────────

  /** 将 YYYYMMDD 字符串解析为数据库 Date，或查询最近交易日 */
  async resolveTradeDate(tradeDateStr?: string): Promise<Date> {
    if (tradeDateStr) {
      // 格式：YYYYMMDD → Date
      const y = parseInt(tradeDateStr.slice(0, 4), 10)
      const m = parseInt(tradeDateStr.slice(4, 6), 10) - 1
      const d = parseInt(tradeDateStr.slice(6, 8), 10)
      return new Date(y, m, d)
    }
    // 查询 stock_daily_prices 中最近有数据的日期
    const latest = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) throw new NotFoundException('暂无日线行情数据')
    return latest.tradeDate
  }

  // ── 行业维度 ──────────────────────────────────────────────────────────────

  /**
   * 按 stock_basic_profiles.industry 分组，返回全市场上市股票的热力图节点。
   *
   * SQL 逻辑（Prisma queryRaw）：
   *   SELECT sb.ts_code, sb.name, sb.industry AS group_name,
   *          d.pct_chg, db.total_mv, d.amount
   *   FROM stock_basic_profiles sb
   *   JOIN stock_daily_prices d
   *        ON sb.ts_code = d.ts_code AND d.trade_date = :tradeDate
   *   LEFT JOIN stock_daily_valuation_metrics db
   *        ON sb.ts_code = db.ts_code AND db.trade_date = :tradeDate
   *   WHERE sb.list_status = 'L'
   *     AND sb.industry IS NOT NULL
   *   ORDER BY sb.industry, db.total_mv DESC NULLS LAST
   */
  private async getIndustryHeatmap(tradeDate: Date): Promise<HeatmapItemDto[]> {
    const rows = await this.prisma.$queryRaw<RawHeatmapRow[]>`
      SELECT
        sb.ts_code       AS "tsCode",
        sb.name          AS "name",
        sb.industry      AS "groupName",
        d.pct_chg        AS "pctChg",
        db.total_mv      AS "totalMv",
        d.amount         AS "amount"
      FROM stock_basic_profiles sb
      JOIN stock_daily_prices d
           ON sb.ts_code = d.ts_code AND d.trade_date = ${tradeDate}::date
      LEFT JOIN stock_daily_valuation_metrics db
           ON sb.ts_code = db.ts_code AND db.trade_date = ${tradeDate}::date
      WHERE sb.list_status = 'L'
        AND sb.industry IS NOT NULL
      ORDER BY sb.industry, db.total_mv DESC NULLS LAST
    `
    return rows.map((r) => toHeatmapItem(r))
  }

  // ── 指数维度 ──────────────────────────────────────────────────────────────

  /**
   * 按指数成分股分组。从 index_constituent_weights 取最近一期权重数据，
   * 过滤出属于指定指数的成分股，再关联当日行情。
   *
   * 注：index_constituent_weights 按月更新，取距离 tradeDate 最近的权重日期。
   */
  private async getIndexHeatmap(tradeDate: Date, indexCode: string): Promise<HeatmapItemDto[]> {
    // index_constituent_weights.trade_date 存储为 text（YYYYMMDD），需用字符串比较而非 Date 对象
    const tradeDateStr = `${tradeDate.getFullYear()}${String(tradeDate.getMonth() + 1).padStart(2, '0')}${String(tradeDate.getDate()).padStart(2, '0')}`

    // 查询最近的权重日期（text 列使用 text 参数，避免 text <= timestamptz 类型错误）
    const weightDateResult = await this.prisma.$queryRaw<[{ maxDate: string | null }]>`
      SELECT MAX(trade_date) AS "maxDate"
      FROM index_constituent_weights
      WHERE index_code = ${indexCode}
        AND trade_date <= ${tradeDateStr}
    `
    const latestWeightDate = weightDateResult[0]?.maxDate
    if (!latestWeightDate) {
      throw new NotFoundException(`指数 ${indexCode} 暂无成分股权重数据`)
    }

    const rows = await this.prisma.$queryRaw<RawHeatmapRow[]>`
      SELECT
        sb.ts_code                    AS "tsCode",
        sb.name                       AS "name",
        ${indexCode}::text            AS "groupName",
        d.pct_chg                     AS "pctChg",
        db.total_mv                   AS "totalMv",
        d.amount                      AS "amount"
      FROM index_constituent_weights iw
      JOIN stock_basic_profiles sb ON iw.con_code = sb.ts_code
      JOIN stock_daily_prices d
           ON iw.con_code = d.ts_code AND d.trade_date = ${tradeDate}::date
      LEFT JOIN stock_daily_valuation_metrics db
           ON iw.con_code = db.ts_code AND db.trade_date = ${tradeDate}::date
      WHERE iw.index_code = ${indexCode}
        AND iw.trade_date = ${latestWeightDate}
      ORDER BY iw.weight DESC NULLS LAST
    `
    return rows.map((r) => toHeatmapItem(r))
  }

  // ── 概念板块维度（Phase 4 前的临时实现）─────────────────────────────────

  /**
   * Phase 4 前的临时实现：返回板块级别聚合数据（来自 sector_capital_flows）。
   * 每个板块作为一个"虚拟股票节点"返回，无法细化到个股级别。
   * 当 ConceptDetail 数据同步完成后（待办清单 P1 → 同步概念板块映射），
   * 替换为个股级别实现（见 Phase 4）。
   */
  private async getConceptHeatmap(tradeDate: Date): Promise<HeatmapItemDto[]> {
    const rows = await this.prisma.$queryRaw<ConceptBoardRow[]>`
      SELECT
        ts_code    AS "tsCode",
        name       AS "name",
        name       AS "groupName",
        pct_change AS "pctChg",
        NULL::float AS "totalMv",
        NULL::float AS "amount"
      FROM sector_capital_flows
      WHERE content_type = '概念'
        AND trade_date = ${tradeDate}::date
      ORDER BY pct_change DESC NULLS LAST
    `
    return rows.map((r) => ({
      tsCode: r.tsCode,
      name: r.name,
      groupName: r.groupName,
      industry: null,
      pctChg: r.pctChg != null ? Number(r.pctChg) : null,
      totalMv: null,
      amount: null,
    }))
  }
}

// ── 内部类型 ──────────────────────────────────────────────────────────────

interface RawHeatmapRow {
  tsCode: string
  name: string | null
  groupName: string | null
  pctChg: number | null
  totalMv: number | null
  amount: number | null
}

interface ConceptBoardRow extends RawHeatmapRow {}

function toHeatmapItem(r: RawHeatmapRow): HeatmapItemDto {
  return {
    tsCode: r.tsCode,
    name: r.name,
    groupName: r.groupName,
    industry: r.groupName, // 向后兼容
    pctChg: r.pctChg != null ? Number(r.pctChg) : null,
    totalMv: r.totalMv != null ? Number(r.totalMv) : null,
    amount: r.amount != null ? Number(r.amount) : null,
  }
}
