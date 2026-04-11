import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { OptionApiService } from '../api/option-api.service'
import { mapOptBasicRecord, mapOptDailyRecord } from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan, TushareSyncPlanContext } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/** 支持期权交易的交易所 */
const OPT_EXCHANGES = ['SSE', 'SZSE', 'CFFEX', 'DCE', 'SHFE', 'CZCE'] as const

/**
 * OptionSyncService — 期权数据同步
 *
 * 包含：期权合约信息 / 期权日线行情
 *
 * 策略：
 * - opt_basic: 按交易所逐一全量替换
 * - opt_daily: 按交易日增量（单次最大 15000 条）
 */
@Injectable()
export class OptionSyncService {
  private readonly logger = new Logger(OptionSyncService.name)

  constructor(
    private readonly api: OptionApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.OPT_BASIC,
        label: '期权合约信息',
        category: 'option',
        order: 710,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 9 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一刷新期权合约列表',
        },
        execute: () => this.syncOptBasic(),
      },
      {
        task: TushareSyncTaskName.OPT_DAILY,
        label: '期权日线行情',
        category: 'option',
        order: 720,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 0 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步期权日线',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncOptDaily(ctx),
      },
    ]
  }

  // ─── 期权合约信息（按交易所逐一全量替换）──────────────────────────────────

  async syncOptBasic(): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[期权合约] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.OPT_BASIC)
    const allMapped: NonNullable<ReturnType<typeof mapOptBasicRecord>>[] = []

    for (const exchange of OPT_EXCHANGES) {
      const rows = await this.api.getOptBasic(exchange)
      const mapped = rows
        .map((r) => mapOptBasicRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
      allMapped.push(...mapped)
      this.logger.log(`[期权合约] ${exchange}: ${mapped.length} 条`)
    }

    const count = await this.helper.replaceAllRows('optBasic', allMapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[期权合约] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.OPT_BASIC,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `期权合约同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── 期权日线行情（按交易日增量）──────────────────────────────────────────

  async syncOptDaily(ctx: TushareSyncPlanContext): Promise<void> {
    const targetTradeDate = this.requireTradeDate(ctx.targetTradeDate)
    const isFullSync = ctx.mode === 'full'
    const startedAt = new Date()

    if (!isFullSync && (await this.helper.isTaskSyncedForTradeDate(TushareSyncTaskName.OPT_DAILY, targetTradeDate))) {
      this.logger.log(`[期权日线] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const latestDate = isFullSync ? null : await this.helper.getLatestDateString('optDaily')
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log('[期权日线] 已是最新，无需同步')
      return
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, targetTradeDate)
    if (!tradeDates.length) {
      this.logger.log('[期权日线] 无交易日，跳过')
      return
    }

    this.logger.log(`[期权日线] 开始同步 ${tradeDates.length} 个交易日`)
    const collector = new ValidationCollector(TushareSyncTaskName.OPT_DAILY)
    let totalRows = 0

    for (const [i, td] of tradeDates.entries()) {
      const rows = await this.api.getOptDailyByTradeDate(td)
      const mapped = rows
        .map((r) => mapOptDailyRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))

      totalRows += await this.helper.replaceTradeDateRows('optDaily', this.helper.toDate(td), mapped)

      if (i === 0 || (i + 1) % 50 === 0 || i === tradeDates.length - 1) {
        ctx.onProgress?.(i + 1, tradeDates.length, td)
        this.logger.log(`[期权日线] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[期权日线] 同步完成，共 ${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.OPT_DAILY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `期权日线同步完成，共 ${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: { rowCount: totalRows, dateCount: tradeDates.length },
      },
      startedAt,
    )
  }

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) {
      throw new BusinessException(ErrorEnum.TUSHARE_TARGET_TRADE_DATE_REQUIRED)
    }
    return targetTradeDate
  }
}
