import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FinancialApiService } from '../api/financial-api.service'
import {
  mapAllotmentRecord,
  mapDividendRecord,
  mapExpressRecord,
  mapFinaIndicatorRecord,
  mapIncomeRecord,
  mapTop10FloatHoldersRecord,
  mapTop10HoldersRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'

/**
 * FinancialSyncService — 财务数据同步
 *
 * 包含：利润表、业绩快报、分红、财务指标、前十大股东、前十大流通股东
 *
 * 策略：
 * - 业绩快报/分红：按日期区间增量同步
 * - 利润表/财务指标/股东：表为空时按股票重建最近 15 年季度数据
 * - 财务指标/股东：非空表走常规增量同步
 * - 分红初始化：按股票逐只全量拉取（因部分分红 ann_date 为空，无法走日期范围查询）
 */
@Injectable()
export class FinancialSyncService {
  private readonly logger = new Logger(FinancialSyncService.name)
  private readonly recentFinancialRebuildYears = 15

  constructor(
    private readonly api: FinancialApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.INCOME,
        label: '利润表',
        category: 'financial',
        order: 310,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步利润表',
        },
        execute: ({ mode }) => this.syncIncome(mode),
      },
      {
        task: TushareSyncTaskName.EXPRESS,
        label: '业绩快报',
        category: 'financial',
        order: 320,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 10 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步业绩快报',
        },
        execute: ({ mode }) => this.syncExpress(mode),
      },
      {
        task: TushareSyncTaskName.DIVIDEND,
        label: '分红数据',
        category: 'financial',
        order: 330,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 20 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步分红数据',
        },
        execute: ({ mode }) => this.syncDividend(mode),
      },
      {
        task: TushareSyncTaskName.FINA_INDICATOR,
        label: '财务指标',
        category: 'financial',
        order: 340,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 30 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步财务指标',
        },
        execute: ({ mode }) => this.syncFinaIndicator(mode),
      },
      {
        task: TushareSyncTaskName.TOP10_HOLDERS,
        label: '十大股东',
        category: 'financial',
        order: 350,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 40 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步十大股东',
        },
        execute: ({ mode }) => this.syncTop10Holders(mode),
      },
      {
        task: TushareSyncTaskName.TOP10_FLOAT_HOLDERS,
        label: '十大流通股东',
        category: 'financial',
        order: 360,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 50 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步十大流通股东',
        },
        execute: ({ mode }) => this.syncTop10FloatHolders(mode),
      },
    ]
  }

  // ─── 利润表 ────────────────────────────────────────────────────────────────

  async syncIncome(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildIncomeRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('income', '利润表')) {
      await this.rebuildIncomeRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.INCOME)) {
      this.logger.log('[利润表] 今日已同步，跳过')
      return
    }

    this.logger.log('[利润表] 当前自动同步仅在空表时触发近15年重建；现有数据非空，跳过本轮')
  }

  // ─── 利润表全量重建（最近 N 年） ──────────────────────────────────────────

  async rebuildIncomeRecentYears(years = 15): Promise<void> {
    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[利润表] 股票列表为空，跳过重建')
      return
    }

    await (this.helper.prisma as any).income.deleteMany({})
    this.logger.log(`[利润表] 已清空旧数据，开始按股票重建最近 ${years} 年（${stocks.length} 只股票）`)

    let totalRows = 0
    const failedStocks: string[] = []

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getIncomeByTsCode(tsCode)
        const mapped = rows
          .map(mapIncomeRecord)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          const result = await (this.helper.prisma as any).income.createMany({ data: mapped, skipDuplicates: true })
          totalRows += result.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[利润表] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[利润表] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[利润表] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await this.api.getIncomeByTsCode(tsCode)
          const mapped = rows
            .map(mapIncomeRecord)
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await (this.helper.prisma as any).income.createMany({ data: mapped, skipDuplicates: true }))
              .count
          }
          this.logger.log(`[利润表] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[利润表] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.writeSyncLog(
      TushareSyncTaskName.INCOME,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `利润表重建完成，最近 ${years} 年，共 ${totalRows} 条`,
        payload: { years, stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  // ─── 指定财务数据集重建（最近 N 年） ─────────────────────────────────────

  async rebuildExpressRecentYears(years = 15): Promise<void> {
    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[业绩快报] 股票列表为空，跳过重建')
      return
    }

    await this.helper.prisma.express.deleteMany({})
    this.logger.log(`[业绩快报] 已清空旧数据，开始按股票重建最近 ${years} 年`)

    let totalRows = 0
    const failedStocks: string[] = []

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getExpressByTsCode(tsCode)
        const mapped = rows
          .map(mapExpressRecord)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          totalRows += (await this.helper.prisma.express.createMany({ data: mapped, skipDuplicates: true })).count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[业绩快报] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[业绩快报] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[业绩快报] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await this.api.getExpressByTsCode(tsCode)
          const mapped = rows
            .map(mapExpressRecord)
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await this.helper.prisma.express.createMany({ data: mapped, skipDuplicates: true })).count
          }
          this.logger.log(`[业绩快报] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[业绩快报] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.writeSyncLog(
      TushareSyncTaskName.EXPRESS,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `业绩快报重建完成，最近 ${years} 年，共 ${totalRows} 条`,
        payload: { years, stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  async rebuildFinaIndicatorRecentYears(years = 15): Promise<void> {
    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[财务指标] 股票列表为空，跳过重建')
      return
    }

    await this.helper.prisma.finaIndicator.deleteMany({})
    this.logger.log(`[财务指标] 已清空旧数据，开始按股票重建最近 ${years} 年（${stocks.length} 只股票）`)

    let totalRows = 0
    const failedStocks: string[] = []
    const startDate = periods[0]
    const endDate = periods[periods.length - 1]

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getFinaIndicatorByTsCodeAndDateRange(tsCode, startDate, endDate)
        const mapped = rows
          .map(mapFinaIndicatorRecord)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          totalRows += (await this.helper.prisma.finaIndicator.createMany({ data: mapped, skipDuplicates: true })).count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[财务指标] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[财务指标] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[财务指标] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await this.api.getFinaIndicatorByTsCodeAndDateRange(tsCode, startDate, endDate)
          const mapped = rows
            .map(mapFinaIndicatorRecord)
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })

          if (mapped.length > 0) {
            totalRows += (await this.helper.prisma.finaIndicator.createMany({ data: mapped, skipDuplicates: true }))
              .count
          }

          this.logger.log(`[财务指标] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[财务指标] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.writeSyncLog(
      TushareSyncTaskName.FINA_INDICATOR,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财务指标重建完成，最近 ${years} 年，共 ${totalRows} 条`,
        payload: { years, stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  async rebuildTop10HoldersRecentYears(years = 15): Promise<void> {
    await this.rebuildShareholdersRecentYears({
      task: TushareSyncTaskName.TOP10_HOLDERS,
      label: '十大股东',
      years,
      modelName: 'top10Holders',
      fetchRows: (tsCode, startDate, endDate) =>
        this.api.getTop10HoldersByTsCodeAndDateRange(tsCode, startDate, endDate),
      mapRecord: mapTop10HoldersRecord,
    })
  }

  async rebuildTop10FloatHoldersRecentYears(years = 15): Promise<void> {
    await this.rebuildShareholdersRecentYears({
      task: TushareSyncTaskName.TOP10_FLOAT_HOLDERS,
      label: '十大流通股东',
      years,
      modelName: 'top10FloatHolders',
      fetchRows: (tsCode, startDate, endDate) =>
        this.api.getTop10FloatHoldersByTsCodeAndDateRange(tsCode, startDate, endDate),
      mapRecord: mapTop10FloatHoldersRecord,
    })
  }

  // ─── 业绩快报 ──────────────────────────────────────────────────────────────

  async syncExpress(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildExpressRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('express', '业绩快报')) {
      await this.rebuildExpressRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.EXPRESS)) {
      this.logger.log('[业绩快报] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    const latestDate = await this.helper.getLatestDateString('express', 'annDate')
    const rangeEnd = this.helper.getCurrentShanghaiDateString()
    const rangeStart = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(rangeStart, rangeEnd) > 0) {
      this.logger.log(`[业绩快报] 已是最新（最新公告日: ${latestDate}）`)
      return
    }

    this.logger.log(`[业绩快报] 开始同步 ${rangeStart} → ${rangeEnd}`)
    const windows = this.helper.buildMonthlyWindows(rangeStart, rangeEnd)
    let totalRows = 0
    const failed: Array<{ window: string; error: string }> = []

    for (const [i, w] of windows.entries()) {
      try {
        const rows = await this.api.getExpress(w.startDate, w.endDate)
        const mapped = rows.map(mapExpressRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
        totalRows += await this.helper.replaceDateRangeRows(
          'express',
          'annDate',
          this.helper.toDate(w.startDate),
          this.helper.toDate(w.endDate),
          mapped,
        )
        if (i === 0 || (i + 1) % 10 === 0 || i === windows.length - 1) {
          this.logger.log(`[业绩快报] 进度 ${i + 1}/${windows.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[业绩快报] ${w.startDate}~${w.endDate} 失败: ${msg}`)
        failed.push({ window: `${w.startDate}~${w.endDate}`, error: msg })
      }
    }

    this.logger.log(`[业绩快报] 同步完成，${totalRows} 条${failed.length ? `，${failed.length} 个窗口失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.EXPRESS,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `业绩快报同步完成，${totalRows} 条`,
        payload: { rowCount: totalRows, windowCount: windows.length, rangeStart, rangeEnd },
      },
      startedAt,
    )
  }

  // ─── 分红数据 ──────────────────────────────────────────────────────────────

  async syncDividend(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.fullDividendBuild(new Date())
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.DIVIDEND)) {
      this.logger.log('[分红数据] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    const rowCount = await this.helper.prisma.dividend.count()

    if (rowCount === 0) {
      // 表为空 → 按股票逐只全量拉取
      await this.fullDividendBuild(startedAt)
    } else {
      // 增量 → 按 ann_date 日期范围
      await this.incrementalDividendSync(startedAt)
    }
  }

  /** 供 stock.service.ts 按需拉取指定股票的全部分红记录 */
  async syncDividendsForStock(tsCode: string): Promise<number> {
    const rows = await this.api.getDividendByTsCode(tsCode)
    const mapped = rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
    if (!mapped.length) return 0

    await this.helper.prisma.dividend.deleteMany({ where: { tsCode } })
    const result = await this.helper.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
    return result.count
  }

  /** 供 stock.service.ts 按需拉取指定股票的全部配股记录 */
  async syncAllotmentsForStock(tsCode: string): Promise<number> {
    const rows = await this.api.getAllotmentByTsCode(tsCode)
    const mapped = rows.map(mapAllotmentRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))

    await this.helper.prisma.allotment.deleteMany({ where: { tsCode } })
    if (!mapped.length) return 0

    const result = await this.helper.prisma.allotment.createMany({ data: mapped, skipDuplicates: true })
    return result.count
  }

  private async fullDividendBuild(startedAt: Date): Promise<void> {
    const stockCodes = await this.getAllStockCodes()
    if (!stockCodes.length) {
      this.logger.warn('[分红数据] 股票列表为空，无法执行全量构建')
      return
    }

    this.logger.log(`[分红数据] 表为空，开始按股票全量构建（${stockCodes.length} 只）...`)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (const [i, tsCode] of stockCodes.entries()) {
      try {
        const rows = await this.api.getDividendByTsCode(tsCode)
        const mapped = rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
        if (mapped.length > 0) {
          const result = await this.helper.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
          totalRows += result.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stockCodes.length - 1) {
          this.logger.log(`[分红数据] 股票进度 ${i + 1}/${stockCodes.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[分红数据] ${tsCode} 失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    // 兜底重试失败股票
    if (failed.length > 0) {
      this.logger.warn(`[分红数据] ${failed.length} 只股票失败，开始兜底重试...`)
      for (const item of failed) {
        try {
          totalRows += await this.syncDividendsForStock(item.tsCode)
          this.logger.log(`[分红数据] ${item.tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[分红数据] ${item.tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    this.logger.log(`[分红数据] 全量构建完成，${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.DIVIDEND,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `分红全量构建完成，${stockCodes.length} 只股票，${totalRows} 条`,
        payload: { stockCount: stockCodes.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  private async incrementalDividendSync(startedAt: Date): Promise<void> {
    const latestDate = await this.helper.getLatestDateString('dividend', 'annDate')
    const rangeEnd = this.helper.getCurrentShanghaiDateString()
    const rangeStart = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(rangeStart, rangeEnd) > 0) {
      this.logger.log(`[分红数据] 已是最新（最新公告日: ${latestDate}）`)
      return
    }

    this.logger.log(`[分红数据] 增量同步 ${rangeStart} → ${rangeEnd}`)
    const windows = this.helper.buildMonthlyWindows(rangeStart, rangeEnd)
    let totalRows = 0

    for (const [i, w] of windows.entries()) {
      try {
        const rows = await this.api.getDividendByDateRange(w.startDate, w.endDate)
        const mapped = rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
        totalRows += await this.helper.replaceDateRangeRows(
          'dividend',
          'annDate',
          this.helper.toDate(w.startDate),
          this.helper.toDate(w.endDate),
          mapped,
          {},
          { skipDuplicates: true },
        )
        if (i === 0 || (i + 1) % 10 === 0 || i === windows.length - 1) {
          this.logger.log(`[分红数据] 进度 ${i + 1}/${windows.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        this.logger.error(`[分红数据] ${w.startDate}~${w.endDate} 失败: ${(error as Error).message}`)
      }
    }

    this.logger.log(`[分红数据] 增量同步完成，${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.DIVIDEND,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `分红增量同步完成，${totalRows} 条`,
        payload: { rowCount: totalRows, rangeStart, rangeEnd },
      },
      startedAt,
    )
  }

  // ─── 财务指标 ──────────────────────────────────────────────────────────────

  async syncFinaIndicator(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildFinaIndicatorRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('finaIndicator', '财务指标')) {
      await this.rebuildFinaIndicatorRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.FINA_INDICATOR)) {
      this.logger.log('[财务指标] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    const latestDate = await this.helper.getLatestDateString('finaIndicator', 'endDate')
    const periods = this.helper.buildPendingQuarterPeriods(latestDate)

    if (!periods.length) {
      this.logger.log(`[财务指标] 已是最新（最新报告期: ${latestDate}）`)
      return
    }

    // 获取全部上市股票
    const stocks = await this.helper.prisma.stockBasic.findMany({
      where: { listStatus: 'L' },
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
    })

    if (!stocks.length) {
      this.logger.warn('[财务指标] 未找到上市股票，跳过')
      return
    }

    this.logger.log(`[财务指标] 开始同步 ${stocks.length} 只股票 × ${periods.length} 个报告期`)
    let totalRows = 0
    let totalSuccess = 0
    let totalFailed = 0

    for (const [si, stock] of stocks.entries()) {
      const failedPeriods: string[] = []

      for (const [pi, period] of periods.entries()) {
        try {
          const rows = await this.api.getFinaIndicatorByTsCodeAndPeriod(stock.tsCode, period)
          const mapped = rows.map(mapFinaIndicatorRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            // 幂等：先删除该股票该报告期旧数据，再插入
            await this.helper.prisma.finaIndicator.deleteMany({
              where: {
                tsCode: stock.tsCode,
                endDate: this.helper.toDate(period),
              },
            })
            const result = await this.helper.prisma.finaIndicator.createMany({ data: mapped, skipDuplicates: true })
            totalRows += result.count
            totalSuccess++
          }
        } catch (error) {
          const msg = (error as Error).message
          this.logger.warn(`[财务指标] ${stock.tsCode} ${period} 失败: ${msg}`)
          failedPeriods.push(period)
        }
      }

      // 兜底重试失败的报告期
      if (failedPeriods.length > 0) {
        for (const period of failedPeriods) {
          try {
            const rows = await this.api.getFinaIndicatorByTsCodeAndPeriod(stock.tsCode, period)
            const mapped = rows.map(mapFinaIndicatorRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
            if (mapped.length > 0) {
              await this.helper.prisma.finaIndicator.deleteMany({
                where: {
                  tsCode: stock.tsCode,
                  endDate: this.helper.toDate(period),
                },
              })
              const result = await this.helper.prisma.finaIndicator.createMany({ data: mapped, skipDuplicates: true })
              totalRows += result.count
              totalSuccess++
            }
            failedPeriods.splice(failedPeriods.indexOf(period), 1)
          } catch (error) {
            totalFailed++
            this.logger.error(`[财务指标] ${stock.tsCode} ${period} 重试仍失败: ${(error as Error).message}`)
          }
        }
      }

      const progress = Math.round(((si + 1) / stocks.length) * 100)
      this.logger.log(
        `[财务指标] 进度 ${si + 1}/${stocks.length} (${progress}%), 成功 ${totalSuccess}, 失败 ${totalFailed}, 累计 ${totalRows} 条`,
      )
    }

    this.logger.log(
      `[财务指标] 同步完成，${stocks.length} × ${periods.length} = ${totalSuccess + totalFailed} 个查询，${totalRows} 条数据`,
    )
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FINA_INDICATOR,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财务指标同步完成，${stocks.length} × ${periods.length}，成功 ${totalSuccess} 失败 ${totalFailed}，${totalRows} 条`,
        payload: { stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  // ─── 前十大股东 ────────────────────────────────────────────────────────────

  async syncTop10Holders(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildTop10HoldersRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('top10Holders', '十大股东')) {
      await this.rebuildTop10HoldersRecentYears(this.recentFinancialRebuildYears)
      return
    }

    await this.syncShareholdersByPeriod({
      task: TushareSyncTaskName.TOP10_HOLDERS,
      label: '十大股东',
      modelName: 'top10Holders',
      fetchByPeriod: (period) => this.api.getTop10HoldersByPeriod(period),
      mapRecord: mapTop10HoldersRecord,
    })
  }

  // ─── 前十大流通股东 ────────────────────────────────────────────────────────

  async syncTop10FloatHolders(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildTop10FloatHoldersRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('top10FloatHolders', '十大流通股东')) {
      await this.rebuildTop10FloatHoldersRecentYears(this.recentFinancialRebuildYears)
      return
    }

    await this.syncShareholdersByPeriod({
      task: TushareSyncTaskName.TOP10_FLOAT_HOLDERS,
      label: '十大流通股东',
      modelName: 'top10FloatHolders',
      fetchByPeriod: (period) => this.api.getTop10FloatHoldersByPeriod(period),
      mapRecord: mapTop10FloatHoldersRecord,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用按报告期同步模板（股东类）
  // ═══════════════════════════════════════════════════════════════════════════

  private async syncShareholdersByPeriod(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    fetchByPeriod: (period: string) => Promise<Record<string, unknown>[]>
    mapRecord: (r: Record<string, unknown>) => unknown | null
  }): Promise<void> {
    const { task, label, modelName, fetchByPeriod, mapRecord } = opts

    if (await this.helper.isTaskSyncedToday(task)) {
      this.logger.log(`[${label}] 今日已同步，跳过`)
      return
    }

    const startedAt = new Date()
    const latestDate = await this.helper.getLatestDateString(modelName, 'endDate')
    const periods = this.helper.buildPendingQuarterPeriods(latestDate)

    if (!periods.length) {
      this.logger.log(`[${label}] 已是最新（最新报告期: ${latestDate}）`)
      return
    }

    this.logger.log(`[${label}] 开始同步 ${periods.length} 个报告期: ${periods[0]} → ${periods[periods.length - 1]}`)
    let totalRows = 0
    const failed: Array<{ period: string; error: string }> = []

    for (const [i, period] of periods.entries()) {
      try {
        const rows = await fetchByPeriod(period)
        const mapped = rows.map(mapRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))

        const model = (this.helper.prisma as any)[modelName]
        await model.deleteMany({ where: { endDate: this.helper.toDate(period) } })
        if (mapped.length > 0) {
          const result = await model.createMany({ data: mapped, skipDuplicates: true })
          totalRows += result.count
        }

        this.logger.log(`[${label}] 进度 ${i + 1}/${periods.length}，报告期 ${period}，累计 ${totalRows} 条`)
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[${label}] 报告期 ${period} 失败: ${msg}`)
        failed.push({ period, error: msg })
      }
    }

    // 兜底重试
    if (failed.length > 0) {
      this.logger.warn(`[${label}] ${failed.length} 个报告期失败，开始兜底重试...`)
      for (const item of failed) {
        try {
          const rows = await fetchByPeriod(item.period)
          const mapped = rows.map(mapRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
          const model = (this.helper.prisma as any)[modelName]
          await model.deleteMany({ where: { endDate: this.helper.toDate(item.period) } })
          if (mapped.length > 0) {
            await model.createMany({ data: mapped, skipDuplicates: true })
          }
          this.logger.log(`[${label}] 报告期 ${item.period} 重试成功`)
        } catch (error) {
          this.logger.error(`[${label}] 报告期 ${item.period} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    this.logger.log(`[${label}] 同步完成，${periods.length} 个报告期，${totalRows} 条`)
    await this.helper.writeSyncLog(
      task,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${label}同步完成，${periods.length} 个报告期，${totalRows} 条`,
        payload: { periodCount: periods.length, rowCount: totalRows, periods },
      },
      startedAt,
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 工具
  // ═══════════════════════════════════════════════════════════════════════════

  private async getAllStockCodes(): Promise<string[]> {
    const stocks = await this.helper.prisma.stockBasic.findMany({
      select: { tsCode: true },
      where: { exchange: { in: ['SSE', 'SZSE', 'BSE'] } },
      orderBy: { tsCode: 'asc' },
    })
    return stocks.map((s) => s.tsCode)
  }

  private async shouldRebuildRecentYears(modelName: string, label: string): Promise<boolean> {
    const rowCount = await (this.helper.prisma as any)[modelName].count()
    if (rowCount > 0) {
      return false
    }

    this.logger.log(`[${label}] 检测到空表，将按股票重建最近 ${this.recentFinancialRebuildYears} 年季度数据`)
    return true
  }

  private async rebuildShareholdersRecentYears(opts: {
    task: TushareSyncTaskName
    label: string
    years: number
    modelName: 'top10Holders' | 'top10FloatHolders'
    fetchRows: (tsCode: string, startDate: string, endDate: string) => Promise<Record<string, unknown>[]>
    mapRecord: (record: Record<string, unknown>) => unknown | null
  }): Promise<void> {
    const { task, label, years, modelName, fetchRows, mapRecord } = opts
    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn(`[${label}] 股票列表为空，跳过重建`)
      return
    }

    const model = (this.helper.prisma as any)[modelName]
    await model.deleteMany({})
    this.logger.log(`[${label}] 已清空旧数据，开始按股票重建最近 ${years} 年`)

    let totalRows = 0
    const failedStocks: string[] = []
    const startDate = periods[0]
    const endDate = periods[periods.length - 1]

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await fetchRows(tsCode, startDate, endDate)
        const mapped = rows
          .map(mapRecord)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row: any) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          totalRows += (await model.createMany({ data: mapped, skipDuplicates: true })).count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[${label}] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[${label}] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await fetchRows(tsCode, startDate, endDate)
          const mapped = rows
            .map(mapRecord)
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row: any) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await model.createMany({ data: mapped, skipDuplicates: true })).count
          }
          this.logger.log(`[${label}] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[${label}] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.writeSyncLog(
      task,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${label}重建完成，最近 ${years} 年，共 ${totalRows} 条`,
        payload: { years, stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  private normalizeDateKey(value: string | Date | null | undefined): string | null {
    if (!value) return null
    return value instanceof Date ? this.helper.formatDate(value) : value
  }
}
