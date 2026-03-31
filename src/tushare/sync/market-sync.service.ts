import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { MarketApiService } from '../api/market-api.service'
import {
  mapAdjFactorRecord,
  mapDailyBasicRecord,
  mapDailyRecord,
  mapIndexDailyRecord,
  mapMarginDetailRecord,
  mapMonthlyRecord,
  mapWeeklyRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'

/**
 * MarketSyncService — 行情数据同步
 *
 * 同步顺序（按用户要求）：日线 → 周线 → 月线 → 每日指标 → 复权因子 → 核心指数
 *
 * 全部采用「按交易日拉全市场」策略，从本地最新日期 +1 天开始增量推进，
 * 保证全量覆盖。
 */
@Injectable()
export class MarketSyncService {
  private readonly logger = new Logger(MarketSyncService.name)

  constructor(
    private readonly api: MarketApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.DAILY,
        label: '日线行情',
        category: 'market',
        order: 110,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 30 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步日线行情',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncDaily(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.WEEKLY,
        label: '周线行情',
        category: 'market',
        order: 120,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 40 18 * * 5',
          timeZone: this.helper.syncTimeZone,
          description: '每周五盘后同步周线行情',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncWeekly(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.MONTHLY,
        label: '月线行情',
        category: 'market',
        order: 130,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 50 18 1 * *',
          timeZone: this.helper.syncTimeZone,
          description: '每月1日盘后补齐月线行情',
        },
        execute: ({ mode, targetTradeDate }) => this.syncMonthly(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.DAILY_BASIC,
        label: '每日指标',
        category: 'market',
        order: 140,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 35 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步每日指标',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncDailyBasic(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.ADJ_FACTOR,
        label: '复权因子',
        category: 'market',
        order: 150,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 45 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步复权因子',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncAdjFactor(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.INDEX_DAILY,
        label: '核心指数日线',
        category: 'market',
        order: 160,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 55 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步核心指数日线',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncIndexDaily(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.MARGIN_DETAIL,
        label: '融资融券明细',
        category: 'market',
        order: 170,
        bootstrapEnabled: false, // 需 2000 积分，默认不启用
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 5 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步融资融券明细（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncMarginDetail(this.requireTradeDate(targetTradeDate), mode),
      },
    ]
  }

  // ─── 日线 ──────────────────────────────────────────────────────────────────

  async syncDaily(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.DAILY,
      label: '日线',
      modelName: 'daily',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getDailyByTradeDate(td)
        return rows.map(mapDailyRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
  }

  // ─── 周线 ──────────────────────────────────────────────────────────────────

  async syncWeekly(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.WEEKLY,
      label: '周线',
      modelName: 'weekly',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getWeeklyByTradeDate(td)
        return rows.map(mapWeeklyRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getPeriodEndTradeDates(start, targetTradeDate, 'week'),
    })
  }

  // ─── 月线 ──────────────────────────────────────────────────────────────────

  async syncMonthly(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.MONTHLY,
      label: '月线',
      modelName: 'monthly',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getMonthlyByTradeDate(td)
        return rows.map(mapMonthlyRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getPeriodEndTradeDates(start, targetTradeDate, 'month'),
    })
  }

  // ─── 每日指标 ──────────────────────────────────────────────────────────────

  async syncDailyBasic(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.DAILY_BASIC,
      label: '每日指标',
      modelName: 'dailyBasic',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getDailyBasicByTradeDate(td)
        return rows.map(mapDailyBasicRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
  }

  // ─── 复权因子 ──────────────────────────────────────────────────────────────

  async syncAdjFactor(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.ADJ_FACTOR,
      label: '复权因子',
      modelName: 'adjFactor',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getAdjFactorByTradeDate(td)
        return rows.map(mapAdjFactorRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
  }

  // ─── 核心指数日线 ──────────────────────────────────────────────────────────
  // 只保留最近 2 年数据，不做历史全量同步

  async syncIndexDaily(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    if (
      mode !== 'full' &&
      (await this.helper.isTaskSyncedForTradeDate(TushareSyncTaskName.INDEX_DAILY, targetTradeDate))
    ) {
      this.logger.log('[核心指数日线] 目标交易日已同步，跳过')
      return
    }

    const startedAt = new Date()

    // 2 年前的第一天作为最早起始，避免回补所有历史
    const twoYearsAgo = new Date(this.helper.toDate(targetTradeDate))
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
    const earliestStart = this.helper.formatDate(twoYearsAgo)

    const latestDate = mode === 'full' ? null : await this.helper.getLatestDateString('indexDaily')
    const rawStart = latestDate ? this.helper.addDays(latestDate, 1) : earliestStart
    // 不允许起始日期早于 2 年前
    const startDate = this.helper.compareDateString(rawStart, earliestStart) < 0 ? earliestStart : rawStart

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log('[核心指数日线] 已是最新，无需同步')
      return
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, targetTradeDate)
    if (!tradeDates.length) {
      this.logger.log('[核心指数日线] 无可同步的交易日，跳过')
      return
    }

    this.logger.log(
      `[核心指数日线] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []

    for (const [i, td] of tradeDates.entries()) {
      try {
        const rows = await this.api.getCoreIndexDailyByTradeDate(td)
        const mapped = rows.map(mapIndexDailyRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
        totalRows += await this.helper.replaceTradeDateRows('indexDaily', this.helper.toDate(td), mapped)
        if (i === 0 || (i + 1) % 100 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[核心指数日线] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[核心指数日线] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    this.logger.log(`[核心指数日线] 同步完成，${totalRows} 条${failed.length ? `，${failed.length} 个日期失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.INDEX_DAILY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `核心指数日线同步完成，${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          failedDates: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用按交易日同步模板
  // ═══════════════════════════════════════════════════════════════════════════

  private async syncByTradeDate(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    targetTradeDate: string
    fullSync?: boolean
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
    resolveDates: (startDate: string) => Promise<string[]>
  }): Promise<void> {
    const { task, label, modelName, targetTradeDate, fullSync = false, fetchAndMap, resolveDates } = opts

    // 1. 目标交易日已同步则跳过（避免“今天已经跑过一次 25 号数据”导致 26 号盘后被误跳过）
    if (!fullSync && (await this.helper.isTaskSyncedForTradeDate(task, targetTradeDate))) {
      this.logger.log(`[${label}] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()

    // 2. 计算起始日期
    const latestDate = fullSync ? null : await this.helper.getLatestDateString(modelName)
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log(`[${label}] 已是最新（本地最新: ${latestDate}），无需同步`)
      return
    }

    // 3. 获取待同步的交易日
    const tradeDates = await resolveDates(startDate)
    if (!tradeDates.length) {
      this.logger.log(`[${label}] ${startDate} ~ ${targetTradeDate} 间无交易日，跳过`)
      return
    }

    this.logger.log(
      `[${label}] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    // 4. 逐日拉取，容错处理
    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        totalRows += await this.helper.replaceTradeDateRows(modelName, this.helper.toDate(td), mapped)

        // 进度日志
        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[${label}] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    // 5. 兜底重试失败日期
    if (failed.length > 0) {
      this.logger.warn(`[${label}] ${failed.length} 个日期失败，开始兜底重试...`)
      const stillFailed: Array<{ date: string; error: string }> = []
      for (const item of failed) {
        try {
          const mapped = await fetchAndMap(item.date)
          totalRows += await this.helper.replaceTradeDateRows(modelName, this.helper.toDate(item.date), mapped)
          this.logger.log(`[${label}] ${item.date} 重试成功`)
        } catch (error) {
          const msg = (error as Error).message
          this.logger.error(`[${label}] ${item.date} 重试仍失败: ${msg}`)
          stillFailed.push({ date: item.date, error: msg })
        }
      }

      if (stillFailed.length > 0) {
        this.logger.error(
          `[${label}] 仍有 ${stillFailed.length} 个日期失败: ${stillFailed.map((f) => f.date).join(', ')}`,
        )
      }
    }

    // 6. 写入同步日志
    const status = failed.length === 0 ? TushareSyncExecutionStatus.SUCCESS : TushareSyncExecutionStatus.SUCCESS
    await this.helper.writeSyncLog(
      task,
      {
        status,
        message: `${label}同步完成，${totalRows} 条，${failed.length} 个日期曾失败`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          startDate: tradeDates[0],
          endDate: tradeDates[tradeDates.length - 1],
          failedDates: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ─── 融资融券明细 ──────────────────────────────────────────────────────────
  // 只保留近 120 个交易日数据，需 Tushare 2000 积分

  async syncMarginDetail(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDate({
      task: TushareSyncTaskName.MARGIN_DETAIL,
      label: '融资融券明细',
      modelName: 'marginDetail',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getMarginDetailByTradeDate(td)
        return rows.map(mapMarginDetailRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: async (start) => {
        const allDates = await this.helper.getOpenTradeDatesBetween(start, targetTradeDate)
        // 只保留近 120 个交易日
        return allDates.slice(-120)
      },
    })
  }

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) {
      throw new Error('targetTradeDate is required for market sync plan')
    }
    return targetTradeDate
  }
}
