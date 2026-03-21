import { Injectable, Logger } from '@nestjs/common'
import * as dayjs from 'dayjs'
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

      let totalRows = 0
      for (const period of periods) {
        totalRows += await this.syncFinaIndicatorByPeriod(period)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `财务指标同步完成，共补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, rowCount: totalRows, periods },
      }
    })
  }

  private async syncFinaIndicatorByPeriod(period: string): Promise<number> {
    const rows = await this.tushareApiService.getFinaIndicatorByPeriod(period)
    const periodDate = this.support.toDate(period)

    const mapped = rows.map(mapFinaIndicatorRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))

    // 清理该期数据后重新写入（避免部分重复）
    await this.support.replaceDateRangeRows('finaIndicator', 'endDate', periodDate, periodDate, mapped)
    return mapped.length
  }

  // ─── Top10Holders ────────────────────────────────────────────────────────────

  async checkTop10HoldersFreshness() {
    await this.support.executeTask(TushareSyncTaskName.TOP10_HOLDERS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('top10Holders', 'endDate')
      const periods = this.buildPendingQuarterPeriods(latestLocalDate)

      if (!periods.length) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '前十大股东数据已是最新，无需补数。' }
      }

      let totalRows = 0
      for (const period of periods) {
        totalRows += await this.syncTop10HoldersByPeriod(period)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `前十大股东同步完成，共补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, rowCount: totalRows },
      }
    })
  }

  private async syncTop10HoldersByPeriod(period: string): Promise<number> {
    const rows = await this.tushareApiService.getTop10HoldersByPeriod(period)
    const periodDate = this.support.toDate(period)

    const mapped = rows.map(mapTop10HoldersRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
    await this.support.replaceDateRangeRows('top10Holders', 'endDate', periodDate, periodDate, mapped)
    return mapped.length
  }

  // ─── Top10FloatHolders ───────────────────────────────────────────────────────

  async checkTop10FloatHoldersFreshness() {
    await this.support.executeTask(TushareSyncTaskName.TOP10_FLOAT_HOLDERS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('top10FloatHolders', 'endDate')
      const periods = this.buildPendingQuarterPeriods(latestLocalDate)

      if (!periods.length) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '前十大流通股东数据已是最新，无需补数。' }
      }

      let totalRows = 0
      for (const period of periods) {
        totalRows += await this.syncTop10FloatHoldersByPeriod(period)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `前十大流通股东同步完成，共补 ${periods.length} 个报告期。`,
        payload: { periodCount: periods.length, rowCount: totalRows },
      }
    })
  }

  private async syncTop10FloatHoldersByPeriod(period: string): Promise<number> {
    const rows = await this.tushareApiService.getTop10FloatHoldersByPeriod(period)
    const periodDate = this.support.toDate(period)

    const mapped = rows.map(mapTop10FloatHoldersRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
    await this.support.replaceDateRangeRows('top10FloatHolders', 'endDate', periodDate, periodDate, mapped)
    return mapped.length
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
}
