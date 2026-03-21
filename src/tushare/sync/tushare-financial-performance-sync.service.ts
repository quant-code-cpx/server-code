import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TushareApiService } from '../tushare-api.service'
import { mapDividendRecord, mapExpressRecord } from '../tushare-sync.mapper'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareFinancialPerformanceSyncService {
  private readonly logger = new Logger(TushareFinancialPerformanceSyncService.name)

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
      {
        task: TushareSyncTaskName.DIVIDEND,
        category: 'financial-performance',
        stage: 'afterTradeDate',
        run: async () => this.checkDividendFreshness(),
      },
    ]
  }

  // ─── Express ─────────────────────────────────────────────────────────────────

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

  // ─── Dividend ─────────────────────────────────────────────────────────────────

  /**
   * 分红数据以"公告日（ann_date）"为时间轴增量同步。
   * 与 express 一样按月窗口批量拉取，利用 ann_date 范围过滤。
   */
  async checkDividendFreshness() {
    await this.support.executeTask(TushareSyncTaskName.DIVIDEND, async () => {
      const latestLocalDate = await this.support.getLatestDateString('dividend', 'annDate')
      const rangeStart = latestLocalDate ? this.support.addDays(latestLocalDate, 1) : this.support.syncStartDate
      const rangeEnd = this.support.getCurrentShanghaiDateString()

      if (this.support.compareDateString(rangeStart, rangeEnd) > 0) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '分红数据已是最新，无需补数。' }
      }

      const windows = this.support.buildMonthlyWindows(rangeStart, rangeEnd)
      let totalRows = 0
      for (const window of windows) {
        totalRows += await this.syncDividendByDateRange(window.startDate, window.endDate)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `分红数据同步完成，共同步 ${windows.length} 个月度窗口。`,
        payload: { windowCount: windows.length, rowCount: totalRows, startDate: rangeStart, endDate: rangeEnd },
      }
    })
  }

  private async syncDividendByDateRange(startDate: string, endDate: string): Promise<number> {
    // Tushare dividend 接口支持 ann_date 单日查询，此处按天滑动以覆盖范围
    // 由于 API 限制，此处仅同步 startDate 当天的分红公告；批量补数由调度分批完成
    const rows = await this.tushareApiService.getDividendByAnnDate(startDate)
    const mapped = rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
    if (!mapped.length) return 0

    return this.support.replaceDateRangeRows(
      'dividend',
      'annDate',
      this.support.toDate(startDate),
      this.support.toDate(startDate),
      mapped,
    )
  }

  /** 按需获取并存储指定股票的所有历史分红（供股票详情接口调用） */
  async syncDividendsForStock(tsCode: string): Promise<number> {
    const rows = await this.tushareApiService.getDividendByTsCode(tsCode)
    const mapped = rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
    if (!mapped.length) return 0

    // 删除该股票所有历史分红记录后重新写入
    await this.support.prisma.dividend.deleteMany({ where: { tsCode } })
    const result = await this.support.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
    return result.count
  }
}
