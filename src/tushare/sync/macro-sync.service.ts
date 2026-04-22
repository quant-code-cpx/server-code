import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { MacroApiService } from '../api/macro-api.service'
import { mapMacroCpiRecord, mapMacroGdpRecord, mapMacroPpiRecord, mapMacroShiborRecord } from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncPlan, TushareSyncPlanContext } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/**
 * MacroSyncService — 宏观经济指标同步
 *
 * 包含：CPI / PPI / GDP / Shibor
 *
 * 策略：
 * - CPI / PPI / GDP 数据量极小，均采用全量替换
 * - Shibor 按日期增量追加，全量回补时分批拉取
 */
@Injectable()
export class MacroSyncService {
  private readonly logger = new Logger(MacroSyncService.name)

  constructor(
    private readonly api: MacroApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.CN_CPI,
        label: 'CPI 居民消费价格指数',
        category: 'macro',
        order: 610,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 10 15 * *',
          timeZone: this.helper.syncTimeZone,
          description: '每月 15 日刷新 CPI 数据',
        },
        execute: () => this.syncCpi(),
      },
      {
        task: TushareSyncTaskName.CN_PPI,
        label: 'PPI 工业品出厂价格指数',
        category: 'macro',
        order: 620,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 5 10 15 * *',
          timeZone: this.helper.syncTimeZone,
          description: '每月 15 日刷新 PPI 数据',
        },
        execute: () => this.syncPpi(),
      },
      {
        task: TushareSyncTaskName.CN_GDP,
        label: 'GDP 国内生产总值',
        category: 'macro',
        order: 630,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 10 10 20 1,4,7,10 *',
          timeZone: this.helper.syncTimeZone,
          description: '每季度刷新 GDP 数据',
        },
        execute: () => this.syncGdp(),
      },
      {
        task: TushareSyncTaskName.SHIBOR,
        label: 'Shibor 利率',
        category: 'macro',
        order: 640,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 12 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '每个工作日同步 Shibor 利率',
        },
        execute: (ctx) => this.syncShibor(ctx),
      },
    ]
  }

  // ─── CPI ───────────────────────────────────────────────────────────────────

  async syncCpi(): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[CPI] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.CN_CPI)
    const rows = await this.api.getCpi()
    const mapped = rows
      .map((r) => mapMacroCpiRecord(r, collector))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))

    const count = await this.helper.replaceAllRows('macroCpi', mapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[CPI] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CN_CPI,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `CPI 同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── PPI ───────────────────────────────────────────────────────────────────

  async syncPpi(): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[PPI] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.CN_PPI)
    const rows = await this.api.getPpi()
    const mapped = rows
      .map((r) => mapMacroPpiRecord(r, collector))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))

    const count = await this.helper.replaceAllRows('macroPpi', mapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[PPI] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CN_PPI,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `PPI 同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── GDP ───────────────────────────────────────────────────────────────────

  async syncGdp(): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[GDP] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.CN_GDP)
    const rows = await this.api.getGdp()
    const mapped = rows
      .map((r) => mapMacroGdpRecord(r, collector))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))

    const count = await this.helper.replaceAllRows('macroGdp', mapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[GDP] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CN_GDP,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `GDP 同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }

  // ─── Shibor ────────────────────────────────────────────────────────────────

  async syncShibor(ctx?: TushareSyncPlanContext): Promise<void> {
    const isFullSync = ctx?.mode === 'full'
    const startedAt = new Date()

    // 增量：从本地最新日期 +1 天开始
    const latestDate = isFullSync ? null : await this.helper.getLatestDateString('macroShibor', 'date')
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : '20150101' // Shibor 从 2006 年开始，但 2015 年前数据对量化实用价值有限
    const todayStr = this.helper.formatDate(new Date())

    if (this.helper.compareDateString(startDate, todayStr) > 0) {
      this.logger.log('[Shibor] 已是最新，无需同步')
      return
    }

    this.logger.log(`[Shibor] 开始同步 ${startDate} → ${todayStr}${isFullSync ? '（全量模式）' : ''}`)

    const collector = new ValidationCollector(TushareSyncTaskName.SHIBOR)
    const rows = await this.api.getShibor(startDate, todayStr)
    const mapped = rows
      .map((r) => mapMacroShiborRecord(r, collector))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))

    let count: number
    if (isFullSync) {
      count = await this.helper.replaceAllRows('macroShibor', mapped)
    } else if (mapped.length > 0) {
      // 增量：按日期范围写入
      const startDateObj = this.helper.toDate(startDate)
      const endDateObj = this.helper.toDate(todayStr)
      count = await this.helper.replaceDateRangeRows('macroShibor', 'date', startDateObj, endDateObj, mapped)
    } else {
      count = 0
    }

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[Shibor] 同步完成，共 ${count} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.SHIBOR,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `Shibor 同步完成，共 ${count} 条`,
        payload: { rowCount: count },
      },
      startedAt,
    )
  }
}
