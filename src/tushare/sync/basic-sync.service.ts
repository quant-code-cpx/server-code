import { Injectable, Logger } from '@nestjs/common'
import {
  StockExchange,
  TUSHARE_STOCK_LIST_STATUSES,
  TUSHARE_TRADE_CALENDAR_EXCHANGES,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { BasicApiService } from '../api/basic-api.service'
import {
  mapCbBasicRecord,
  mapIndexClassifyRecord,
  mapIndexMemberAllRecord,
  mapStockBasicRecord,
  mapStockCompanyRecord,
  mapTradeCalRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

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
      {
        task: TushareSyncTaskName.INDEX_CLASSIFY,
        label: '申万行业分类',
        category: 'basic',
        order: 50,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 6 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一早晨全量刷新申万行业分类',
        },
        execute: ({ mode }) => this.syncIndexClassify(mode),
      },
      {
        task: TushareSyncTaskName.INDEX_MEMBER_ALL,
        label: '申万行业成分',
        category: 'basic',
        order: 55,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 30 6 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一刷新申万行业成分股',
        },
        execute: ({ mode }) => this.syncIndexMemberAll(mode),
      },
      {
        task: TushareSyncTaskName.CB_BASIC,
        label: '可转债基础信息',
        category: 'basic',
        order: 60,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 7 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一全量刷新可转债基础信息',
        },
        execute: ({ mode }) => this.syncCbBasic(mode),
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

  // ─── 申万行业分类 ──────────────────────────────────────────────────────────

  async syncIndexClassify(_mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[申万行业分类] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.INDEX_CLASSIFY)
    const levels = ['L1', 'L2', 'L3'] as const
    const allRows: Awaited<ReturnType<typeof mapIndexClassifyRecord>>[] = []

    for (const level of levels) {
      const rows = await this.api.getIndexClassify(level)
      rows
        .map((r) => mapIndexClassifyRecord(r, collector))
        .forEach((m) => {
          if (m) allRows.push(m)
        })
    }

    const deduped = new Map<string, NonNullable<(typeof allRows)[number]>>()
    allRows.filter((r): r is NonNullable<typeof r> => Boolean(r)).forEach((r) => deduped.set(r.indexCode, r))

    const count = await this.helper.replaceAllRows('indexClassify', Array.from(deduped.values()))

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[申万行业分类] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.INDEX_CLASSIFY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `申万行业分类同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── 申万行业成分 ──────────────────────────────────────────────────────────

  async syncIndexMemberAll(_mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[申万行业成分] 开始全量同步...')

    // 从 index_classify 表获取所有 L1 代码
    const l1Records = await (this.helper.prisma as any).indexClassify.findMany({
      where: { level: 'L1' },
      select: { indexCode: true },
    })
    const l1Codes: string[] = l1Records.map((r: { indexCode: string }) => r.indexCode)

    if (!l1Codes.length) {
      this.logger.warn('[申万行业成分] L1 行业分类为空，请先同步 INDEX_CLASSIFY')
      return
    }

    this.logger.log(`[申万行业成分] 将遍历 ${l1Codes.length} 个一级行业`)

    const collector = new ValidationCollector(TushareSyncTaskName.INDEX_MEMBER_ALL)
    let totalRows = 0

    for (const l1Code of l1Codes) {
      const rows = await this.api.getIndexMemberAllByL1Code(l1Code)
      const mapped = rows
        .map((r) => mapIndexMemberAllRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))

      if (mapped.length > 0) {
        const count = await (this.helper.prisma as any).indexMemberAll.createMany({
          data: mapped,
          skipDuplicates: true,
        })
        totalRows += count.count
      }
    }

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[申万行业成分] 同步完成，共 ${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.INDEX_MEMBER_ALL,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `申万行业成分同步完成，${l1Codes.length} 个一级行业，共 ${totalRows} 条`,
        payload: { rowCount: totalRows, l1Count: l1Codes.length },
      },
      startedAt,
    )
  }

  // ─── 可转债基础信息 ────────────────────────────────────────────────────────

  async syncCbBasic(_mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[可转债基础信息] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.CB_BASIC)
    const rows = await this.api.getCbBasicAll()
    const mapped = rows.map((r) => mapCbBasicRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))

    const count = await this.helper.replaceAllRows('cbBasic', mapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[可转债基础信息] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CB_BASIC,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `可转债基础信息同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }
}
