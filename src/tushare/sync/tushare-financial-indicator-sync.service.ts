import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { mapFinaIndicatorRecord, mapTop10FloatHoldersRecord, mapTop10HoldersRecord } from '../tushare-sync.mapper'
import { TushareApiService } from '../tushare-api.service'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

/**
 * TushareFinancialIndicatorSyncService
 *
 * 负责财务指标、前十大股东、前十大流通股东的同步。
 * 以"报告期（period）"为单位拉取，每次同步计算出尚未入库的季度期末日，逐期补数。
 * 标准季度期末：3-31 / 6-30 / 9-30 / 12-31
 */
@Injectable()
export class TushareFinancialIndicatorSyncService {
  private readonly logger = new Logger(TushareFinancialIndicatorSyncService.name)

  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.FINA_INDICATOR,
        category: 'financial-indicator',
        stage: 'afterTradeDate',
        run: async () => this.checkFinaIndicatorFreshness(),
      },
      {
        task: TushareSyncTaskName.TOP10_HOLDERS,
        category: 'financial-indicator',
        stage: 'afterTradeDate',
        run: async () => this.checkTop10HoldersFreshness(),
      },
      {
        task: TushareSyncTaskName.TOP10_FLOAT_HOLDERS,
        category: 'financial-indicator',
        stage: 'afterTradeDate',
        run: async () => this.checkTop10FloatHoldersFreshness(),
      },
    ]
  }

  // ─── FinaIndicator ───────────────────────────────────────────────────────────

  async checkFinaIndicatorFreshness() {
    await this.support.executeTask(TushareSyncTaskName.FINA_INDICATOR, async () => {
      const latestLocalDate = await this.support.getLatestDateString('finaIndicator', 'endDate')
      const periods = this.buildPendingQuarterPeriods(latestLocalDate)

      if (!periods.length) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '财务指标数据已是最新，无需补数。' }
      }

      const stockCodes = await this.getAllStockCodes()
      if (!stockCodes.length) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: '股票基础信息为空，暂时无法同步财务指标。',
        }
      }

      const pendingPeriodSet = new Set(periods)
      const pendingPeriodDates = periods.map((period) => this.support.toDate(period))
      let totalRows = 0

      for (const [index, tsCode] of stockCodes.entries()) {
        if (index === 0 || (index + 1) % 200 === 0 || index === stockCodes.length - 1) {
          this.logger.log(
            `[FINA_INDICATOR] 股票进度 ${index + 1}/${stockCodes.length}，当前 ${tsCode}，累计写入 ${totalRows} 条。`,
          )
        }

        totalRows += await this.syncFinaIndicatorByTsCode(tsCode, pendingPeriodSet, pendingPeriodDates)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财务指标同步完成，共处理 ${stockCodes.length} 只股票、补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, stockCount: stockCodes.length, rowCount: totalRows, periods },
      }
    })
  }

  private async syncFinaIndicatorByTsCode(
    tsCode: string,
    pendingPeriodSet: Set<string>,
    pendingPeriodDates: Date[],
  ): Promise<number> {
    const rows = await this.tushareApiService.getFinaIndicatorByTsCode(tsCode)
    const mapped = this.deduplicateFinaIndicatorRows(
      rows
        .map(mapFinaIndicatorRecord)
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .filter((row) => pendingPeriodSet.has(this.normalizeDateValue(row.endDate))),
    )

    const deleteArgs = {
      where: {
        tsCode,
        endDate: { in: pendingPeriodDates },
      },
    }

    if (!mapped.length) {
      await this.support.prisma.finaIndicator.deleteMany(deleteArgs)
      return 0
    }

    const [, result] = await this.support.prisma.$transaction([
      this.support.prisma.finaIndicator.deleteMany(deleteArgs),
      this.support.prisma.finaIndicator.createMany({ data: mapped, skipDuplicates: true }),
    ])

    return result.count
  }

  // ─── Top10Holders ────────────────────────────────────────────────────────────

  async checkTop10HoldersFreshness() {
    await this.support.executeTask(TushareSyncTaskName.TOP10_HOLDERS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('top10Holders', 'endDate')
      const periods = this.buildQuarterPeriodsForRollingBackfill(latestLocalDate)

      if (!periods.length) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '前十大股东数据已是最新，无需补数。' }
      }

      const stockCodes = await this.getAllStockCodes()
      if (!stockCodes.length) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: '股票基础信息为空，暂时无法同步前十大股东。',
        }
      }

      const pendingPeriodSet = new Set(periods)
      const pendingPeriodDates = periods.map((period) => this.support.toDate(period))
      let totalRows = 0
      for (const [index, tsCode] of stockCodes.entries()) {
        if (index === 0 || (index + 1) % 200 === 0 || index === stockCodes.length - 1) {
          this.logger.log(
            `[TOP10_HOLDERS] 股票进度 ${index + 1}/${stockCodes.length}，当前 ${tsCode}，累计写入 ${totalRows} 条。`,
          )
        }

        totalRows += await this.syncTop10HoldersByTsCode(tsCode, pendingPeriodSet, pendingPeriodDates)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `前十大股东同步完成，共处理 ${stockCodes.length} 只股票、回补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, stockCount: stockCodes.length, rowCount: totalRows, periods },
      }
    })
  }

  private async syncTop10HoldersByTsCode(
    tsCode: string,
    pendingPeriodSet: Set<string>,
    pendingPeriodDates: Date[],
  ): Promise<number> {
    return this.syncShareholderRowsByTsCode({
      modelName: 'top10Holders',
      tsCode,
      pendingPeriodSet,
      pendingPeriodDates,
      fetchRows: () => this.tushareApiService.getTop10HoldersByTsCode(tsCode),
      mapRow: mapTop10HoldersRecord,
    })
  }

  // ─── Top10FloatHolders ───────────────────────────────────────────────────────

  async checkTop10FloatHoldersFreshness() {
    await this.support.executeTask(TushareSyncTaskName.TOP10_FLOAT_HOLDERS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('top10FloatHolders', 'endDate')
      const periods = this.buildQuarterPeriodsForRollingBackfill(latestLocalDate)

      if (!periods.length) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '前十大流通股东数据已是最新，无需补数。' }
      }

      const stockCodes = await this.getAllStockCodes()
      if (!stockCodes.length) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: '股票基础信息为空，暂时无法同步前十大流通股东。',
        }
      }

      const pendingPeriodSet = new Set(periods)
      const pendingPeriodDates = periods.map((period) => this.support.toDate(period))
      let totalRows = 0
      for (const [index, tsCode] of stockCodes.entries()) {
        if (index === 0 || (index + 1) % 200 === 0 || index === stockCodes.length - 1) {
          this.logger.log(
            `[TOP10_FLOAT_HOLDERS] 股票进度 ${index + 1}/${stockCodes.length}，当前 ${tsCode}，累计写入 ${totalRows} 条。`,
          )
        }

        totalRows += await this.syncTop10FloatHoldersByTsCode(tsCode, pendingPeriodSet, pendingPeriodDates)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `前十大流通股东同步完成，共处理 ${stockCodes.length} 只股票、回补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, stockCount: stockCodes.length, rowCount: totalRows, periods },
      }
    })
  }

  private async syncTop10FloatHoldersByTsCode(
    tsCode: string,
    pendingPeriodSet: Set<string>,
    pendingPeriodDates: Date[],
  ): Promise<number> {
    return this.syncShareholderRowsByTsCode({
      modelName: 'top10FloatHolders',
      tsCode,
      pendingPeriodSet,
      pendingPeriodDates,
      fetchRows: () => this.tushareApiService.getTop10FloatHoldersByTsCode(tsCode),
      mapRow: mapTop10FloatHoldersRecord,
    })
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * 计算自上次同步的报告期之后、到当前上海时间为止所有尚未入库的季度期末日。
   * 季度期末：3-31、6-30、9-30、12-31
   */
  private buildPendingQuarterPeriods(latestPeriod: string | null): string[] {
    const syncStart = latestPeriod ? this.support.addDays(latestPeriod, 1) : this.support.syncStartDate
    const today = this.support.getCurrentShanghaiDateString()

    const quarters = ['0331', '0630', '0930', '1231']
    const periods: string[] = []

    const startYear = parseInt(syncStart.slice(0, 4), 10)
    const endYear = parseInt(today.slice(0, 4), 10)

    for (let year = startYear; year <= endYear; year++) {
      for (const q of quarters) {
        const period = `${year}${q}`
        if (period > today) break
        if (period >= syncStart.slice(0, 8)) {
          periods.push(period)
        }
      }
    }

    return periods.filter((p) => {
      // 当前季度的期末如果还没到，跳过（数据还未发布）
      return p <= today
    })
  }

  private buildQuarterPeriodsForRollingBackfill(
    latestPeriod: string | null,
    rollingQuarterCount: number = 4,
  ): string[] {
    if (!latestPeriod) {
      return this.buildPendingQuarterPeriods(null)
    }

    const rollingStartPeriod = this.resolveRollingQuarterStart(rollingQuarterCount)
    if (this.support.compareDateString(latestPeriod, rollingStartPeriod) < 0) {
      return this.buildPendingQuarterPeriods(latestPeriod)
    }

    return this.buildPendingQuarterPeriods(this.support.addDays(rollingStartPeriod, -1))
  }

  private resolveRollingQuarterStart(rollingQuarterCount: number): string {
    const completedPeriods = this.buildPendingQuarterPeriods(null)
    if (!completedPeriods.length) {
      return this.support.syncStartDate
    }

    return completedPeriods[Math.max(0, completedPeriods.length - rollingQuarterCount)]
  }

  private async getAllStockCodes(): Promise<string[]> {
    const rows = await this.support.prisma.stockBasic.findMany({
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
    })

    return rows.map((row) => row.tsCode)
  }

  private deduplicateFinaIndicatorRows<T extends { tsCode: string; endDate: string | Date }>(rows: T[]): T[] {
    const deduplicated = new Map<string, T>()

    for (const row of rows) {
      deduplicated.set(`${row.tsCode}:${this.normalizeDateValue(row.endDate)}`, row)
    }

    return Array.from(deduplicated.values())
  }

  private deduplicateShareholderRows<T extends { tsCode: string; endDate: string | Date; holderName: string }>(
    rows: T[],
  ): T[] {
    const deduplicated = new Map<string, T>()

    for (const row of rows) {
      deduplicated.set(`${row.tsCode}:${this.normalizeDateValue(row.endDate)}:${row.holderName}`, row)
    }

    return Array.from(deduplicated.values())
  }

  private normalizeDateValue(value: string | Date): string {
    return value instanceof Date ? this.support.formatDate(value) : value
  }

  private async syncShareholderRowsByTsCode<
    T extends { tsCode: string; endDate: string | Date; holderName: string },
  >(options: {
    modelName: 'top10Holders' | 'top10FloatHolders'
    tsCode: string
    pendingPeriodSet: Set<string>
    pendingPeriodDates: Date[]
    fetchRows: () => Promise<Record<string, unknown>[]>
    mapRow: (record: Record<string, unknown>) => T | null
  }): Promise<number> {
    const rows = await options.fetchRows()
    const mapped = this.deduplicateShareholderRows(
      rows
        .map(options.mapRow)
        .filter((row): row is T => Boolean(row))
        .filter((row) => options.pendingPeriodSet.has(this.normalizeDateValue(row.endDate))),
    )

    const deleteArgs = {
      where: {
        tsCode: options.tsCode,
        endDate: { in: options.pendingPeriodDates },
      },
    }

    if (!mapped.length) {
      if (options.modelName === 'top10Holders') {
        await this.support.prisma.top10Holders.deleteMany(deleteArgs)
      } else {
        await this.support.prisma.top10FloatHolders.deleteMany(deleteArgs)
      }
      return 0
    }

    const [, result] =
      options.modelName === 'top10Holders'
        ? await this.support.prisma.$transaction([
            this.support.prisma.top10Holders.deleteMany(deleteArgs),
            this.support.prisma.top10Holders.createMany({ data: mapped, skipDuplicates: true }),
          ])
        : await this.support.prisma.$transaction([
            this.support.prisma.top10FloatHolders.deleteMany(deleteArgs),
            this.support.prisma.top10FloatHolders.createMany({ data: mapped, skipDuplicates: true }),
          ])

    return result.count
  }
}
