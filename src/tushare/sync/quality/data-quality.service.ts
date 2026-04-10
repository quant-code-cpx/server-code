import { Injectable, Logger, Inject } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { RedisClientType } from 'redis'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { PrismaService } from 'src/shared/prisma.service'
import { SyncHelperService } from '../sync-helper.service'
import { CrossTableCheckService } from './cross-table-check.service'

export interface DataQualityReport {
  dataSet: string
  checkType: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: Record<string, unknown>
}

export interface QualityCheckSummary {
  checkedAt: string
  totalDataSets: number
  counts: { pass: number; warn: number; fail: number }
  failures: Array<{ dataSet: string; checkType: string; message: string }>
  crossTableCounts: { pass: number; warn: number; fail: number }
  autoRepairTriggered: boolean
  repairTaskCount: number
}

interface CompletenessDetails {
  missingDates: string[]
  totalMissing: number
  suspendedCount?: number
}

type DataSetCheckStrategy =
  | 'daily-trade-date'
  | 'weekly-trade-date'
  | 'monthly-trade-date'
  | 'event-trade-date'
  | 'event-date-field'
  | 'financial-report'
  | 'financial-event'
  | 'full-refresh'
  | 'monthly-string-date'

interface DataSetCheckConfig {
  modelName: string
  dateField: string
  dateType: 'datetime' | 'string'
  checkStrategy: DataSetCheckStrategy
  suspendAware?: boolean
  completenessDepthDays?: number | null
}

/**
 * DataQualityService — 数据质量检查服务
 *
 * 提供数据完整性、时效性检查，结果写入 DataQualityCheck 表。
 * 建议在盘后同步完成后（21:00）执行全部检查。
 */
@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name)

  private readonly DATA_SET_CONFIG: Record<string, DataSetCheckConfig> = {
    // ── 日频行情（与交易日历逐日对比）──
    daily: {
      modelName: 'daily',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      suspendAware: true,
      completenessDepthDays: 30,
    },
    dailyBasic: {
      modelName: 'dailyBasic',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      suspendAware: true,
      completenessDepthDays: 30,
    },
    adjFactor: {
      modelName: 'adjFactor',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      suspendAware: true,
      completenessDepthDays: 30,
    },
    indexDaily: {
      modelName: 'indexDaily',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    marginDetail: {
      modelName: 'marginDetail',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    moneyflow: {
      modelName: 'moneyflow',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    moneyflowIndDc: {
      modelName: 'moneyflowIndDc',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    moneyflowMktDc: {
      modelName: 'moneyflowMktDc',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    moneyflowHsgt: {
      modelName: 'moneyflowHsgt',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'daily-trade-date',
      // 不设 completenessDepthDays：沪深港通资金流在港股休市日（如复活节）不产生数据，
      // 无法用 A 股交易日历做完整性检查，只保留时效性检查即可。
    },

    // ── 周频/月频行情 ──
    weekly: {
      modelName: 'weekly',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'weekly-trade-date',
      completenessDepthDays: 90,
    },
    monthly: {
      modelName: 'monthly',
      dateField: 'tradeDate',
      dateType: 'datetime',
      checkStrategy: 'monthly-trade-date',
      completenessDepthDays: 365,
    },

    // ── 事件型（日频 String 日期，不是每天都有事件）──
    stkLimit: {
      modelName: 'stkLimit',
      dateField: 'tradeDate',
      dateType: 'string',
      checkStrategy: 'daily-trade-date',
      completenessDepthDays: 30,
    },
    suspendD: { modelName: 'suspendD', dateField: 'tradeDate', dateType: 'string', checkStrategy: 'event-trade-date' },
    topList: { modelName: 'topList', dateField: 'tradeDate', dateType: 'string', checkStrategy: 'event-trade-date' },
    topInst: { modelName: 'topInst', dateField: 'tradeDate', dateType: 'string', checkStrategy: 'event-trade-date' },
    blockTrade: {
      modelName: 'blockTrade',
      dateField: 'tradeDate',
      dateType: 'string',
      checkStrategy: 'event-trade-date',
    },

    // ── 事件型（非日频）──
    shareFloat: {
      modelName: 'shareFloat',
      dateField: 'floatDate',
      dateType: 'string',
      checkStrategy: 'event-date-field',
    },

    // ── 财务报表（按报告期覆盖率检查）──
    income: {
      modelName: 'income',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-report',
      completenessDepthDays: 365,
    },
    balanceSheet: {
      modelName: 'balanceSheet',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-report',
      completenessDepthDays: 365,
    },
    cashflow: {
      modelName: 'cashflow',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-report',
      completenessDepthDays: 365,
    },
    express: {
      modelName: 'express',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-report',
      completenessDepthDays: 365,
    },
    finaIndicator: {
      modelName: 'finaIndicator',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-report',
      completenessDepthDays: 365,
    },

    // ── 财务事件（有数据但不要求每个报告期都有）──
    dividend: { modelName: 'dividend', dateField: 'endDate', dateType: 'datetime', checkStrategy: 'financial-event' },
    top10Holders: {
      modelName: 'top10Holders',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-event',
    },
    top10FloatHolders: {
      modelName: 'top10FloatHolders',
      dateField: 'endDate',
      dateType: 'datetime',
      checkStrategy: 'financial-event',
    },

    // ── 基础信息（全量刷新）──
    stockBasic: { modelName: 'stockBasic', dateField: 'listDate', dateType: 'datetime', checkStrategy: 'full-refresh' },
    tradeCal: { modelName: 'tradeCal', dateField: 'calDate', dateType: 'datetime', checkStrategy: 'full-refresh' },
    stockCompany: {
      modelName: 'stockCompany',
      dateField: 'annDate',
      dateType: 'datetime',
      checkStrategy: 'full-refresh',
    },

    // ── 因子（月频字符串日期）──
    indexWeight: {
      modelName: 'indexWeight',
      dateField: 'tradeDate',
      dateType: 'string',
      checkStrategy: 'monthly-string-date',
    },
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
    private readonly crossTableCheck: CrossTableCheckService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  /**
   * 检查数据时效性：最新同步日期是否落后于最近完成交易日
   */
  async checkTimeliness(dataSet: string): Promise<DataQualityReport> {
    const config = this.DATA_SET_CONFIG[dataSet]
    if (!config) {
      return { dataSet, checkType: 'timeliness', status: 'warn', message: `未知数据集: ${dataSet}` }
    }

    if (config.checkStrategy === 'full-refresh') {
      return this.checkFullRefreshTimeliness(dataSet, config)
    }

    if (config.checkStrategy === 'financial-event') {
      return this.checkFinancialEventTimeliness(dataSet, config)
    }

    const latestDate = await this.helper.getLatestDateString(config.modelName, config.dateField)
    const latestTradeDateStr = await this.helper.resolveLatestCompletedTradeDate()

    if (!latestDate) {
      return { dataSet, checkType: 'timeliness', status: 'warn', message: `${dataSet} 暂无数据` }
    }
    if (!latestTradeDateStr) {
      return { dataSet, checkType: 'timeliness', status: 'warn', message: '无法获取最近交易日' }
    }

    const isFinancial = config.checkStrategy === 'financial-report'
    const warnThreshold = isFinancial ? 120 : 3
    const failThreshold = isFinancial ? 240 : 7

    const lagDays = this.helper.compareDateString(latestTradeDateStr, latestDate)
    const effectiveLag = isFinancial ? Math.max(0, lagDays) : lagDays

    if (effectiveLag === 0) {
      return { dataSet, checkType: 'timeliness', status: 'pass', message: `${dataSet} 数据已是最新（${latestDate}）` }
    } else if (effectiveLag <= warnThreshold) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'pass',
        message: `${dataSet} 最新日期 ${latestDate}（正常范围内）`,
        details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
      }
    } else if (effectiveLag <= failThreshold) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'warn',
        message: `${dataSet} 落后（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
        details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
      }
    } else {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'fail',
        message: `${dataSet} 严重滞后（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
        details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
      }
    }
  }

  /**
   * 检查数据完整性：按 checkStrategy 路由到对应检查方法
   * 返回 null 表示该策略不做 completeness 检查
   */
  async checkCompleteness(dataSet: string, startDate: string, endDate: string): Promise<DataQualityReport | null> {
    const config = this.DATA_SET_CONFIG[dataSet]
    if (!config) {
      return { dataSet, checkType: 'completeness', status: 'warn', message: `未知数据集: ${dataSet}` }
    }

    switch (config.checkStrategy) {
      case 'daily-trade-date':
        return this.checkDailyCompleteness(dataSet, config, startDate, endDate)
      case 'weekly-trade-date':
        return this.checkPeriodicCompleteness(dataSet, config, startDate, endDate, 'week')
      case 'monthly-trade-date':
        return this.checkPeriodicCompleteness(dataSet, config, startDate, endDate, 'month')
      case 'financial-report':
        return this.checkFinancialReportCoverage(dataSet, config)
      case 'event-trade-date':
      case 'event-date-field':
      case 'financial-event':
      case 'full-refresh':
      case 'monthly-string-date':
        return null
    }
  }

  // ─── Private: 全量刷新型时效性检查 ─────────────────────────────────────────

  private async checkFullRefreshTimeliness(dataSet: string, config: DataSetCheckConfig): Promise<DataQualityReport> {
    const model = (this.prisma as any)[config.modelName]
    const count = await model.count()

    if (count === 0) {
      return { dataSet, checkType: 'timeliness', status: 'fail', message: `${dataSet} 无数据（表为空）` }
    }

    const latest = await model.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } })
    const lastSyncHoursAgo = latest
      ? Math.round((Date.now() - new Date(latest.syncedAt as Date).getTime()) / 3_600_000)
      : null

    if (lastSyncHoursAgo !== null && lastSyncHoursAgo > 48) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'warn',
        message: `${dataSet} 最后同步于 ${lastSyncHoursAgo} 小时前（共 ${count} 条）`,
        details: { rowCount: count, lastSyncHoursAgo },
      }
    }

    return {
      dataSet,
      checkType: 'timeliness',
      status: 'pass',
      message: `${dataSet} 正常（${count} 条）`,
      details: { rowCount: count, lastSyncHoursAgo },
    }
  }

  // ─── Private: 财务事件型时效性检查 ─────────────────────────────────────────

  private async checkFinancialEventTimeliness(dataSet: string, config: DataSetCheckConfig): Promise<DataQualityReport> {
    const model = (this.prisma as any)[config.modelName]
    const count = await model.count()

    if (count === 0) {
      return { dataSet, checkType: 'timeliness', status: 'warn', message: `${dataSet} 暂无数据` }
    }

    return {
      dataSet,
      checkType: 'timeliness',
      status: 'pass',
      message: `${dataSet} 已有数据（${count} 条）`,
      details: { rowCount: count },
    }
  }

  // ─── Private: 日频行情完整性检查（含停牌感知）──────────────────────────────

  private async checkDailyCompleteness(
    dataSet: string,
    config: DataSetCheckConfig,
    startDate: string,
    endDate: string,
  ): Promise<DataQualityReport> {
    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, endDate)
    if (!tradeDates.length) {
      return { dataSet, checkType: 'completeness', status: 'pass', message: `${dataSet} 检查范围内无交易日` }
    }

    const queryDates = config.dateType === 'datetime' ? tradeDates.map((d) => this.helper.toDate(d)) : tradeDates

    const model = (this.prisma as any)[config.modelName]
    const existingRows = await model.findMany({
      select: { [config.dateField]: true },
      where: { [config.dateField]: { in: queryDates } },
      distinct: [config.dateField],
    })

    const existingDates = new Set<string>(
      existingRows.map((r: Record<string, unknown>) => {
        const val = r[config.dateField]
        return val instanceof Date ? this.helper.formatDate(val) : String(val)
      }),
    )

    let suspendedDates: Set<string> | null = null
    if (config.suspendAware) {
      suspendedDates = await this.getSuspendedTradeDates(startDate, endDate)
    }

    const rawMissing = tradeDates.filter((d) => !existingDates.has(d))
    let missingDates: string[]
    let suspendedCount = 0

    if (suspendedDates && suspendedDates.size > 0) {
      missingDates = []
      for (const d of rawMissing) {
        if (suspendedDates.has(d)) suspendedCount++
        else missingDates.push(d)
      }
    } else {
      missingDates = rawMissing
    }

    if (missingDates.length === 0) {
      const suffix = suspendedCount > 0 ? `（另有 ${suspendedCount} 个停牌日正常缺失）` : ''
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} ${startDate}~${endDate} 数据完整（${tradeDates.length} 个交易日）${suffix}`,
        ...(suspendedCount > 0 ? { details: { suspendedCount } } : {}),
      }
    }

    const missingRatio = missingDates.length / tradeDates.length
    return {
      dataSet,
      checkType: 'completeness',
      status: missingRatio > 0.1 ? 'fail' : 'warn',
      message:
        `${dataSet} 缺失 ${missingDates.length}/${tradeDates.length} 个交易日数据` +
        (suspendedCount > 0 ? `（已排除 ${suspendedCount} 个停牌日）` : ''),
      details: {
        missingDates: missingDates.slice(0, 50),
        totalMissing: missingDates.length,
        ...(suspendedCount > 0 && { suspendedCount }),
      },
    }
  }

  // ─── Private: 周频/月频行情完整性检查 ──────────────────────────────────────

  private async checkPeriodicCompleteness(
    dataSet: string,
    config: DataSetCheckConfig,
    startDate: string,
    endDate: string,
    unit: 'week' | 'month',
  ): Promise<DataQualityReport> {
    const expectedDates = await this.helper.getPeriodEndTradeDates(startDate, endDate, unit)
    if (!expectedDates.length) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} 检查范围内无 ${unit} 期末交易日`,
      }
    }

    const queryDates = expectedDates.map((d) => this.helper.toDate(d))
    const model = (this.prisma as any)[config.modelName]
    const existingRows = await model.findMany({
      select: { [config.dateField]: true },
      where: { [config.dateField]: { in: queryDates } },
      distinct: [config.dateField],
    })

    const existingDates = new Set<string>(
      existingRows.map((r: Record<string, unknown>) => this.helper.formatDate(r[config.dateField] as Date)),
    )

    const missingDates = expectedDates.filter((d) => !existingDates.has(d))

    if (missingDates.length === 0) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} ${startDate}~${endDate} 数据完整（${expectedDates.length} 个${unit === 'week' ? '周' : '月'}）`,
      }
    }

    const missingRatio = missingDates.length / expectedDates.length
    return {
      dataSet,
      checkType: 'completeness',
      status: missingRatio > 0.1 ? 'fail' : 'warn',
      message: `${dataSet} 缺失 ${missingDates.length}/${expectedDates.length} 个${unit === 'week' ? '周' : '月'}数据`,
      details: { missingDates: missingDates.slice(0, 50), totalMissing: missingDates.length },
    }
  }

  // ─── Private: 财务报表报告期覆盖率检查 ─────────────────────────────────────

  private async checkFinancialReportCoverage(dataSet: string, config: DataSetCheckConfig): Promise<DataQualityReport> {
    // 只检查距今 120 天以前结束的报告期，避免因年报/季报尚在披露窗口内（如 Q4 报告期截止日 4 月 30 日）
    // 而误报为 fail。取最近 2 年的季度列表，过滤掉不成熟的报告期。
    const today = this.helper.getCurrentShanghaiDateString()
    const cutoff = this.helper.addDays(today, -120) // YYYYMMDD
    const recentPeriods = this.helper.buildRecentQuarterPeriods(2).filter((p) => p <= cutoff)

    if (recentPeriods.length === 0) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} 近期报告期均在披露窗口内，暂不检查`,
      }
    }

    const model = (this.prisma as any)[config.modelName]

    const periodCounts: Array<{ period: string; stockCount: number }> = []
    for (const period of recentPeriods) {
      const count = await model.count({ where: { endDate: this.helper.toDate(period) } })
      periodCounts.push({ period, stockCount: count })
    }

    const totalStocks = await this.prisma.stockBasic.count({ where: { listStatus: 'L' } })
    const emptyPeriods = periodCounts.filter((p) => p.stockCount === 0)
    const sparsePeriods = periodCounts.filter((p) => p.stockCount > 0 && p.stockCount < totalStocks * 0.3)

    if (emptyPeriods.length === 0 && sparsePeriods.length === 0) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} 最近 ${recentPeriods.length} 个报告期覆盖正常`,
        details: { periodCounts, totalStocks },
      }
    }

    const status = emptyPeriods.length > 0 ? 'fail' : 'warn'
    return {
      dataSet,
      checkType: 'completeness',
      status,
      message: `${dataSet} ${emptyPeriods.length} 个报告期无数据，${sparsePeriods.length} 个报告期覆盖率低于 30%`,
      details: {
        emptyPeriods: emptyPeriods.map((p) => p.period),
        sparsePeriods: sparsePeriods.map((p) => ({ period: p.period, stockCount: p.stockCount })),
        totalStocks,
        periodCounts,
      },
    }
  }

  // ─── Private: 停牌日集合（供日频完整性检查排除误报）──────────────────────

  private async getSuspendedTradeDates(startDate: string, endDate: string): Promise<Set<string>> {
    const rows = await this.prisma.suspendD.findMany({
      select: { tradeDate: true },
      where: { tradeDate: { gte: startDate, lte: endDate } },
      distinct: ['tradeDate'],
    })
    return new Set(rows.map((r) => r.tradeDate))
  }

  // ─── 写入检查结果 ────────────────────────────────────────────────────────────

  async writeCheckResult(report: DataQualityReport): Promise<void> {
    await this.prisma.dataQualityCheck.create({
      data: {
        checkDate: new Date(),
        dataSet: report.dataSet,
        checkType: report.checkType,
        status: report.status,
        message: report.message,
        details: (report.details ?? null) as Prisma.InputJsonValue | null,
      },
    })
  }

  // ─── 全量检查入口 ────────────────────────────────────────────────────────────

  /**
   * 运行所有检查，委托给 runAllChecksAndCollect（丢弃返回值）。
   * 保留此方法供不需要报告列表的调用场景使用。
   */
  async runAllChecks(): Promise<void> {
    await this.runAllChecksAndCollect()
  }

  /**
   * 运行所有检查并返回完整报告列表，供 AutoRepairService + WebSocket 广播使用。
   * 使用 Redis 分布式锁防止并发重入（TTL 10 分钟）。
   */
  async runAllChecksAndCollect(): Promise<DataQualityReport[]> {
    const LOCK_KEY = 'data-quality:running'
    const LOCK_TTL = 600

    const acquired = await this.redis.set(LOCK_KEY, '1', { EX: LOCK_TTL, NX: true })
    if (!acquired) {
      this.logger.warn('[数据质量检查] 已有检查任务在运行中，跳过本次')
      return []
    }

    try {
      return await this.doRunAllChecks()
    } finally {
      await this.redis.del(LOCK_KEY)
    }
  }

  private async doRunAllChecks(): Promise<DataQualityReport[]> {
    this.logger.log('[数据质量检查] 开始全量检查')

    const datasets = Object.keys(this.DATA_SET_CONFIG)
    const today = this.helper.getCurrentShanghaiDateString()
    const allReports: DataQualityReport[] = []
    let passCount = 0
    let warnCount = 0
    let failCount = 0

    const countStatus = (status: 'pass' | 'warn' | 'fail') => {
      if (status === 'pass') passCount++
      else if (status === 'warn') warnCount++
      else failCount++
    }

    for (const dataSet of datasets) {
      try {
        const config = this.DATA_SET_CONFIG[dataSet]

        const timelinessReport = await this.checkTimeliness(dataSet)
        await this.writeCheckResult(timelinessReport)
        allReports.push(timelinessReport)
        countStatus(timelinessReport.status)

        if (config.completenessDepthDays) {
          const startDate = this.helper.addDays(today, -config.completenessDepthDays)
          const completenessReport = await this.checkCompleteness(dataSet, startDate, today)
          if (completenessReport) {
            await this.writeCheckResult(completenessReport)
            allReports.push(completenessReport)
            countStatus(completenessReport.status)
          }
        } else if (config.checkStrategy === 'financial-report') {
          const completenessReport = await this.checkCompleteness(dataSet, '', '')
          if (completenessReport) {
            await this.writeCheckResult(completenessReport)
            allReports.push(completenessReport)
            countStatus(completenessReport.status)
          }
        }
      } catch (error) {
        const msg =
          error instanceof Error
            ? (error.message
                ?.trim()
                .split('\n')
                .find((l) => l.trim()) ?? String(error))
            : String(error)
        this.logger.error(`[数据质量检查] ${dataSet} 检查失败: ${msg}`)
      }
    }

    // 跨表一致性对账（recent 模式）
    try {
      const crossReports = await this.crossTableCheck.runRecentCrossChecks()
      for (const report of crossReports) {
        await this.writeCheckResult(report)
        allReports.push(report)
        countStatus(report.status)
      }
      this.logger.log(`[数据质量检查] 跨表对账完成（${crossReports.length} 项）`)
    } catch (error) {
      this.logger.error(
        `[数据质量检查] 跨表对账失败: ${
          error instanceof Error
            ? (error.message
                ?.trim()
                .split('\n')
                .find((l) => l.trim()) ?? String(error))
            : String(error)
        }`,
      )
    }

    this.logger.log(
      `[数据质量检查] 完成（${datasets.length} 个数据集）：通过 ${passCount}，警告 ${warnCount}，失败 ${failCount}`,
    )
    return allReports
  }

  /**
   * 将最近 N 天的 DataQualityCheck 数据库记录转为 DataQualityReport 列表，
   * 供手动触发补数时使用。
   */
  async getRecentReportsAsQualityReports(days = 1): Promise<DataQualityReport[]> {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const checks = await this.prisma.dataQualityCheck.findMany({
      where: { checkDate: { gte: since } },
      orderBy: { checkDate: 'desc' },
      take: 500,
    })
    return checks.map((c) => ({
      dataSet: c.dataSet,
      checkType: c.checkType,
      status: c.status as 'pass' | 'warn' | 'fail',
      message: c.message,
      details: c.details as Record<string, unknown> | undefined,
    }))
  }

  // ─── 查询接口 ────────────────────────────────────────────────────────────────

  async getRecentChecks(days = 7) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    return this.prisma.dataQualityCheck.findMany({
      where: { checkDate: { gte: since } },
      orderBy: { checkDate: 'desc' },
      take: 200,
    })
  }

  async getDataGaps(dataSet: string) {
    const latest = await this.prisma.dataQualityCheck.findFirst({
      where: { dataSet, checkType: 'completeness', status: { in: ['warn', 'fail'] } },
      orderBy: { checkDate: 'desc' },
    })
    if (!latest) return { dataSet, gaps: [] }
    const details = latest.details as unknown as CompletenessDetails | null
    return { dataSet, gaps: details?.missingDates ?? [], total: details?.totalMissing ?? 0 }
  }

  async getValidationLogs(opts: { task?: string; limit?: number }) {
    return this.prisma.dataValidationLog.findMany({
      where: opts.task ? { task: opts.task } : undefined,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 100,
    })
  }
}
