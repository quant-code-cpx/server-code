import { Injectable, Logger } from '@nestjs/common'
import {
  StockExchange,
  TUSHARE_STOCK_LIST_STATUSES,
  TUSHARE_TRADE_CALENDAR_EXCHANGES,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { BasicApiService } from '../api/basic-api.service'
import { mapStockBasicRecord, mapStockCompanyRecord, mapTradeCalRecord } from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'

/**
 * BasicSyncService — 基础数据同步
 *
 * 包含：股票列表、交易日历、上市公司信息
 * 全部为全量刷新（delete + insert）
 */
@Injectable()
export class BasicSyncService {
  private readonly logger = new Logger(BasicSyncService.name)

  constructor(
    private readonly api: BasicApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.STOCK_BASIC,
        label: '股票列表',
        category: 'basic',
        order: 10,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 10 8 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日早盘前刷新股票列表',
        },
        execute: ({ mode }) => this.syncStockBasic(mode),
      },
      {
        task: TushareSyncTaskName.TRADE_CAL,
        label: '交易日历',
        category: 'basic',
        order: 20,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 15 8 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日早盘前刷新交易日历',
        },
        execute: ({ mode }) => this.syncTradeCal(mode),
      },
      {
        task: TushareSyncTaskName.STOCK_COMPANY,
        label: '公司信息',
        category: 'basic',
        order: 30,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 20 8 * * *',
          timeZone: this.helper.syncTimeZone,
          description: '每日早盘前刷新上市公司信息',
        },
        execute: ({ mode }) => this.syncStockCompany(mode),
      },
    ]
  }

  // ─── 股票列表 ──────────────────────────────────────────────────────────────

  async syncStockBasic(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode !== 'full' && (await this.helper.isTaskSyncedToday(TushareSyncTaskName.STOCK_BASIC))) {
      this.logger.log('[股票列表] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    this.logger.log('[股票列表] 开始同步...')

    const results = await Promise.all(TUSHARE_STOCK_LIST_STATUSES.map((status) => this.api.getStockBasic(status)))

    // 按 ts_code 去重
    const deduped = new Map<string, ReturnType<typeof mapStockBasicRecord>>()
    results
      .flat()
      .map((r) => mapStockBasicRecord(r))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .forEach((item) => deduped.set(item.tsCode, item))

    const count = await this.helper.replaceAllRows('stockBasic', Array.from(deduped.values()))

    this.logger.log(`[股票列表] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.STOCK_BASIC,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股票列表同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── 交易日历 ──────────────────────────────────────────────────────────────

  async syncTradeCal(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode !== 'full' && (await this.helper.isTaskSyncedToday(TushareSyncTaskName.TRADE_CAL))) {
      this.logger.log('[交易日历] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    this.logger.log('[交易日历] 开始同步...')

    const startDate = this.helper.syncStartDate
    const endDate = this.helper.getCurrentShanghaiNow().add(365, 'day').format('YYYYMMDD')
    const windows = this.helper.buildYearlyWindows(startDate, endDate)
    let totalRows = 0

    for (const exchange of TUSHARE_TRADE_CALENDAR_EXCHANGES) {
      const prismaExchange = this.helper.toPrismaExchange(exchange)
      for (const window of windows) {
        const rows = await this.api.getTradeCalendar(exchange, window.startDate, window.endDate)
        const mapped = rows
          .map((r) => mapTradeCalRecord(r))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter((item) => item.exchange === prismaExchange)

        totalRows += await this.helper.replaceDateRangeRows(
          'tradeCal',
          'calDate',
          this.helper.toDate(window.startDate),
          this.helper.toDate(window.endDate),
          mapped,
          { exchange: prismaExchange },
        )
      }
    }

    this.logger.log(`[交易日历] 同步完成，覆盖 ${startDate} ~ ${endDate}，共 ${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.TRADE_CAL,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `交易日历覆盖 ${startDate} ~ ${endDate}`,
        payload: { rowCount: totalRows, startDate, endDate },
      },
      startedAt,
    )
  }

  // ─── 上市公司信息 ──────────────────────────────────────────────────────────

  async syncStockCompany(mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (mode !== 'full' && (await this.helper.isTaskSyncedToday(TushareSyncTaskName.STOCK_COMPANY))) {
      this.logger.log('[公司信息] 今日已同步，跳过')
      return
    }

    const startedAt = new Date()
    this.logger.log('[公司信息] 开始同步...')

    const exchanges = [StockExchange.SSE, StockExchange.SZSE, StockExchange.BSE] as const
    const results = await Promise.all(exchanges.map((ex) => this.api.getStockCompany(ex)))

    const deduped = new Map<string, ReturnType<typeof mapStockCompanyRecord>>()
    results
      .flat()
      .map((r) => mapStockCompanyRecord(r))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .forEach((item) => deduped.set(item.tsCode, item))

    const count = await this.helper.replaceAllRows('stockCompany', Array.from(deduped.values()))

    this.logger.log(`[公司信息] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.STOCK_COMPANY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `上市公司信息同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }
}
