import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  MoneyflowContentType,
  TUSHARE_MONEYFLOW_CONTENT_TYPES,
  TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { MoneyflowApiService } from '../api/moneyflow-api.service'
import {
  mapGgtDailyRecord,
  mapMoneyflowRecord,
  mapMoneyflowHsgtRecord,
  mapMoneyflowIndDcRecord,
  mapMoneyflowMktDcRecord,
} from '../tushare-sync.mapper'
import { TushareApiError } from '../api/tushare-client.service'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/**
 * MoneyflowSyncService — 资金流向同步
 *
 * 包含：个股资金流、行业/概念/地域资金流、大盘资金流
 *
 * 兼容策略：
 * - 默认仅同步最近 60 个交易日（2000 积分账户配额受限）
 * - 设置 TUSHARE_MONEYFLOW_FULL_HISTORY=true 可切换为全量模式
 * - 遇到当日配额耗尽（40203）自动跳过，不影响其他任务
 */
@Injectable()
export class MoneyflowSyncService {
  private readonly logger = new Logger(MoneyflowSyncService.name)
  private readonly fullHistory: boolean

  constructor(
    private readonly api: MoneyflowApiService,
    private readonly helper: SyncHelperService,
    private readonly configService: ConfigService,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    this.fullHistory = process.env.TUSHARE_MONEYFLOW_FULL_HISTORY === 'true'
    if (this.fullHistory) {
      this.logger.log('资金流向模式: 全量历史')
    } else {
      this.logger.log(`资金流向模式: 最近 ${TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS} 个交易日`)
    }
  }

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.MONEYFLOW,
        label: '个股资金流',
        category: 'moneyflow',
        order: 410,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 5 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步个股资金流',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncMoneyflow(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.MONEYFLOW_IND_DC,
        label: '行业资金流',
        category: 'moneyflow',
        order: 420,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 10 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步行业资金流',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncMoneyflowIndDc(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
        label: '大盘资金流',
        category: 'moneyflow',
        order: 430,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 15 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步大盘资金流',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncMoneyflowMktDc(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.MONEYFLOW_HSGT,
        label: '沪深港通资金流',
        category: 'moneyflow',
        order: 440,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 20 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步沪深港通资金流',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncMoneyflowHsgt(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.GGT_DAILY,
        label: '港股通每日成交',
        category: 'moneyflow',
        order: 365,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 25 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步港股通每日成交',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncGgtDaily(this.requireTradeDate(targetTradeDate), mode),
      },
    ]
  }

  // ─── 个股资金流 ────────────────────────────────────────────────────────────

  async syncMoneyflow(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.MONEYFLOW)
    await this.runSyncTemplate({
      task: TushareSyncTaskName.MONEYFLOW,
      label: '个股资金流',
      modelName: 'moneyflow',
      targetTradeDate,
      fullHistoryOverride: mode === 'full' ? true : undefined,
      fetchAndMap: async (td) => {
        const rows = await this.api.getMoneyflowByTradeDate(td)
        return rows.map((r) => mapMoneyflowRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 行业/概念/地域资金流 ──────────────────────────────────────────────────

  async syncMoneyflowIndDc(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.MONEYFLOW_IND_DC)
    await this.runSyncTemplate({
      task: TushareSyncTaskName.MONEYFLOW_IND_DC,
      label: '行业资金流',
      modelName: 'moneyflowIndDc',
      targetTradeDate,
      fullHistoryOverride: mode === 'full' ? true : undefined,
      fetchAndMap: async (td) => {
        let all: unknown[] = []
        for (const ct of TUSHARE_MONEYFLOW_CONTENT_TYPES) {
          const rows = await this.api.getMoneyflowIndDcByTradeDate(td, ct)
          const mapped = rows
            .map((r) => mapMoneyflowIndDcRecord(r, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
          all = all.concat(mapped)
        }
        return all
      },
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 大盘资金流 ────────────────────────────────────────────────────────────

  async syncMoneyflowMktDc(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.MONEYFLOW_MKT_DC)
    await this.runSyncTemplate({
      task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
      label: '大盘资金流',
      modelName: 'moneyflowMktDc',
      targetTradeDate,
      fullHistoryOverride: mode === 'full' ? true : undefined,
      fetchAndMap: async (td) => {
        const rows = await this.api.getMoneyflowMktDcByTradeDate(td)
        return rows
          .map((r) => mapMoneyflowMktDcRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用资金流向同步模板
  // ═══════════════════════════════════════════════════════════════════════════

  private async runSyncTemplate(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    targetTradeDate: string
    fullHistoryOverride?: boolean
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
  }): Promise<void> {
    const { task, label, modelName, targetTradeDate, fullHistoryOverride, fetchAndMap } = opts
    const useFullHistory = fullHistoryOverride ?? this.fullHistory

    if (!useFullHistory && (await this.helper.isTaskSyncedForTradeDate(task, targetTradeDate))) {
      this.logger.log(`[${label}] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()

    // 确定同步范围
    let tradeDates: string[]
    let retentionCutoff: Date | null = null

    if (useFullHistory) {
      // 全量模式：从本地最新日期 +1 开始
      const latestDate = await this.helper.getLatestDateString(modelName)
      const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate
      if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
        this.logger.log(`[${label}] 已是最新（全量模式）`)
        return
      }
      tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, targetTradeDate)
    } else {
      // 最近 N 天模式
      const recentDates = await this.helper.getRecentOpenTradeDates(
        targetTradeDate,
        TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS,
      )
      if (!recentDates.length) {
        this.logger.log(`[${label}] 无交易日，跳过`)
        return
      }
      retentionCutoff = this.helper.toDate(recentDates[0])
      // 只同步 recentDates 中尚未同步的
      const latestDate = await this.helper.getLatestDateString(modelName)
      if (latestDate) {
        tradeDates = recentDates.filter((d) => this.helper.compareDateString(d, latestDate) > 0)
      } else {
        tradeDates = recentDates
      }
    }

    if (!tradeDates.length) {
      this.logger.log(`[${label}] 无需同步`)
      return
    }

    this.logger.log(`[${label}] 开始同步 ${tradeDates.length} 个交易日`)
    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        totalRows += await this.helper.replaceTradeDateRows(modelName, this.helper.toDate(td), mapped)

        if (i === 0 || (i + 1) % 50 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        if (this.isDailyQuotaExceeded(error)) {
          this.logger.warn(`[${label}] 触发每日配额限制，已同步 ${i} 个交易日，剩余跳过`)
          this.logger.warn(`[${label}] 提示: 升级积分后可设置 TUSHARE_MONEYFLOW_FULL_HISTORY=true 获取全量数据`)
          break
        }
        const msg = (error as Error).message
        this.logger.error(`[${label}] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    // 清理超出保留窗口的旧数据
    if (retentionCutoff) {
      const deleted = await this.helper.deleteRowsBeforeDate(modelName, 'tradeDate', retentionCutoff)
      if (deleted > 0) {
        this.logger.log(`[${label}] 已清理 ${deleted} 条超出保留窗口的旧数据`)
      }
    }

    this.logger.log(`[${label}] 同步完成，${totalRows} 条${failed.length ? `，${failed.length} 个日期失败` : ''}`)
    await this.helper.writeSyncLog(
      task,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${label}同步完成，${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          fullHistory: useFullHistory,
          failedDates: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  private isDailyQuotaExceeded(error: unknown): boolean {
    return error instanceof TushareApiError && error.code === 40203 && /(每天|每小时)最多访问该接口/.test(error.message)
  }

  // ─── 沪深港通资金流向（北向/南向）─────────────────────────────────────────

  async syncMoneyflowHsgt(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (
      mode !== 'full' &&
      (await this.helper.isTaskSyncedForTradeDate(TushareSyncTaskName.MONEYFLOW_HSGT, targetTradeDate))
    ) {
      this.logger.log(`[沪深港通资金流] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()
    const latestDate = mode === 'full' ? null : await this.helper.getLatestDateString('moneyflowHsgt')
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log('[沪深港通资金流] 已是最新，无需同步')
      return
    }

    this.logger.log(`[沪深港通资金流] 拉取区间 ${startDate} → ${targetTradeDate}`)
    let totalRows = 0

    try {
      const rows = await this.api.getMoneyflowHsgtByDateRange(startDate, targetTradeDate)
      const collector = new ValidationCollector(TushareSyncTaskName.MONEYFLOW_HSGT)
      const mapped = rows
        .map((r) => mapMoneyflowHsgtRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))

      // 按日期幂等写入
      const tradeDate = this.helper.toDate(targetTradeDate)
      const startDateObj = this.helper.toDate(startDate)
      totalRows = await this.helper.replaceDateRangeRows('moneyflowHsgt', 'tradeDate', startDateObj, tradeDate, mapped)
      this.logger.log(`[沪深港通资金流] 同步完成，${totalRows} 条`)
      await this.helper.flushValidationLogs(collector)
    } catch (error) {
      if (this.isDailyQuotaExceeded(error)) {
        this.logger.warn('[沪深港通资金流] 触发每日配额限制，跳过')
        return
      }
      throw error
    }

    await this.helper.writeSyncLog(
      TushareSyncTaskName.MONEYFLOW_HSGT,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `沪深港通资金流同步完成，${totalRows} 条`,
        tradeDate: this.helper.toDate(targetTradeDate),
        payload: { rowCount: totalRows },
      },
      startedAt,
    )
  }

  // ─── 港股通每日成交 ────────────────────────────────────────────────────────

  async syncGgtDaily(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (
      mode !== 'full' &&
      (await this.helper.isTaskSyncedForTradeDate(TushareSyncTaskName.GGT_DAILY, targetTradeDate))
    ) {
      this.logger.log(`[港股通每日成交] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()
    const latestDate = mode === 'full' ? null : await this.helper.getLatestDateString('ggtDaily')
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log('[港股通每日成交] 已是最新，无需同步')
      return
    }

    this.logger.log(`[港股通每日成交] 拉取区间 ${startDate} → ${targetTradeDate}`)
    let totalRows = 0

    try {
      const rows = await this.api.getGgtDailyByDateRange(startDate, targetTradeDate)
      const collector = new ValidationCollector(TushareSyncTaskName.GGT_DAILY)
      const mapped = rows
        .map((r) => mapGgtDailyRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))

      const tradeDate = this.helper.toDate(targetTradeDate)
      const startDateObj = this.helper.toDate(startDate)
      totalRows = await this.helper.replaceDateRangeRows('ggtDaily', 'tradeDate', startDateObj, tradeDate, mapped)
      this.logger.log(`[港股通每日成交] 同步完成，${totalRows} 条`)
      await this.helper.flushValidationLogs(collector)
    } catch (error) {
      if (this.isDailyQuotaExceeded(error)) {
        this.logger.warn('[港股通每日成交] 触发每日配额限制，跳过')
        return
      }
      throw error
    }

    await this.helper.writeSyncLog(
      TushareSyncTaskName.GGT_DAILY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `港股通每日成交同步完成，${totalRows} 条`,
        tradeDate: this.helper.toDate(targetTradeDate),
        payload: { rowCount: totalRows },
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
