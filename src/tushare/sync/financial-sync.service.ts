import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TushareApiName, TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'

type AnyModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<Record<string, unknown> | null>
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  createMany(args: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  deleteMany(args?: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  count(args?: Record<string, unknown>): Prisma.PrismaPromise<number>
}

type FinancialReportModelName = 'income' | 'balanceSheet' | 'cashflow' | 'finaIndicator'

interface FinancialReportCandidate {
  tsCode: string
  period: string
}

interface FinancialReportIncrementalOptions {
  task: TushareSyncTaskName
  label: string
  modelName: FinancialReportModelName
  fetchRows: (tsCode: string, period: string) => Promise<Record<string, unknown>[]>
  mapRecord: (record: Record<string, unknown>, collector?: ValidationCollector) => unknown | null | undefined
  lookbackYears?: number
}
import { FinancialApiService } from '../api/financial-api.service'
import {
  mapBalanceSheetRecord,
  mapCashflowRecord,
  mapDisclosureDateRecord,
  mapDividendRecord,
  mapExpressRecord,
  mapFinaAuditRecord,
  mapFinaIndicatorRecord,
  mapFinaMainbzRecord,
  mapForecastRecord,
  mapIncomeRecord,
  mapPledgeStatRecord,
  mapRepurchaseRecord,
  mapStkHolderNumberRecord,
  mapStkHolderTradeRecord,
  mapTop10FloatHoldersRecord,
  mapTop10HoldersRecord,
} from '../tushare-sync.mapper'
import { TushareApiError } from '../api/tushare-client.service'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

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
  private readonly balanceSheetCreateManyChunkSize = 200
  private balanceSheetVipAvailable: boolean | null = null

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
          cron: '0 10 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步利润表',
        },
        execute: ({ mode }) => this.syncIncome(mode),
      },
      {
        task: TushareSyncTaskName.BALANCE_SHEET,
        label: '资产负债表',
        category: 'financial',
        order: 315,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 15 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步资产负债表',
        },
        execute: ({ mode }) => this.syncBalanceSheet(mode),
      },
      {
        task: TushareSyncTaskName.CASHFLOW,
        label: '现金流量表',
        category: 'financial',
        order: 316,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 20 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步现金流量表',
        },
        execute: ({ mode }) => this.syncCashflow(mode),
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
          cron: '0 25 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步财务指标',
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
          cron: '0 30 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步十大股东',
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
          cron: '0 35 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步十大流通股东',
        },
        execute: ({ mode }) => this.syncTop10FloatHolders(mode),
      },
      {
        task: TushareSyncTaskName.FORECAST,
        label: '业绩预告',
        category: 'financial',
        order: 370,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 20 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步业绩预告',
        },
        execute: ({ mode }) => this.syncForecast(mode),
      },
      {
        task: TushareSyncTaskName.STK_HOLDER_NUMBER,
        label: '股东人数',
        category: 'financial',
        order: 380,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 30 20 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步股东人数',
        },
        execute: ({ mode }) => this.syncStkHolderNumber(mode),
      },
      {
        task: TushareSyncTaskName.STK_HOLDER_TRADE,
        label: '股东增减持',
        category: 'financial',
        order: 390,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 15 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日晚间同步股东增减持公告',
        },
        execute: ({ mode }) => this.syncStkHolderTrade(mode),
      },
      {
        task: TushareSyncTaskName.PLEDGE_STAT,
        label: '股权质押统计',
        category: 'financial',
        order: 400,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 30 21 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六夜间同步股权质押统计',
        },
        execute: ({ mode }) => this.syncPledgeStat(mode),
      },
      {
        task: TushareSyncTaskName.FINA_AUDIT,
        label: '财务审计意见',
        category: 'financial',
        order: 410,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 40 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六晚间同步财务审计意见',
        },
        execute: ({ mode }) => this.syncFinaAudit(mode),
      },
      {
        task: TushareSyncTaskName.DISCLOSURE_DATE,
        label: '财报披露计划',
        category: 'financial',
        order: 420,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 30 8 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一早间同步财报披露计划',
        },
        execute: ({ mode }) => this.syncDisclosureDate(mode),
      },
      {
        task: TushareSyncTaskName.FINA_MAINBZ,
        label: '主营业务构成',
        category: 'financial',
        order: 430,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 45 22 * * 6',
          timeZone: this.helper.syncTimeZone,
          description: '每周六深夜同步主营业务构成',
        },
        execute: ({ mode }) => this.syncFinaMainbz(mode),
      },
      {
        task: TushareSyncTaskName.REPURCHASE,
        label: '股票回购',
        category: 'financial',
        order: 440,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 35 21 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日盘后同步回购公告',
        },
        execute: ({ mode }) => this.syncRepurchase(mode),
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

    await this.syncFinancialReportsByDisclosure({
      task: TushareSyncTaskName.INCOME,
      label: '利润表',
      modelName: 'income',
      fetchRows: (tsCode, period) => this.api.getIncomeByTsCodeAndPeriod(tsCode, period),
      mapRecord: mapIncomeRecord,
    })
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

    await this.helper.prisma.income.deleteMany({})
    this.logger.log(`[利润表] 已清空旧数据，开始按股票重建最近 ${years} 年（${stocks.length} 只股票）`)

    let totalRows = 0
    const failedStocks: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.INCOME)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getIncomeByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapIncomeRecord(r, collector))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          const result = await this.helper.prisma.income.createMany({ data: mapped, skipDuplicates: true })
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
            .map((r) => mapIncomeRecord(r, collector))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await this.helper.prisma.income.createMany({ data: mapped, skipDuplicates: true })).count
          }
          this.logger.log(`[利润表] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[利润表] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.flushValidationLogs(collector)
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

  // ─── 资产负债表 ────────────────────────────────────────────────────────────

  async syncBalanceSheet(mode: TushareSyncMode = 'incremental'): Promise<void> {
    this.balanceSheetVipAvailable = null

    if (mode === 'full') {
      await this.rebuildBalanceSheetRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('balanceSheet', '资产负债表')) {
      await this.rebuildBalanceSheetRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.BALANCE_SHEET)) {
      this.logger.log('[资产负债表] 今日已同步，跳过')
      return
    }

    await this.syncBalanceSheetByDisclosure()
  }

  async rebuildBalanceSheetRecentYears(years = 15): Promise<void> {
    this.balanceSheetVipAvailable = null

    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)

    const vipCollector = new ValidationCollector(TushareSyncTaskName.BALANCE_SHEET)
    const vipRowCount = await this.rebuildBalanceSheetRecentYearsByVip(periods, vipCollector, years)
    if (vipRowCount !== null) {
      await this.helper.flushValidationLogs(vipCollector)
      await this.helper.writeSyncLog(
        TushareSyncTaskName.BALANCE_SHEET,
        {
          status: TushareSyncExecutionStatus.SUCCESS,
          message: `资产负债表重建完成，最近 ${years} 年，共 ${vipRowCount} 条（balancesheet_vip）`,
          payload: {
            years,
            periodCount: periods.length,
            rowCount: vipRowCount,
            sourceApi: TushareApiName.BALANCE_SHEET_VIP,
          },
        },
        startedAt,
      )
      return
    }

    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[资产负债表] 股票列表为空，跳过重建')
      return
    }

    await this.helper.prisma.balanceSheet.deleteMany({})
    this.logger.log(`[资产负债表] balancesheet_vip 不可用，降级按股票重建最近 ${years} 年（${stocks.length} 只股票）`)

    let totalRows = 0
    const failedStocks: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.BALANCE_SHEET)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getBalanceSheetByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapBalanceSheetRecord(r, collector))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          const result = await this.helper.prisma.balanceSheet.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += result.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[资产负债表] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[资产负债表] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[资产负债表] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await this.api.getBalanceSheetByTsCode(tsCode)
          const mapped = rows
            .map((r) => mapBalanceSheetRecord(r, collector))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await this.helper.prisma.balanceSheet.createMany({ data: mapped, skipDuplicates: true }))
              .count
          }
          this.logger.log(`[资产负债表] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[资产负债表] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.BALANCE_SHEET,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `资产负债表重建完成，最近 ${years} 年，共 ${totalRows} 条`,
        payload: { years, stockCount: stocks.length, periodCount: periods.length, rowCount: totalRows },
      },
      startedAt,
    )
  }

  private async rebuildBalanceSheetRecentYearsByVip(
    periods: string[],
    collector: ValidationCollector,
    years: number,
  ): Promise<number | null> {
    let totalRows = 0
    let tableCleared = false

    for (const [i, period] of periods.entries()) {
      const rows = await this.tryGetBalanceSheetRowsByPeriod(period)
      if (rows === null) {
        if (tableCleared) {
          await this.helper.prisma.balanceSheet.deleteMany({})
        }
        return null
      }

      if (!tableCleared) {
        await this.helper.prisma.balanceSheet.deleteMany({})
        this.logger.log(
          `[资产负债表] balancesheet_vip 可用，已清空旧数据，开始按报告期重建最近 ${years} 年（${periods.length} 个报告期）`,
        )
        tableCleared = true
      }

      const mapped = this.mapBalanceSheetRows(rows, collector, new Set([period]))
      totalRows += await this.createBalanceSheetRows(mapped)

      if (i === 0 || (i + 1) % 10 === 0 || i === periods.length - 1) {
        this.logger.log(`[资产负债表] VIP 进度 ${i + 1}/${periods.length}，报告期 ${period}，累计 ${totalRows} 条`)
      }
    }

    return totalRows
  }

  private async syncBalanceSheetByDisclosure(): Promise<void> {
    const startedAt = new Date()
    const lookbackYears = 2
    const periods = this.helper.buildRecentQuarterPeriods(lookbackYears)
    const candidates = await this.findMissingFinancialReportCandidates('balanceSheet', periods)

    if (!candidates.length) {
      this.logger.log(`[资产负债表] 近 ${lookbackYears} 年已披露报告均已入库，无需增量补齐`)
      await this.helper.writeSyncLog(
        TushareSyncTaskName.BALANCE_SHEET,
        {
          status: TushareSyncExecutionStatus.SUCCESS,
          message: '资产负债表增量检查完成，无缺失',
          payload: { lookbackYears, periodCount: periods.length, candidateCount: 0, rowCount: 0 },
        },
        startedAt,
      )
      return
    }

    this.logger.log(
      `[资产负债表] 发现 ${candidates.length} 个已披露但未入库的股票/报告期，优先按报告期调用 balancesheet_vip`,
    )

    const collector = new ValidationCollector(TushareSyncTaskName.BALANCE_SHEET)
    const grouped = this.groupFinancialReportCandidatesByPeriod(candidates)
    const failed: Array<{ tsCode: string; period: string; error: string }> = []
    let totalRows = 0
    let emptyRows = 0
    let vipPeriodCount = 0
    let fallbackCandidateCount = 0

    for (const [periodIndex, [period, periodCandidates]] of Array.from(grouped.entries()).entries()) {
      const vipRows = await this.tryGetBalanceSheetRowsByPeriod(period)

      if (vipRows === null) {
        fallbackCandidateCount += periodCandidates.length
        const fallbackResult = await this.syncBalanceSheetCandidatesOneByOne(periodCandidates, collector)
        totalRows += fallbackResult.totalRows
        emptyRows += fallbackResult.emptyRows
        failed.push(...fallbackResult.failed)
      } else {
        vipPeriodCount++
        const candidateKeys = new Set(periodCandidates.map((candidate) => `${candidate.tsCode}:${candidate.period}`))
        const mapped = this.mapBalanceSheetRows(vipRows, collector, new Set([period]), candidateKeys)
        const coveredKeys = new Set(
          mapped
            .map((row) => (typeof row.tsCode === 'string' ? `${row.tsCode}:${period}` : null))
            .filter((key): key is string => Boolean(key)),
        )

        if (!mapped.length) {
          emptyRows += periodCandidates.length
        } else {
          const tsCodes = Array.from(new Set(periodCandidates.map((candidate) => candidate.tsCode)))
          await this.helper.prisma.balanceSheet.deleteMany({
            where: {
              endDate: this.helper.toDate(period),
              tsCode: { in: tsCodes },
            },
          })
          totalRows += await this.createBalanceSheetRows(mapped)
          emptyRows += periodCandidates.filter(
            (candidate) => !coveredKeys.has(`${candidate.tsCode}:${candidate.period}`),
          ).length
        }
      }

      this.logger.log(
        `[资产负债表] 进度 ${periodIndex + 1}/${grouped.size}，报告期 ${period}，候选 ${periodCandidates.length} 个，累计 ${totalRows} 条`,
      )
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.BALANCE_SHEET,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `资产负债表增量补齐完成，候选 ${candidates.length} 个，写入 ${totalRows} 条`,
        payload: {
          lookbackYears,
          periodCount: periods.length,
          candidateCount: candidates.length,
          rowCount: totalRows,
          emptyCount: emptyRows,
          failedCount: failed.length,
          failed: failed.slice(0, 50),
          vipPeriodCount,
          fallbackCandidateCount,
          sourceApi:
            vipPeriodCount > 0
              ? fallbackCandidateCount > 0
                ? `${TushareApiName.BALANCE_SHEET_VIP}+${TushareApiName.BALANCE_SHEET}`
                : TushareApiName.BALANCE_SHEET_VIP
              : TushareApiName.BALANCE_SHEET,
        },
      },
      startedAt,
    )
  }

  private groupFinancialReportCandidatesByPeriod(candidates: FinancialReportCandidate[]) {
    const grouped = new Map<string, FinancialReportCandidate[]>()
    for (const candidate of candidates) {
      const periodCandidates = grouped.get(candidate.period) ?? []
      periodCandidates.push(candidate)
      grouped.set(candidate.period, periodCandidates)
    }
    return grouped
  }

  private async syncBalanceSheetCandidatesOneByOne(
    candidates: FinancialReportCandidate[],
    collector: ValidationCollector,
  ): Promise<{
    totalRows: number
    emptyRows: number
    failed: Array<{ tsCode: string; period: string; error: string }>
  }> {
    let totalRows = 0
    let emptyRows = 0
    const failed: Array<{ tsCode: string; period: string; error: string }> = []

    for (const [i, candidate] of candidates.entries()) {
      try {
        const rows = await this.api.getBalanceSheetByTsCodeAndPeriod(candidate.tsCode, candidate.period)
        const mapped = this.mapBalanceSheetRows(
          rows,
          collector,
          new Set([candidate.period]),
          new Set([`${candidate.tsCode}:${candidate.period}`]),
        )

        if (!mapped.length) {
          emptyRows++
        } else {
          await this.helper.prisma.balanceSheet.deleteMany({
            where: {
              tsCode: candidate.tsCode,
              endDate: this.helper.toDate(candidate.period),
            },
          })
          totalRows += await this.createBalanceSheetRows(mapped)
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === candidates.length - 1) {
          this.logger.log(
            `[资产负债表] 降级逐股进度 ${i + 1}/${candidates.length}，当前 ${candidate.tsCode} ${candidate.period}，累计 ${totalRows} 条`,
          )
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[资产负债表] ${candidate.tsCode} ${candidate.period} 失败: ${msg}`)
        failed.push({ ...candidate, error: msg })
      }
    }

    return { totalRows, emptyRows, failed }
  }

  private mapBalanceSheetRows(
    rows: Record<string, unknown>[],
    collector: ValidationCollector,
    periodSet: Set<string>,
    candidateKeys?: Set<string>,
  ): NonNullable<ReturnType<typeof mapBalanceSheetRecord>>[] {
    return rows
      .map((r) => mapBalanceSheetRecord(r, collector))
      .filter((row): row is NonNullable<ReturnType<typeof mapBalanceSheetRecord>> => Boolean(row))
      .filter((row) => {
        const endDateKey = this.normalizeDateKey(row.endDate)
        if (!endDateKey || !periodSet.has(endDateKey)) return false
        if (!candidateKeys) return true
        return candidateKeys.has(`${row.tsCode}:${endDateKey}`)
      })
  }

  private async createBalanceSheetRows(rows: NonNullable<ReturnType<typeof mapBalanceSheetRecord>>[]): Promise<number> {
    let totalRows = 0
    for (let i = 0; i < rows.length; i += this.balanceSheetCreateManyChunkSize) {
      const chunk = rows.slice(i, i + this.balanceSheetCreateManyChunkSize)
      if (!chunk.length) continue
      const result = await this.helper.prisma.balanceSheet.createMany({ data: chunk, skipDuplicates: true })
      totalRows += result.count
    }
    return totalRows
  }

  private async tryGetBalanceSheetRowsByPeriod(period: string): Promise<Record<string, unknown>[] | null> {
    if (this.balanceSheetVipAvailable === false) return null

    try {
      const rows = await this.api.getBalanceSheetByPeriod(period)
      if (this.balanceSheetVipAvailable !== true) {
        this.logger.log('[资产负债表] balancesheet_vip 调用成功，将优先按报告期批量同步')
      }
      this.balanceSheetVipAvailable = true
      return rows
    } catch (error) {
      if (this.isBalanceSheetVipFallbackError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        const reason = error instanceof TushareApiError ? `code=${error.code}, ${message}` : message
        this.logger.warn(`[资产负债表] balancesheet_vip 暂不可用（${reason}），自动降级到 balancesheet`)
        this.balanceSheetVipAvailable = false
        return null
      }

      throw error
    }
  }

  private isBalanceSheetVipFallbackError(error: unknown): boolean {
    if (!(error instanceof TushareApiError)) return false
    if (error.apiName !== TushareApiName.BALANCE_SHEET_VIP) return false
    if (error.code === 40203) return true
    return /权限|积分|没有访问|未开通|permission|access|quota|频控|频率|最多访问|超限/i.test(error.message)
  }

  // ─── 现金流量表 ────────────────────────────────────────────────────────────

  async syncCashflow(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode === 'full') {
      await this.rebuildCashflowRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.shouldRebuildRecentYears('cashflow', '现金流量表')) {
      await this.rebuildCashflowRecentYears(this.recentFinancialRebuildYears)
      return
    }

    if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.CASHFLOW)) {
      this.logger.log('[现金流量表] 今日已同步，跳过')
      return
    }

    await this.syncFinancialReportsByDisclosure({
      task: TushareSyncTaskName.CASHFLOW,
      label: '现金流量表',
      modelName: 'cashflow',
      fetchRows: (tsCode, period) => this.api.getCashflowByTsCodeAndPeriod(tsCode, period),
      mapRecord: mapCashflowRecord,
    })
  }

  async rebuildCashflowRecentYears(years = 15): Promise<void> {
    const startedAt = new Date()
    const periods = this.helper.buildRecentQuarterPeriods(years)
    const periodSet = new Set(periods)
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[现金流量表] 股票列表为空，跳过重建')
      return
    }

    await this.helper.prisma.cashflow.deleteMany({})
    this.logger.log(`[现金流量表] 已清空旧数据，开始按股票重建最近 ${years} 年（${stocks.length} 只股票）`)

    let totalRows = 0
    const failedStocks: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.CASHFLOW)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getCashflowByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapCashflowRecord(r, collector))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
            const endDateKey = this.normalizeDateKey(row.endDate)
            return endDateKey ? periodSet.has(endDateKey) : false
          })

        if (mapped.length > 0) {
          const result = await this.helper.prisma.cashflow.createMany({ data: mapped, skipDuplicates: true })
          totalRows += result.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[现金流量表] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failedStocks.push(tsCode)
        this.logger.error(`[现金流量表] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    if (failedStocks.length > 0) {
      this.logger.warn(`[现金流量表] ${failedStocks.length} 只股票失败，开始兜底重试...`)
      for (const tsCode of failedStocks) {
        try {
          const rows = await this.api.getCashflowByTsCode(tsCode)
          const mapped = rows
            .map((r) => mapCashflowRecord(r, collector))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
              const endDateKey = this.normalizeDateKey(row.endDate)
              return endDateKey ? periodSet.has(endDateKey) : false
            })
          if (mapped.length > 0) {
            totalRows += (await this.helper.prisma.cashflow.createMany({ data: mapped, skipDuplicates: true })).count
          }
          this.logger.log(`[现金流量表] ${tsCode} 重试成功`)
        } catch (error) {
          this.logger.error(`[现金流量表] ${tsCode} 重试仍失败: ${(error as Error).message}`)
        }
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CASHFLOW,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `现金流量表重建完成，最近 ${years} 年，共 ${totalRows} 条`,
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
    const collector = new ValidationCollector(TushareSyncTaskName.EXPRESS)

    let totalRows = 0
    const failedStocks: string[] = []

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getExpressByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapExpressRecord(r, collector))
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
            .map((r) => mapExpressRecord(r, collector))
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

    await this.helper.flushValidationLogs(collector)
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
    const collector = new ValidationCollector(TushareSyncTaskName.FINA_INDICATOR)

    let totalRows = 0
    const failedStocks: string[] = []
    const startDate = periods[0]
    const endDate = periods[periods.length - 1]

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getFinaIndicatorByTsCodeAndDateRange(tsCode, startDate, endDate)
        const mapped = rows
          .map((r) => mapFinaIndicatorRecord(r, collector))
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
            .map((r) => mapFinaIndicatorRecord(r, collector))
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

    await this.helper.flushValidationLogs(collector)
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
    const collector = new ValidationCollector(TushareSyncTaskName.EXPRESS)

    for (const [i, w] of windows.entries()) {
      try {
        const rows = await this.api.getExpress(w.startDate, w.endDate)
        const mapped = rows
          .map((r) => mapExpressRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
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
    await this.helper.flushValidationLogs(collector)
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
    const mapped = rows.map((r) => mapDividendRecord(r)).filter((r): r is NonNullable<typeof r> => Boolean(r))
    if (!mapped.length) return 0

    await this.helper.prisma.dividend.deleteMany({ where: { tsCode } })
    const result = await this.helper.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
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
    const collector = new ValidationCollector(TushareSyncTaskName.DIVIDEND)

    for (const [i, tsCode] of stockCodes.entries()) {
      try {
        const rows = await this.api.getDividendByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapDividendRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
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
    await this.helper.flushValidationLogs(collector)
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
    // annDate 在历史数据中大量为空，MAX(ann_date) 可能返回 null；此时兜底回退 365 天而非从 syncStartDate（19900101）开始
    const fallbackStart = this.helper.addDays(rangeEnd, -365)
    const rangeStart = latestDate ? this.helper.addDays(latestDate, 1) : fallbackStart

    if (this.helper.compareDateString(rangeStart, rangeEnd) > 0) {
      this.logger.log(`[分红数据] 已是最新（最新公告日: ${latestDate}）`)
      return
    }

    this.logger.log(`[分红数据] 增量同步 ${rangeStart} → ${rangeEnd}`)
    const windows = this.helper.buildMonthlyWindows(rangeStart, rangeEnd)
    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.DIVIDEND)

    for (const [i, w] of windows.entries()) {
      try {
        const rows = await this.api.getDividendByDateRange(w.startDate, w.endDate)
        const mapped = rows
          .map((r) => mapDividendRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
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
    await this.helper.flushValidationLogs(collector)
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

    await this.syncFinancialReportsByDisclosure({
      task: TushareSyncTaskName.FINA_INDICATOR,
      label: '财务指标',
      modelName: 'finaIndicator',
      fetchRows: (tsCode, period) => this.api.getFinaIndicatorByTsCodeAndPeriod(tsCode, period),
      mapRecord: mapFinaIndicatorRecord,
    })
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
    mapRecord: (r: Record<string, unknown>, collector?: ValidationCollector) => unknown | null
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
    const collector = new ValidationCollector(task)

    for (const [i, period] of periods.entries()) {
      try {
        const rows = await fetchByPeriod(period)
        const mapped = rows.map((r) => mapRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))

        const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]
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
          const mapped = rows.map((r) => mapRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
          const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]
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
    await this.helper.flushValidationLogs(collector)
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
    const rowCount = await (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName].count()
    if (rowCount > 0) {
      return false
    }

    this.logger.log(`[${label}] 检测到空表，将按股票重建最近 ${this.recentFinancialRebuildYears} 年季度数据`)
    return true
  }

  /**
   * 基于财报披露计划增量补齐财务报表。
   *
   * Tushare 非 VIP 财报接口只能按单只股票拉取历史或指定报告期；
   * 不能用“全表最大 endDate”判断同步完成，否则同一报告期里晚披露的股票会被漏掉。
   */
  private async syncFinancialReportsByDisclosure(opts: FinancialReportIncrementalOptions): Promise<void> {
    const startedAt = new Date()
    const lookbackYears = opts.lookbackYears ?? 2
    const periods = this.helper.buildRecentQuarterPeriods(lookbackYears)
    const candidates = await this.findMissingFinancialReportCandidates(opts.modelName, periods)

    if (!candidates.length) {
      this.logger.log(`[${opts.label}] 近 ${lookbackYears} 年已披露报告均已入库，无需增量补齐`)
      await this.helper.writeSyncLog(
        opts.task,
        {
          status: TushareSyncExecutionStatus.SUCCESS,
          message: `${opts.label}增量检查完成，无缺失`,
          payload: { lookbackYears, periodCount: periods.length, candidateCount: 0, rowCount: 0 },
        },
        startedAt,
      )
      return
    }

    this.logger.log(`[${opts.label}] 发现 ${candidates.length} 个已披露但未入库的股票/报告期，开始按股票补齐`)

    const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[opts.modelName]
    const collector = new ValidationCollector(opts.task)
    const failed: Array<{ tsCode: string; period: string; error: string }> = []
    let totalRows = 0
    let emptyRows = 0

    for (const [i, candidate] of candidates.entries()) {
      try {
        const rows = await opts.fetchRows(candidate.tsCode, candidate.period)
        const mapped = rows
          .map((r) => opts.mapRecord(r, collector))
          .filter((row): row is { endDate?: Date | string | null } & Record<string, unknown> => Boolean(row))
          .filter((row) => this.normalizeDateKey(row.endDate) === candidate.period)

        if (!mapped.length) {
          emptyRows++
        } else {
          await model.deleteMany({
            where: {
              tsCode: candidate.tsCode,
              endDate: this.helper.toDate(candidate.period),
            },
          })
          const result = await model.createMany({ data: mapped, skipDuplicates: true })
          totalRows += result.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === candidates.length - 1) {
          this.logger.log(
            `[${opts.label}] 进度 ${i + 1}/${candidates.length}，当前 ${candidate.tsCode} ${candidate.period}，累计 ${totalRows} 条`,
          )
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[${opts.label}] ${candidate.tsCode} ${candidate.period} 失败: ${msg}`)
        failed.push({ ...candidate, error: msg })
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      opts.task,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${opts.label}增量补齐完成，候选 ${candidates.length} 个，写入 ${totalRows} 条`,
        payload: {
          lookbackYears,
          periodCount: periods.length,
          candidateCount: candidates.length,
          rowCount: totalRows,
          emptyCount: emptyRows,
          failedCount: failed.length,
          failed: failed.slice(0, 50),
        },
      },
      startedAt,
    )
  }

  private async findMissingFinancialReportCandidates(
    modelName: FinancialReportModelName,
    periods: string[],
  ): Promise<FinancialReportCandidate[]> {
    if (!periods.length) return []

    const periodDates = periods.map((period) => this.helper.toDate(period))
    const today = this.helper.toDate(this.helper.getCurrentShanghaiDateString())

    const disclosures = await this.helper.prisma.disclosureDate.findMany({
      where: {
        endDate: { in: periodDates },
        actualDate: { not: null, lte: today },
      },
      select: { tsCode: true, endDate: true },
      orderBy: [{ endDate: 'asc' }, { tsCode: 'asc' }],
    })

    if (!disclosures.length) return []

    const tsCodes = Array.from(new Set(disclosures.map((d) => d.tsCode)))
    const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]
    const existingRows = await model.findMany({
      where: {
        tsCode: { in: tsCodes },
        endDate: { in: periodDates },
      },
      select: { tsCode: true, endDate: true },
    })
    const existingKeys = new Set(
      existingRows
        .map((row) => {
          const tsCode = typeof row.tsCode === 'string' ? row.tsCode : null
          const period = this.normalizeDateKey(row.endDate as Date | string | null | undefined)
          return tsCode && period ? `${tsCode}:${period}` : null
        })
        .filter((key): key is string => Boolean(key)),
    )

    return disclosures
      .map((row) => ({ tsCode: row.tsCode, period: this.helper.formatDate(row.endDate) }))
      .filter((row) => !existingKeys.has(`${row.tsCode}:${row.period}`))
  }

  private async rebuildShareholdersRecentYears(opts: {
    task: TushareSyncTaskName
    label: string
    years: number
    modelName: 'top10Holders' | 'top10FloatHolders'
    fetchRows: (tsCode: string, startDate: string, endDate: string) => Promise<Record<string, unknown>[]>
    mapRecord: (
      record: Record<string, unknown>,
      collector?: ValidationCollector,
    ) => ({ endDate?: Date | string | null } & Record<string, unknown>) | null | undefined
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

    const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]
    await model.deleteMany({})
    this.logger.log(`[${label}] 已清空旧数据，开始按股票重建最近 ${years} 年`)

    let totalRows = 0
    const failedStocks: string[] = []
    const startDate = periods[0]
    const endDate = periods[periods.length - 1]
    const collector = new ValidationCollector(task)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await fetchRows(tsCode, startDate, endDate)
        const mapped = rows
          .map((r) => mapRecord(r, collector))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .filter((row) => {
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
            .map((r) => mapRecord(r, collector))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .filter((row) => {
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

    await this.helper.flushValidationLogs(collector)
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

  // ─── 业绩预告 ──────────────────────────────────────────────────────────────

  async syncForecast(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    // 确定需要拉取的报告期列表
    let periods: string[]
    if (mode === 'full') {
      // 全量：从 2010 年 Q1 开始至今所有季度
      periods = this.helper.buildRecentQuarterPeriods(new Date().getFullYear() - 2010 + 1)
    } else {
      // 增量：最近 4 个季度（覆盖预告更新）
      periods = this.helper.buildRecentQuarterPeriods(2)
    }

    this.logger.log(`[业绩预告] 同步 ${periods.length} 个报告期，模式: ${mode}`)

    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.FORECAST)

    for (const [i, period] of periods.entries()) {
      try {
        const rows = await this.api.getForecastByPeriod(period)
        const mapped = rows
          .map((r) => mapForecastRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        const periodDate = this.helper.toDate(period)
        const count = await this.helper.replaceDateRangeRows(
          'forecast',
          'endDate',
          periodDate,
          periodDate,
          mapped,
          {},
          { skipDuplicates: true },
        )
        totalRows += count

        if (i === 0 || (i + 1) % 10 === 0 || i === periods.length - 1) {
          this.logger.log(`[业绩预告] 进度 ${i + 1}/${periods.length}，报告期 ${period}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        this.logger.error(`[业绩预告] 报告期 ${period} 同步失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FORECAST,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `业绩预告同步完成，${periods.length} 个报告期，共 ${totalRows} 条`,
        payload: { mode, periodCount: periods.length, rowCount: totalRows, syncDate: today },
      },
      startedAt,
    )
  }

  // ─── 股东人数 ──────────────────────────────────────────────────────────────

  async syncStkHolderNumber(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let windows: Array<{ startDate: string; endDate: string }>
    if (mode === 'full') {
      // 全量：从 2015 年起按月遍历
      windows = this.helper.buildMonthlyWindows('20150101', today)
    } else {
      // 增量：最近 30 天按月划分（通常只有 1 个月）
      const start30 = this.helper.addDays(today, -30)
      windows = this.helper.buildMonthlyWindows(start30, today)
    }

    this.logger.log(`[股东人数] 同步 ${windows.length} 个月度窗口，模式: ${mode}`)

    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.STK_HOLDER_NUMBER)

    for (const [i, { startDate, endDate }] of windows.entries()) {
      try {
        const rows = await this.api.getStkHolderNumberByDateRange(startDate, endDate)
        const mapped = rows
          .map((r) => mapStkHolderNumberRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.stkHolderNumber.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 20 === 0 || i === windows.length - 1) {
          this.logger.log(
            `[股东人数] 进度 ${i + 1}/${windows.length}，窗口 ${startDate}~${endDate}，累计 ${totalRows} 条`,
          )
        }
      } catch (error) {
        this.logger.error(`[股东人数] 窗口 ${startDate}~${endDate} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.STK_HOLDER_NUMBER,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股东人数同步完成，${windows.length} 个月度窗口，共 ${totalRows} 条`,
        payload: { mode, windowCount: windows.length, rowCount: totalRows, syncDate: today },
      },
      startedAt,
    )
  }

  // ─── 股东增减持 ────────────────────────────────────────────────────────────

  async syncStkHolderTrade(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let windows: Array<{ startDate: string; endDate: string }>
    if (mode === 'full') {
      // 全量：从 2010 年起按月遍历（~192 个月 × 300ms ≈ ~60 分钟）
      windows = this.helper.buildMonthlyWindows('20100101', today)
    } else {
      // 增量：拉最近 30 天
      const start30 = this.helper.addDays(today, -30)
      windows = this.helper.buildMonthlyWindows(start30, today)
    }

    this.logger.log(`[股东增减持] 同步 ${windows.length} 个月度窗口，模式: ${mode}`)

    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.STK_HOLDER_TRADE)

    for (const [i, { startDate, endDate }] of windows.entries()) {
      try {
        const rows = await this.api.getStkHolderTradeByDateRange(startDate, endDate)
        const mapped = rows
          .map((r) => mapStkHolderTradeRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.stkHolderTrade.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 20 === 0 || i === windows.length - 1) {
          this.logger.log(
            `[股东增减持] 进度 ${i + 1}/${windows.length}，窗口 ${startDate}~${endDate}，累计 ${totalRows} 条`,
          )
        }
      } catch (error) {
        this.logger.error(`[股东增减持] 窗口 ${startDate}~${endDate} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.STK_HOLDER_TRADE,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股东增减持同步完成，${windows.length} 个月度窗口，共 ${totalRows} 条`,
        payload: { mode, windowCount: windows.length, rowCount: totalRows, syncDate: today },
      },
      startedAt,
    )
  }

  // ─── 股权质押统计 ──────────────────────────────────────────────────────────

  async syncPledgeStat(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[股权质押统计] 股票列表为空，跳过')
      return
    }

    if (mode !== 'full') {
      if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.PLEDGE_STAT)) {
        this.logger.log('[股权质押统计] 今日已同步，跳过')
        return
      }
    }

    this.logger.log(`[股权质押统计] 开始遍历 ${stocks.length} 只股票`)

    let totalRows = 0
    const failed: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.PLEDGE_STAT)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getPledgeStatByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapPledgeStatRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.pledgeStat.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 500 === 0 || i === stocks.length - 1) {
          this.logger.log(`[股权质押统计] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failed.push(tsCode)
        this.logger.error(`[股权质押统计] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.PLEDGE_STAT,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股权质押统计同步完成，${stocks.length} 只股票，共 ${totalRows} 条`,
        payload: {
          mode,
          stockCount: stocks.length,
          rowCount: totalRows,
          ...(failed.length > 0 && { failedStocks: failed }),
        },
      },
      startedAt,
    )
  }

  // ─── 财务审计意见 ──────────────────────────────────────────────────────────

  async syncFinaAudit(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()

    if (mode !== 'full') {
      if (await this.shouldRebuildRecentYears('finaAudit', '财务审计意见')) {
        return this.syncFinaAudit('full')
      }
      if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.FINA_AUDIT)) {
        this.logger.log('[财务审计意见] 今日已同步，跳过')
        return
      }
      this.logger.log('[财务审计意见] 当前仅在空表时触发全量重建；现有数据非空，跳过本轮')
      return
    }

    const stocks = await this.getAllStockCodes()
    if (!stocks.length) {
      this.logger.warn('[财务审计意见] 股票列表为空，跳过')
      return
    }

    await this.helper.prisma.finaAudit.deleteMany({})
    this.logger.log(`[财务审计意见] 已清空旧数据，开始按股票全量重建（${stocks.length} 只股票）`)

    let totalRows = 0
    const failed: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.FINA_AUDIT)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getFinaAuditByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapFinaAuditRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.finaAudit.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[财务审计意见] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failed.push(tsCode)
        this.logger.error(`[财务审计意见] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FINA_AUDIT,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财务审计意见同步完成，${stocks.length} 只股票，共 ${totalRows} 条`,
        payload: {
          mode,
          stockCount: stocks.length,
          rowCount: totalRows,
          ...(failed.length > 0 && { failedStocks: failed }),
        },
      },
      startedAt,
    )
  }

  // ─── 财报披露计划 ──────────────────────────────────────────────────────────

  async syncDisclosureDate(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let periods: string[]
    if (mode === 'full') {
      // 全量：从 2010Q1 至今所有季度
      periods = this.helper.buildRecentQuarterPeriods(new Date().getFullYear() - 2010 + 1)
    } else {
      // 增量：最近 2 个季度（覆盖即将披露的计划更新）
      periods = this.helper.buildRecentQuarterPeriods(2)
    }

    this.logger.log(`[财报披露计划] 同步 ${periods.length} 个报告期，模式: ${mode}`)

    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.DISCLOSURE_DATE)

    for (const [i, period] of periods.entries()) {
      try {
        const rows = await this.api.getDisclosureDateByPeriod(period)
        const mapped = rows
          .map((r) => mapDisclosureDateRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        const periodDate = this.helper.toDate(period)
        const count = await this.helper.replaceDateRangeRows(
          'disclosureDate',
          'endDate',
          periodDate,
          periodDate,
          mapped,
          {},
          { skipDuplicates: false },
        )
        totalRows += count

        if (i === 0 || (i + 1) % 10 === 0 || i === periods.length - 1) {
          this.logger.log(`[财报披露计划] 进度 ${i + 1}/${periods.length}，报告期 ${period}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        this.logger.error(`[财报披露计划] 报告期 ${period} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.DISCLOSURE_DATE,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财报披露计划同步完成，${periods.length} 个报告期，共 ${totalRows} 条`,
        payload: { mode, periodCount: periods.length, rowCount: totalRows, syncDate: today },
      },
      startedAt,
    )
  }

  // ─── 主营业务构成 ──────────────────────────────────────────────────────────

  async syncFinaMainbz(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const stocks = await this.getAllStockCodes()

    if (!stocks.length) {
      this.logger.warn('[主营业务构成] 股票列表为空，跳过')
      return
    }

    if (mode !== 'full') {
      if (await this.shouldRebuildRecentYears('finaMainbz', '主营业务构成')) {
        return this.syncFinaMainbz('full')
      }
      if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.FINA_MAINBZ)) {
        this.logger.log('[主营业务构成] 今日已同步，跳过')
        return
      }
      this.logger.log('[主营业务构成] 当前仅在空表时触发全量重建；现有数据非空，跳过本轮')
      return
    }

    await this.helper.prisma.finaMainbz.deleteMany({})
    this.logger.log(`[主营业务构成] 已清空旧数据，开始按股票全量重建（${stocks.length} 只股票）`)

    let totalRows = 0
    const failed: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.FINA_MAINBZ)

    for (const [i, tsCode] of stocks.entries()) {
      try {
        const rows = await this.api.getFinaMainbzByTsCode(tsCode)
        const mapped = rows
          .map((r) => mapFinaMainbzRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.finaMainbz.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 200 === 0 || i === stocks.length - 1) {
          this.logger.log(`[主营业务构成] 进度 ${i + 1}/${stocks.length}，当前 ${tsCode}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        failed.push(tsCode)
        this.logger.error(`[主营业务构成] ${tsCode} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FINA_MAINBZ,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `主营业务构成同步完成，${stocks.length} 只股票，共 ${totalRows} 条`,
        payload: {
          mode,
          stockCount: stocks.length,
          rowCount: totalRows,
          ...(failed.length > 0 && { failedStocks: failed }),
        },
      },
      startedAt,
    )
  }

  // ─── 股票回购 ──────────────────────────────────────────────────────────────

  async syncRepurchase(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let windows: Array<{ startDate: string; endDate: string }>
    if (mode === 'full') {
      windows = this.helper.buildMonthlyWindows('20100101', today)
    } else {
      const start30 = this.helper.addDays(today, -30)
      windows = this.helper.buildMonthlyWindows(start30, today)
    }

    this.logger.log(`[股票回购] 同步 ${windows.length} 个月度窗口，模式: ${mode}`)

    let totalRows = 0
    const collector = new ValidationCollector(TushareSyncTaskName.REPURCHASE)

    for (const [i, { startDate, endDate }] of windows.entries()) {
      try {
        const rows = await this.api.getRepurchaseByDateRange(startDate, endDate)
        const mapped = rows
          .map((r) => mapRepurchaseRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        if (mapped.length > 0) {
          const count = await this.helper.prisma.repurchase.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += count.count
        }

        if (i === 0 || (i + 1) % 20 === 0 || i === windows.length - 1) {
          this.logger.log(
            `[股票回购] 进度 ${i + 1}/${windows.length}，窗口 ${startDate}~${endDate}，累计 ${totalRows} 条`,
          )
        }
      } catch (error) {
        this.logger.error(`[股票回购] 窗口 ${startDate}~${endDate} 失败: ${(error as Error).message}`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.REPURCHASE,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股票回购同步完成，${windows.length} 个月度窗口，共 ${totalRows} 条`,
        payload: { mode, windowCount: windows.length, rowCount: totalRows, syncDate: today },
      },
      startedAt,
    )
  }
}
