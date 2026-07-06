import { Injectable, Logger } from '@nestjs/common'
import dayjs from 'dayjs'

import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'

import { SyncLogService } from './sync-log.service'

// ─────────────────────────────────────────────────────────────────────────────
// 表配置表：定义各 Tushare 数据表的展示名、分类、是否含 trade_date
// ─────────────────────────────────────────────────────────────────────────────

interface TableConfig {
  tableName: string
  displayName: string
  category: string
  /** 是否有 trade_date 列，用于计算缺失交易日 */
  hasTradeDate: boolean
  /** 对应的同步任务名，用于关联最后同步时间 */
  task?: TushareSyncTaskName
}

const TABLE_OVERVIEW_CONFIG: TableConfig[] = [
  // ── 基础信息 ───────────────────────────────────────────────────────────────
  {
    tableName: 'stock_basic_profiles',
    displayName: 'A股基础信息',
    category: '基础信息',
    hasTradeDate: false,
    task: TushareSyncTaskName.STOCK_BASIC,
  },
  {
    tableName: 'stock_company_profiles',
    displayName: '上市公司信息',
    category: '基础信息',
    hasTradeDate: false,
    task: TushareSyncTaskName.STOCK_COMPANY,
  },
  {
    tableName: 'exchange_trade_calendars',
    displayName: '交易日历',
    category: '基础信息',
    hasTradeDate: false,
    task: TushareSyncTaskName.TRADE_CAL,
  },
  // ── 市场行情 ───────────────────────────────────────────────────────────────
  {
    tableName: 'stock_daily_prices',
    displayName: 'A股日线行情',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.DAILY,
  },
  {
    tableName: 'stock_weekly_prices',
    displayName: 'A股周线行情',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.WEEKLY,
  },
  {
    tableName: 'stock_monthly_prices',
    displayName: 'A股月线行情',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.MONTHLY,
  },
  {
    tableName: 'stock_adjustment_factors',
    displayName: '复权因子',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.ADJ_FACTOR,
  },
  {
    tableName: 'stock_daily_valuation_metrics',
    displayName: '每日行情指标',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.DAILY_BASIC,
  },
  {
    tableName: 'stock_limit_prices',
    displayName: '涨跌停价格',
    category: '市场行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.STK_LIMIT,
  },
  // ── 指数行情 ───────────────────────────────────────────────────────────────
  {
    tableName: 'index_daily_prices',
    displayName: '指数日线行情',
    category: '指数行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.INDEX_DAILY,
  },
  {
    tableName: 'index_daily_valuation_metrics',
    displayName: '指数每日指标',
    category: '指数行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.INDEX_DAILY_BASIC,
  },
  {
    tableName: 'index_constituent_weights',
    displayName: '指数成分权重',
    category: '指数行情',
    hasTradeDate: true,
    task: TushareSyncTaskName.INDEX_WEIGHT,
  },
  // ── 资金流向 ───────────────────────────────────────────────────────────────
  {
    tableName: 'stock_capital_flows',
    displayName: '个股资金流向',
    category: '资金流向',
    hasTradeDate: true,
    task: TushareSyncTaskName.MONEYFLOW,
  },
  {
    tableName: 'sector_capital_flows',
    displayName: '行业资金流向（东财）',
    category: '资金流向',
    hasTradeDate: true,
    task: TushareSyncTaskName.MONEYFLOW_IND_DC,
  },
  {
    tableName: 'market_capital_flows',
    displayName: '市场资金流向（东财）',
    category: '资金流向',
    hasTradeDate: true,
    task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
  },
  {
    tableName: 'moneyflow_hsgt',
    displayName: '沪深港通资金流',
    category: '资金流向',
    hasTradeDate: true,
    task: TushareSyncTaskName.MONEYFLOW_HSGT,
  },
  {
    tableName: 'margin_detail',
    displayName: '融资融券明细',
    category: '资金流向',
    hasTradeDate: true,
    task: TushareSyncTaskName.MARGIN_DETAIL,
  },
  // ── 龙虎榜与大宗 ─────────────────────────────────────────────────────────
  {
    tableName: 'top_list_daily',
    displayName: '龙虎榜日数据',
    category: '龙虎榜与大宗',
    hasTradeDate: true,
    task: TushareSyncTaskName.TOP_LIST,
  },
  {
    tableName: 'top_inst_details',
    displayName: '龙虎榜机构明细',
    category: '龙虎榜与大宗',
    hasTradeDate: true,
    task: TushareSyncTaskName.TOP_INST,
  },
  {
    tableName: 'block_trade_daily',
    displayName: '大宗交易',
    category: '龙虎榜与大宗',
    hasTradeDate: true,
    task: TushareSyncTaskName.BLOCK_TRADE,
  },
  // ── 北向持股 ─────────────────────────────────────────────────────────────
  {
    tableName: 'hk_hold_detail',
    displayName: '沪深股通持股明细',
    category: '北向持股',
    hasTradeDate: true,
    task: TushareSyncTaskName.HK_HOLD,
  },
  // ── 财务数据 ─────────────────────────────────────────────────────────────
  {
    tableName: 'income_statement_reports',
    displayName: '利润表',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.INCOME,
  },
  {
    tableName: 'balance_sheet_reports',
    displayName: '资产负债表',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.BALANCE_SHEET,
  },
  {
    tableName: 'cashflow_reports',
    displayName: '现金流量表',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.CASHFLOW,
  },
  {
    tableName: 'financial_indicator_snapshots',
    displayName: '财务指标',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.FINA_INDICATOR,
  },
  {
    tableName: 'earnings_forecast_reports',
    displayName: '业绩预告',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.FORECAST,
  },
  {
    tableName: 'earnings_express_reports',
    displayName: '业绩快报',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.EXPRESS,
  },
  {
    tableName: 'financial_audit_opinions',
    displayName: '财务审计意见',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.FINA_AUDIT,
  },
  {
    tableName: 'financial_main_business',
    displayName: '主营业务构成',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.FINA_MAINBZ,
  },
  {
    tableName: 'financial_disclosure_schedules',
    displayName: '财报披露计划',
    category: '财务数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.DISCLOSURE_DATE,
  },
  // ── 股东事件 ─────────────────────────────────────────────────────────────
  {
    tableName: 'top_ten_shareholder_snapshots',
    displayName: '十大股东',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.TOP10_HOLDERS,
  },
  {
    tableName: 'stock_dividend_events',
    displayName: '分红送股',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.DIVIDEND,
  },
  {
    tableName: 'stock_holder_number',
    displayName: '股东人数',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.STK_HOLDER_NUMBER,
  },
  {
    tableName: 'stock_holder_trades',
    displayName: '股东增减持',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.STK_HOLDER_TRADE,
  },
  {
    tableName: 'stock_pledge_statistics',
    displayName: '股权质押统计',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.PLEDGE_STAT,
  },
  {
    tableName: 'share_float_schedule',
    displayName: '限售股解禁',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.SHARE_FLOAT,
  },
  {
    tableName: 'stock_repurchase',
    displayName: '股票回购',
    category: '股东事件',
    hasTradeDate: false,
    task: TushareSyncTaskName.REPURCHASE,
  },
  // ── 概念板块 ─────────────────────────────────────────────────────────────
  {
    tableName: 'ths_index_boards',
    displayName: '同花顺板块目录',
    category: '概念板块',
    hasTradeDate: false,
    task: TushareSyncTaskName.THS_INDEX,
  },
  {
    tableName: 'ths_index_members',
    displayName: '同花顺板块成分',
    category: '概念板块',
    hasTradeDate: false,
    task: TushareSyncTaskName.THS_MEMBER,
  },
  {
    tableName: 'sw_industry_classification',
    displayName: '申万行业分类',
    category: '概念板块',
    hasTradeDate: false,
    task: TushareSyncTaskName.INDEX_CLASSIFY,
  },
  {
    tableName: 'sw_industry_members',
    displayName: '申万行业成分',
    category: '概念板块',
    hasTradeDate: false,
    task: TushareSyncTaskName.INDEX_MEMBER_ALL,
  },
  // ── 债券与期权 ────────────────────────────────────────────────────────────
  {
    tableName: 'convertible_bond_basic',
    displayName: '可转债基础信息',
    category: '债券期权',
    hasTradeDate: false,
    task: TushareSyncTaskName.CB_BASIC,
  },
  {
    tableName: 'convertible_bond_daily_prices',
    displayName: '可转债日行情',
    category: '债券期权',
    hasTradeDate: true,
    task: TushareSyncTaskName.CB_DAILY,
  },
  {
    tableName: 'opt_basic',
    displayName: '期权基础信息',
    category: '债券期权',
    hasTradeDate: false,
    task: TushareSyncTaskName.OPT_BASIC,
  },
  {
    tableName: 'opt_daily',
    displayName: '期权日行情',
    category: '债券期权',
    hasTradeDate: true,
    task: TushareSyncTaskName.OPT_DAILY,
  },
  // ── 基金 ─────────────────────────────────────────────────────────────────
  {
    tableName: 'fund_basic',
    displayName: '基金基础信息',
    category: '基金ETF',
    hasTradeDate: false,
    task: TushareSyncTaskName.FUND_BASIC,
  },
  {
    tableName: 'fund_nav',
    displayName: '基金净值',
    category: '基金ETF',
    hasTradeDate: false,
    task: TushareSyncTaskName.FUND_NAV,
  },
  {
    tableName: 'fund_daily',
    displayName: '基金行情',
    category: '基金ETF',
    hasTradeDate: true,
    task: TushareSyncTaskName.FUND_DAILY,
  },
  // ── 宏观数据 ─────────────────────────────────────────────────────────────
  {
    tableName: 'macro_cpi',
    displayName: 'CPI 月度数据',
    category: '宏观数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.CN_CPI,
  },
  {
    tableName: 'macro_ppi',
    displayName: 'PPI 月度数据',
    category: '宏观数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.CN_PPI,
  },
  {
    tableName: 'macro_gdp',
    displayName: 'GDP 季度数据',
    category: '宏观数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.CN_GDP,
  },
  {
    tableName: 'macro_shibor',
    displayName: 'Shibor 利率',
    category: '宏观数据',
    hasTradeDate: false,
    task: TushareSyncTaskName.SHIBOR,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 返回类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncStatusOverviewItem {
  tableName: string
  displayName: string
  rowCount: number
  minDate: string | null
  maxDate: string | null
  /** 去重后有数据的日期数 */
  distinctDates: number | null
  /** 缺失的交易日数（仅 hasTradeDate 表有） */
  missingDays: number | null
  lastSyncAt: Date | null
  lastStatus: string | null
  consecutiveFailures: number
}

export interface SyncStatusCategory {
  name: string
  rowCount: number
  items: SyncStatusOverviewItem[]
}

export interface SyncStatusOverview {
  categories: SyncStatusCategory[]
  totalRows: number
  totalMissingDays: number
  generatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'tushare:sync-status-overview'
const CACHE_TTL = 5 * 60 // 5 分钟

@Injectable()
export class SyncStatusOverviewService {
  private readonly logger = new Logger(SyncStatusOverviewService.name)
  /** 防击穿：当缓存未命中时，只允许一个并发 buildOverview() 在飞 */
  private _buildOverviewFlight: Promise<SyncStatusOverview> | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly syncLogService: SyncLogService,
  ) {}

  async getOverview(): Promise<SyncStatusOverview> {
    return this.cache.rememberJson<SyncStatusOverview>({
      namespace: 'tushare-sync-overview',
      key: CACHE_KEY,
      ttlSeconds: CACHE_TTL,
      loader: () => {
        if (!this._buildOverviewFlight) {
          this._buildOverviewFlight = this.buildOverview().finally(() => {
            this._buildOverviewFlight = null
          })
        }
        return this._buildOverviewFlight
      },
    })
  }

  /** 强制刷新缓存并重新计算 */
  async refresh(): Promise<SyncStatusOverview> {
    const result = await this.buildOverview()
    return result
  }

  // ─── 构建总览 ─────────────────────────────────────────────────────────────

  private async buildOverview(): Promise<SyncStatusOverview> {
    // 1. 并行预取：同步日志摘要 + 全表行数估算 + 日期 distinct 估算 + 全部 SSE 交易日
    const [logSummaries, catalogMap, dateDistinctMap, tradingDaySet] = await Promise.all([
      this.syncLogService.summarizeLogs(),
      this.fetchCatalogStats(),
      this.fetchDateDistinctStats(),
      this.fetchAllTradingDays(),
    ])
    const logMap = new Map(logSummaries.map((s) => [s.task, s]))

    // 2. 并行查询所有表的统计信息（MIN/MAX 走索引，日期数量取 pg_stats 估算）
    const tableStats = await Promise.all(
      TABLE_OVERVIEW_CONFIG.map((cfg) =>
        this.queryTableStats(cfg, logMap, catalogMap, dateDistinctMap, tradingDaySet),
      ),
    )

    // 3. 按 category 分组
    const categoryMap = new Map<string, SyncStatusOverviewItem[]>()
    for (const item of tableStats) {
      const existing = categoryMap.get(item.category) ?? []
      existing.push(item)
      categoryMap.set(item.category, existing)
    }

    // 4. 保持配置顺序：提取 category 顺序
    const categoryOrder: string[] = []
    for (const cfg of TABLE_OVERVIEW_CONFIG) {
      if (!categoryOrder.includes(cfg.category)) categoryOrder.push(cfg.category)
    }

    const categories: SyncStatusCategory[] = categoryOrder.map((name) => {
      const items = categoryMap.get(name) ?? []
      return {
        name,
        rowCount: items.reduce((s, i) => s + i.rowCount, 0),
        items,
      }
    })

    const totalRows = categories.reduce((s, c) => s + c.rowCount, 0)
    const totalMissingDays = tableStats.reduce((s, i) => s + (i.missingDays ?? 0), 0)

    return {
      categories,
      totalRows,
      totalMissingDays,
      generatedAt: new Date().toISOString(),
    }
  }

  // ─── 预取：全表行数估算（1 次 pg_class 批量查询，毫秒级） ─────────────────

  private async fetchCatalogStats(): Promise<Map<string, number>> {
    const inList = TABLE_OVERVIEW_CONFIG.map((c) => `'${c.tableName}'`).join(', ')
    const rows = await this.prisma.$queryRawUnsafe<{ table_name: string; approx_rows: bigint }[]>(`
      SELECT c.relname AS table_name,
             GREATEST(c.reltuples, 0)::bigint AS approx_rows
      FROM pg_class c
      WHERE c.relname IN (${inList})
        AND c.relkind = 'r'
        AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `)
    return new Map(rows.map((r) => [r.table_name, Number(r.approx_rows)]))
  }

  // ─── 预取：trade_date distinct 估算（1 次 pg_stats 查询）─────────────────

  private async fetchDateDistinctStats(): Promise<Map<string, number>> {
    const tableNames = TABLE_OVERVIEW_CONFIG.filter((c) => c.hasTradeDate).map((c) => c.tableName)
    if (tableNames.length === 0) return new Map()

    const inList = tableNames.map((tableName) => `'${tableName}'`).join(', ')
    const rows = await this.prisma.$queryRawUnsafe<{ table_name: string; distinct_dates: number | string | null }[]>(`
      SELECT s.tablename AS table_name,
             CASE
               WHEN s.n_distinct >= 0 THEN s.n_distinct
               ELSE ABS(s.n_distinct) * GREATEST(c.reltuples, 0)
             END AS distinct_dates
      FROM pg_stats s
      JOIN pg_class c
        ON c.relname = s.tablename
       AND c.relkind = 'r'
       AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      WHERE s.schemaname = 'public'
        AND s.attname = 'trade_date'
        AND s.tablename IN (${inList})
    `)

    return new Map(
      rows
        .map((r) => [r.table_name, Number(r.distinct_dates ?? 0)] as const)
        .filter(([, distinctDates]) => Number.isFinite(distinctDates) && distinctDates >= 0),
    )
  }

  // ─── 预取：全部 SSE 交易日（1 次查询，供 JS 内计算缺失天数） ──────────────

  private async fetchAllTradingDays(): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<{ d: string }[]>`
      SELECT to_char(cal_date, 'YYYY-MM-DD') AS d
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
    `
    return new Set(rows.map((r) => r.d))
  }

  // ─── 单表统计查询 ─────────────────────────────────────────────────────────

  private async queryTableStats(
    cfg: TableConfig,
    logMap: Map<string, { lastSyncAt: Date | null; lastStatus: string | null; consecutiveFailures: number }>,
    catalogMap: Map<string, number>,
    dateDistinctMap: Map<string, number>,
    tradingDaySet: Set<string>,
  ): Promise<SyncStatusOverviewItem & { category: string }> {
    const logEntry = cfg.task ? logMap.get(cfg.task) : null

    try {
      if (cfg.hasTradeDate) {
        return await this.queryTimeSeries(cfg, logEntry, catalogMap, dateDistinctMap, tradingDaySet)
      } else {
        return await this.querySimpleCount(cfg, logEntry, catalogMap)
      }
    } catch (error) {
      this.logger.warn(`查询表 ${cfg.tableName} 统计信息失败: ${(error as Error).message}`)
      return this.buildErrorItem(cfg, logEntry)
    }
  }

  /** 查询有 trade_date 列的时序表（含缺失天数）
   *  - 行数：取 pg_class.reltuples 估算值，避免全表 COUNT
   *  - min/max date：索引扫描
   *  - distinct dates：取 pg_stats 估算，避免每张大表 recursive skip-scan
   *  - missing days：JS 内从预取的 tradingDaySet 计算，无额外 DB 查询
   */
  private async queryTimeSeries(
    cfg: TableConfig,
    logEntry: { lastSyncAt: Date | null; lastStatus: string | null; consecutiveFailures: number } | null | undefined,
    catalogMap: Map<string, number>,
    dateDistinctMap: Map<string, number>,
    tradingDaySet: Set<string>,
  ): Promise<SyncStatusOverviewItem & { category: string }> {
    const approxRows = catalogMap.get(cfg.tableName) ?? 0
    const estimatedDistinctDates = dateDistinctMap.get(cfg.tableName)
    const distinctDates =
      estimatedDistinctDates == null || !Number.isFinite(estimatedDistinctDates)
        ? null
        : Math.max(0, Math.round(estimatedDistinctDates))

    const mmRows = await this.prisma.$queryRawUnsafe<{ min_date: Date | null; max_date: Date | null }[]>(
      `SELECT MIN(trade_date) AS min_date, MAX(trade_date) AS max_date FROM "${cfg.tableName}"`,
    )

    const minDate = mmRows[0]?.min_date ? dayjs(mmRows[0].min_date).format('YYYY-MM-DD') : null
    const maxDate = mmRows[0]?.max_date ? dayjs(mmRows[0].max_date).format('YYYY-MM-DD') : null

    // JS 内计算缺失交易日：遍历预取的全量 SSE 交易日集合
    let missingDays: number | null = null
    if (minDate && maxDate && distinctDates != null && distinctDates > 0 && tradingDaySet.size > 0) {
      let expectedDays = 0
      for (const d of tradingDaySet) {
        if (d >= minDate && d <= maxDate) expectedDays++
      }
      missingDays = Math.max(0, expectedDays - distinctDates)
    }

    return {
      tableName: cfg.tableName,
      displayName: cfg.displayName,
      category: cfg.category,
      rowCount: approxRows,
      minDate,
      maxDate,
      distinctDates,
      missingDays,
      lastSyncAt: logEntry?.lastSyncAt ?? null,
      lastStatus: logEntry?.lastStatus ?? null,
      consecutiveFailures: logEntry?.consecutiveFailures ?? 0,
    }
  }

  /** 查询无 trade_date 列的参考表
   *  - 行数取 pg_class.reltuples 估算值，避免状态面板里出现全表 COUNT
   */
  private async querySimpleCount(
    cfg: TableConfig,
    logEntry: { lastSyncAt: Date | null; lastStatus: string | null; consecutiveFailures: number } | null | undefined,
    catalogMap: Map<string, number>,
  ): Promise<SyncStatusOverviewItem & { category: string }> {
    const approxRows = catalogMap.get(cfg.tableName) ?? 0
    return {
      tableName: cfg.tableName,
      displayName: cfg.displayName,
      category: cfg.category,
      rowCount: approxRows,
      minDate: null,
      maxDate: null,
      distinctDates: null,
      missingDays: null,
      lastSyncAt: logEntry?.lastSyncAt ?? null,
      lastStatus: logEntry?.lastStatus ?? null,
      consecutiveFailures: logEntry?.consecutiveFailures ?? 0,
    }
  }

  private buildErrorItem(
    cfg: TableConfig,
    logEntry: { lastSyncAt: Date | null; lastStatus: string | null; consecutiveFailures: number } | null | undefined,
  ): SyncStatusOverviewItem & { category: string } {
    return {
      tableName: cfg.tableName,
      displayName: cfg.displayName,
      category: cfg.category,
      rowCount: -1,
      minDate: null,
      maxDate: null,
      distinctDates: null,
      missingDays: null,
      lastSyncAt: logEntry?.lastSyncAt ?? null,
      lastStatus: logEntry?.lastStatus ?? null,
      consecutiveFailures: logEntry?.consecutiveFailures ?? 0,
    }
  }
}
