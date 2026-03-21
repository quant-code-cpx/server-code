import { Injectable } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TushareApiService } from '../tushare-api.service'
import { mapExpressRecord } from '../tushare-sync.mapper'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareFinancialPerformanceSyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.EXPRESS,
        category: 'financial-performance',
        stage: 'afterTradeDate',
        run: async () => this.checkExpressFreshness(),
      },
    ]
  }

  async checkExpressFreshness() {
    await this.support.executeTask(TushareSyncTaskName.EXPRESS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('express', 'annDate')
      const rangeStart = latestLocalDate ? this.support.addDays(latestLocalDate, 1) : this.support.syncStartDate
      const rangeEnd = this.support.getCurrentShanghaiDateString()

      if (this.support.compareDateString(rangeStart, rangeEnd) > 0) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '业绩快报已是最新，无需补数。' }
      }

      const windows = this.support.buildMonthlyWindows(rangeStart, rangeEnd)
      let totalRows = 0
      for (const window of windows) {
        totalRows += await this.syncExpressByDateRange(window.startDate, window.endDate)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `业绩快报同步完成，共同步 ${windows.length} 个时间窗口。`,
        payload: { windowCount: windows.length, rowCount: totalRows, startDate: rangeStart, endDate: rangeEnd },
      }
    })
  }

  private async syncExpressByDateRange(startDate: string, endDate: string) {
    const rows = await this.tushareApiService.getExpress(startDate, endDate)
    const mapped = rows.map(mapExpressRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceDateRangeRows(
      'express',
      'annDate',
      this.support.toDate(startDate),
      this.support.toDate(endDate),
      mapped,
    )
  }
}
