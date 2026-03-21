import { Injectable } from '@nestjs/common'
import {
  StockExchange,
  TUSHARE_STOCK_LIST_STATUSES,
  TUSHARE_TRADE_CALENDAR_EXCHANGES,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { TushareSyncTask } from '@prisma/client'
import { TushareApiService } from '../tushare-api.service'
import { mapStockBasicRecord, mapStockCompanyRecord, mapTradeCalRecord } from '../tushare-sync.mapper'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareBasicSyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.STOCK_BASIC,
        category: 'basic',
        stage: 'beforeTradeDate',
        run: async () => this.checkStockBasicFreshness(),
      },
      {
        task: TushareSyncTaskName.TRADE_CAL,
        category: 'basic',
        stage: 'beforeTradeDate',
        run: async () => this.syncTradeCalendarCoverage(),
      },
      {
        task: TushareSyncTaskName.STOCK_COMPANY,
        category: 'basic',
        stage: 'afterTradeDate',
        run: async () => this.checkStockCompanyFreshness(),
      },
    ]
  }

  async checkStockBasicFreshness() {
    await this.support.executeTask(TushareSyncTaskName.STOCK_BASIC, async () => {
      const rowCount = await this.support.prisma.stockBasic.count()
      const latestSuccess = await this.support.getLatestSuccessfulTaskLog(TushareSyncTask.STOCK_BASIC)
      const todayKey = this.support.getCurrentShanghaiDateString()

      if (rowCount > 0 && latestSuccess?.startedAt && this.support.formatDate(latestSuccess.startedAt) === todayKey) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '股票列表今天已同步过，无需重复刷新。' }
      }

      const result = await Promise.all(
        TUSHARE_STOCK_LIST_STATUSES.map((status) => this.tushareApiService.getStockBasic(status)),
      )
      const deduped = new Map<string, ReturnType<typeof mapStockBasicRecord>>()
      result
        .flat()
        .map(mapStockBasicRecord)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .forEach((item) => deduped.set(item.tsCode, item))

      const count = await this.support.replaceAllRows('stockBasic', Array.from(deduped.values()))
      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股票列表同步完成，共写入 ${count} 条记录。`,
        payload: { rowCount: count },
      }
    })
  }

  async checkStockCompanyFreshness() {
    await this.support.executeTask(TushareSyncTaskName.STOCK_COMPANY, async () => {
      const rowCount = await this.support.prisma.stockCompany.count()
      const latestSuccess = await this.support.getLatestSuccessfulTaskLog(TushareSyncTask.STOCK_COMPANY)
      const todayKey = this.support.getCurrentShanghaiDateString()

      if (rowCount > 0 && latestSuccess?.startedAt && this.support.formatDate(latestSuccess.startedAt) === todayKey) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '上市公司基础信息今天已同步过。' }
      }

      const exchanges = [StockExchange.SSE, StockExchange.SZSE, StockExchange.BSE] as const
      const result = await Promise.all(exchanges.map((exchange) => this.tushareApiService.getStockCompany(exchange)))
      const deduped = new Map<string, ReturnType<typeof mapStockCompanyRecord>>()
      result
        .flat()
        .map(mapStockCompanyRecord)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .forEach((item) => deduped.set(item.tsCode, item))

      const count = await this.support.replaceAllRows('stockCompany', Array.from(deduped.values()))
      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `上市公司基础信息同步完成，共写入 ${count} 条记录。`,
        payload: { rowCount: count },
      }
    })
  }

  async syncTradeCalendarCoverage() {
    await this.support.executeTask(TushareSyncTaskName.TRADE_CAL, async () => {
      const startDate = this.support.syncStartDate
      const endDate = this.support.getCurrentShanghaiNow().add(365, 'day').format('YYYYMMDD')
      const windows = this.support.buildYearlyWindows(startDate, endDate)
      let totalRows = 0

      for (const exchange of TUSHARE_TRADE_CALENDAR_EXCHANGES) {
        const prismaExchange = this.support.toPrismaExchange(exchange)
        for (const window of windows) {
          const rows = await this.tushareApiService.getTradeCalendar(exchange, window.startDate, window.endDate)
          const mapped = rows.map(mapTradeCalRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))

          totalRows += await this.support.replaceDateRangeRows(
            'tradeCal',
            'calDate',
            this.support.toDate(window.startDate),
            this.support.toDate(window.endDate),
            mapped.filter((item) => item.exchange === prismaExchange),
            { exchange: prismaExchange },
          )
        }
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `交易日历覆盖区间已刷新：${startDate} ~ ${endDate}`,
        payload: { rowCount: totalRows, startDate, endDate },
      }
    })
  }
}
