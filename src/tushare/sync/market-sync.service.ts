import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { MarketApiService } from '../api/market-api.service'
import {
  mapAdjFactorRecord,
  mapCbDailyRecord,
  mapCyqChipsRecord,
  mapCyqPerfRecord,
  mapDailyBasicRecord,
  mapDailyInfoRecord,
  mapDailyRecord,
  mapIndexDailyBasicRecord,
  mapIndexDailyRecord,
  mapMarginDetailRecord,
  mapMonthlyRecord,
  mapStkMinsRecord,
  mapThsDailyRecord,
  mapWeeklyRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan, TushareSyncPlanContext } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

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
        execute: (ctx) => this.syncDaily(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
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
        execute: (ctx) => this.syncWeekly(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
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
        execute: (ctx) => this.syncMonthly(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
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
        execute: (ctx) => this.syncDailyBasic(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
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
        execute: (ctx) => this.syncAdjFactor(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
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
        execute: (ctx) => this.syncIndexDaily(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
      },
      {
        task: TushareSyncTaskName.MARGIN_DETAIL,
        label: '融资融券明细',
        category: 'market',
        order: 170,
        bootstrapEnabled: true, // 用户积分 ≥ 2000，已启用
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 5 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步融资融券明细（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncMarginDetail(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
      },
      {
        task: TushareSyncTaskName.INDEX_DAILY_BASIC,
        label: '指数每日指标',
        category: 'market',
        order: 175,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 30 17 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步大盘指数估值指标',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncIndexDailyBasic(this.requireTradeDate(ctx.targetTradeDate), ctx.mode),
      },
      {
        task: TushareSyncTaskName.CB_DAILY,
        label: '可转债日行情',
        category: 'market',
        order: 180,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 45 17 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘同步可转债日行情',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncCbDaily(this.requireTradeDate(ctx.targetTradeDate), ctx.mode),
      },
      {
        task: TushareSyncTaskName.DAILY_INFO,
        label: '每日市场全景',
        category: 'market',
        order: 190,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 50 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步各交易所整体行情统计',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncDailyInfo(this.requireTradeDate(ctx.targetTradeDate), ctx.mode),
      },
      {
        task: TushareSyncTaskName.CYQ_PERF,
        label: '筹码获利比例',
        category: 'market',
        order: 195,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 0 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步筹码获利比例',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncCyqPerf(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
      },
      {
        task: TushareSyncTaskName.CYQ_CHIPS,
        label: '筹码分布',
        category: 'market',
        order: 196,
        bootstrapEnabled: false,
        supportsManual: true,
        supportsFullSync: false,
        requiresTradeDate: true,
        schedule: {
          cron: '0 30 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步筹码分布（按股票逐只）',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncCyqChips(ctx),
      },
      {
        task: TushareSyncTaskName.STK_MINS,
        label: '分钟级行情',
        category: 'market',
        order: 198,
        bootstrapEnabled: false,
        supportsManual: true,
        supportsFullSync: false,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 21 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步分钟级行情（按股票逐只）',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncStkMins(ctx),
      },
      {
        task: TushareSyncTaskName.THS_DAILY,
        label: '同花顺板块日线',
        category: 'market',
        order: 199,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 10 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步同花顺板块指数日线',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncThsDaily(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx),
      },
    ]
  }

  // ─── 日线 ──────────────────────────────────────────────────────────────────

  async syncDaily(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.DAILY)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.DAILY,
      label: '日线',
      modelName: 'daily',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getDailyByTradeDate(td)
        return rows.map((r) => mapDailyRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 周线 ──────────────────────────────────────────────────────────────────

  async syncWeekly(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.WEEKLY)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.WEEKLY,
      label: '周线',
      modelName: 'weekly',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getWeeklyByTradeDate(td)
        return rows.map((r) => mapWeeklyRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getPeriodEndTradeDates(start, targetTradeDate, 'week'),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 月线 ──────────────────────────────────────────────────────────────────

  async syncMonthly(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.MONTHLY)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.MONTHLY,
      label: '月线',
      modelName: 'monthly',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getMonthlyByTradeDate(td)
        return rows.map((r) => mapMonthlyRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getPeriodEndTradeDates(start, targetTradeDate, 'month'),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 每日指标 ──────────────────────────────────────────────────────────────

  async syncDailyBasic(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.DAILY_BASIC)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.DAILY_BASIC,
      label: '每日指标',
      modelName: 'dailyBasic',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getDailyBasicByTradeDate(td)
        return rows.map((r) => mapDailyBasicRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 复权因子 ──────────────────────────────────────────────────────────────

  async syncAdjFactor(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.ADJ_FACTOR)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.ADJ_FACTOR,
      label: '复权因子',
      modelName: 'adjFactor',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getAdjFactorByTradeDate(td)
        return rows.map((r) => mapAdjFactorRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 核心指数日线 ──────────────────────────────────────────────────────────
  // 只保留最近 2 年数据，不做历史全量同步

  async syncIndexDaily(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
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
    const collector = new ValidationCollector(TushareSyncTaskName.INDEX_DAILY)

    for (const [i, td] of tradeDates.entries()) {
      try {
        const rows = await this.api.getCoreIndexDailyByTradeDate(td)
        const mapped = rows
          .map((r) => mapIndexDailyRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        totalRows += await this.helper.replaceTradeDateRows('indexDaily', this.helper.toDate(td), mapped)
        if (i === 0 || (i + 1) % 100 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[核心指数日线] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
        context?.onProgress?.(i + 1, tradeDates.length, td)
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[核心指数日线] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    this.logger.log(`[核心指数日线] 同步完成，${totalRows} 条${failed.length ? `，${failed.length} 个日期失败` : ''}`)
    await this.helper.flushValidationLogs(collector)
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

  private async syncByTradeDate(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    targetTradeDate: string
    fullSync?: boolean
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
    resolveDates: (startDate: string) => Promise<string[]>
    onProgress?: (completed: number, total: number, currentKey?: string) => void
  }): Promise<void> {
    const { task, label, modelName, targetTradeDate, fullSync = false, fetchAndMap, resolveDates, onProgress } = opts

    // 1. 目标交易日已同步则跳过（避免"今天已经跑过一次 25 号数据"导致 26 号盘后被误跳过）
    if (!fullSync && (await this.helper.isTaskSyncedForTradeDate(task, targetTradeDate))) {
      this.logger.log(`[${label}] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()

    // 2. 计算起始日期（全量同步时先重置断点）
    let startDate: string
    if (fullSync) {
      await this.helper.resetProgress(task)
      startDate = this.helper.syncStartDate
    } else {
      // 优先使用断点续传键，回退到 DB 最新日期
      const resumeKey = await this.helper.getResumeKey(task)
      if (resumeKey) {
        startDate = this.helper.addDays(resumeKey, 1)
        this.logger.log(`[${label}] 从断点 ${resumeKey} 恢复，起始 ${startDate}`)
      } else {
        const latestDate = await this.helper.getLatestDateString(modelName)
        startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate
      }
    }

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log(`[${label}] 已是最新（起始 ${startDate} > 目标 ${targetTradeDate}），无需同步`)
      await this.helper.markCompleted(task)
      return
    }

    // 3. 获取待同步的交易日
    const tradeDates = await resolveDates(startDate)
    if (!tradeDates.length) {
      this.logger.log(`[${label}] ${startDate} ~ ${targetTradeDate} 间无交易日，跳过`)
      await this.helper.markCompleted(task)
      return
    }

    this.logger.log(
      `[${label}] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    // 4. 逐日拉取，容错处理
    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    /** 断点更新间隔（每 N 个成功日期写一次，减少 DB 压力） */
    const CHECKPOINT_INTERVAL = 50

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        totalRows += await this.helper.replaceTradeDateRows(modelName, this.helper.toDate(td), mapped)

        // 进度日志
        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }

        // 断点续传：每 CHECKPOINT_INTERVAL 个成功日期写一次（最后一个也写）
        if ((i + 1) % CHECKPOINT_INTERVAL === 0 || i === tradeDates.length - 1) {
          await this.helper.updateProgress(task, td, i + 1, tradeDates.length)
        }

        // 进度回调（节流由上层 runPlans 控制）
        onProgress?.(i + 1, tradeDates.length, td)
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[${label}] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    // 5. 兜底重试失败日期
    const stillFailed: Array<{ date: string; error: string }> = []
    if (failed.length > 0) {
      this.logger.warn(`[${label}] ${failed.length} 个日期失败，开始兜底重试...`)
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

      // 持久化失败入队重试
      if (stillFailed.length > 0) {
        this.logger.error(
          `[${label}] 仍有 ${stillFailed.length} 个日期失败: ${stillFailed.map((f) => f.date).join(', ')}`,
        )
        for (const item of stillFailed) {
          await this.helper
            .enqueueRetry(task, item.date, item.error)
            .catch((err) => this.logger.warn(`[${label}] 入队重试失败: ${(err as Error).message}`))
        }
      }
    }

    // 6. 标记完成 + 写入同步日志
    await this.helper.markCompleted(task)
    const finalStatus = stillFailed.length > 0 ? TushareSyncExecutionStatus.FAILED : TushareSyncExecutionStatus.SUCCESS
    await this.helper.writeSyncLog(
      task,
      {
        status: finalStatus,
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

  async syncMarginDetail(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.MARGIN_DETAIL)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.MARGIN_DETAIL,
      label: '融资融券明细',
      modelName: 'marginDetail',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getMarginDetailByTradeDate(td)
        return rows
          .map((r) => mapMarginDetailRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: async (start) => {
        const allDates = await this.helper.getOpenTradeDatesBetween(start, targetTradeDate)
        // 只保留近 120 个交易日
        return allDates.slice(-120)
      },
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) {
      throw new BusinessException(ErrorEnum.TUSHARE_TARGET_TRADE_DATE_REQUIRED)
    }
    return targetTradeDate
  }

  // ─── 大盘指数每日指标 ────────────────────────────────────────────────────────────

  async syncIndexDailyBasic(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()

    const latestDate = mode === 'full' ? null : await this.helper.getLatestDateString('indexDailyBasic', 'tradeDate')
    // index_dailybasic 数据从 2004 年开始提供
    const syncStart = latestDate ? this.helper.addDays(latestDate, 1) : '20040102'

    if (this.helper.compareDateString(syncStart, targetTradeDate) > 0) {
      this.logger.log(`[指数每日指标] 已是最新（本地最新: ${latestDate}），无需同步`)
      return
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(syncStart, targetTradeDate)
    if (!tradeDates.length) {
      this.logger.log(`[指数每日指标] ${syncStart} ~ ${targetTradeDate} 间无交易日，跳过`)
      return
    }

    this.logger.log(
      `[指数每日指标] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const collector = new ValidationCollector(TushareSyncTaskName.INDEX_DAILY_BASIC)

    for (const [i, td] of tradeDates.entries()) {
      try {
        const rows = await this.api.getIndexDailyBasicByTradeDate(td)
        const mapped = rows
          .map((r) => mapIndexDailyBasicRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        const tradeDateTime = this.helper.toDate(td)
        const count = await this.helper.replaceTradeDateRows('indexDailyBasic', tradeDateTime, mapped)
        totalRows += count

        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[指数每日指标] 进度 ${i + 1}/${tradeDates.length}，交易日 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[指数每日指标] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.INDEX_DAILY_BASIC,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `指数每日指标同步完成，${tradeDates.length} 个交易日，共 ${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          ...(failed.length > 0 && { failedDates: failed }),
        },
      },
      startedAt,
    )
  }

  // ─── 可转债日行情 ──────────────────────────────────────────────

  async syncCbDaily(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let tradeDates: string[]
    if (mode === 'full') {
      // 全量：从 2018-01-01 起（可转债市场扩容起点）
      tradeDates = await this.helper.getOpenTradeDatesBetween('20180101', today)
    } else {
      // 增量：最近 5 个交易日
      tradeDates = await this.helper.getOpenTradeDatesBetween(this.helper.addDays(targetTradeDate, -4), targetTradeDate)
    }

    if (!tradeDates.length) {
      this.logger.log('[可转债日行情] 无交易日数据，跳过')
      return
    }

    this.logger.log(`[可转债日行情] 同步 ${tradeDates.length} 个交易日，模式: ${mode}`)

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const collector = new ValidationCollector(TushareSyncTaskName.CB_DAILY)

    for (const [i, td] of tradeDates.entries()) {
      try {
        const rows = await this.api.getCbDailyByTradeDate(td)
        const mapped = rows
          .map((r) => mapCbDailyRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        const tradeDateTime = this.helper.toDate(td)
        const count = await this.helper.replaceTradeDateRows('cbDaily', tradeDateTime, mapped)
        totalRows += count

        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[可转债日行情] 进度 ${i + 1}/${tradeDates.length}，交易日 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[可转债日行情] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CB_DAILY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `可转债日行情同步完成，${tradeDates.length} 个交易日，共 ${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          ...(failed.length > 0 && { failedDates: failed }),
        },
      },
      startedAt,
    )
  }

  // ─── 每日市场全景 ─────────────────────────────────────────────────────────

  async syncDailyInfo(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.DAILY_INFO)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.DAILY_INFO,
      label: '每日市场全景',
      modelName: 'dailyInfo',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getDailyInfoByTradeDate(td)
        return rows.map((r) => mapDailyInfoRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 筹码获利比例 ────────────────────────────────────────────────────────────

  async syncCyqPerf(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.CYQ_PERF)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.CYQ_PERF,
      label: '筹码获利比例',
      modelName: 'cyqPerf',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getCyqPerfByTradeDate(td)
        return rows.map((r) => mapCyqPerfRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 筹码分布（按股票逐只同步）──────────────────────────────────────────────

  async syncCyqChips(ctx?: TushareSyncPlanContext): Promise<void> {
    const targetTradeDate = this.requireTradeDate(ctx?.targetTradeDate)
    const startedAt = new Date()
    this.logger.log(`[筹码分布] 开始同步，目标交易日: ${targetTradeDate}`)

    const stockList = await this.helper.prisma.stockBasic.findMany({
      where: { listStatus: 'L' },
      select: { tsCode: true },
    })
    const tsCodes: string[] = stockList.map((s: { tsCode: string }) => s.tsCode)

    if (!tsCodes.length) {
      this.logger.warn('[筹码分布] stock_basic 中无上市股票，请先同步股票列表')
      return
    }

    this.logger.log(`[筹码分布] 待同步 ${tsCodes.length} 只股票`)

    const resumeKey = await this.helper.getResumeKey(TushareSyncTaskName.CYQ_CHIPS)
    let startIndex = 0
    if (resumeKey) {
      const idx = tsCodes.indexOf(resumeKey)
      if (idx >= 0) {
        startIndex = idx + 1
        this.logger.log(`[筹码分布] 从断点续传: ${resumeKey} (index=${startIndex})`)
      }
    }

    const collector = new ValidationCollector(TushareSyncTaskName.CYQ_CHIPS)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (let i = startIndex; i < tsCodes.length; i++) {
      const tsCode = tsCodes[i]
      try {
        const rows = await this.api.getCyqChipsByTsCode(tsCode, targetTradeDate)
        if (rows.length > 0) {
          const mapped = rows
            .map((r) => mapCyqChipsRecord(r, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            const result = await this.helper.prisma.cyqChips.createMany({
              data: mapped,
              skipDuplicates: true,
            })
            totalRows += result.count
          }
        }

        if ((i + 1) % 50 === 0 || i === tsCodes.length - 1) {
          await this.helper.updateProgress(TushareSyncTaskName.CYQ_CHIPS, tsCode, i + 1, tsCodes.length)
          ctx?.onProgress?.(i + 1, tsCodes.length, tsCode)
          this.logger.log(`[筹码分布] 进度 ${i + 1}/${tsCodes.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[筹码分布] ${tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    await this.helper.markCompleted(TushareSyncTaskName.CYQ_CHIPS)
    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[筹码分布] 同步完成，共 ${totalRows} 条${failed.length ? `，${failed.length} 只失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.CYQ_CHIPS,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `筹码分布同步完成，共 ${totalRows} 条`,
        tradeDate: this.helper.toDate(targetTradeDate),
        payload: {
          rowCount: totalRows,
          stockCount: tsCodes.length,
          failedStocks: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ─── 分钟级行情（按股票逐只同步）─────────────────────────────────────────────

  async syncStkMins(ctx?: TushareSyncPlanContext): Promise<void> {
    const isFullSync = ctx?.mode === 'full'
    const startedAt = new Date()
    const syncDays = Number(process.env.TUSHARE_STK_MINS_SYNC_DAYS) || 5
    const freq = process.env.TUSHARE_STK_MINS_FREQ || '5min'
    this.logger.log(`[分钟行情] 开始同步 (freq=${freq}, days=${syncDays})...${isFullSync ? '（全量模式）' : ''}`)

    const stockList = await this.helper.prisma.stockBasic.findMany({
      where: { listStatus: 'L' },
      select: { tsCode: true },
    })
    const tsCodes: string[] = stockList.map((s: { tsCode: string }) => s.tsCode)

    if (!tsCodes.length) {
      this.logger.warn('[分钟行情] stock_basic 中无上市股票，请先同步股票列表')
      return
    }

    const endDate = this.helper.getCurrentShanghaiDateString()
    const startDate = this.helper.addDays(endDate, -(syncDays - 1))

    this.logger.log(`[分钟行情] 待同步 ${tsCodes.length} 只股票，范围 ${startDate} → ${endDate}`)

    const resumeKey = isFullSync ? null : await this.helper.getResumeKey(TushareSyncTaskName.STK_MINS)
    let startIndex = 0
    if (resumeKey) {
      const idx = tsCodes.indexOf(resumeKey)
      if (idx >= 0) {
        startIndex = idx + 1
        this.logger.log(`[分钟行情] 从断点续传: ${resumeKey} (index=${startIndex})`)
      }
    }

    const collector = new ValidationCollector(TushareSyncTaskName.STK_MINS)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (let i = startIndex; i < tsCodes.length; i++) {
      const tsCode = tsCodes[i]
      try {
        const rows = await this.api.getStkMinsByTsCode(tsCode, freq, startDate, endDate)
        if (rows.length > 0) {
          const mapped = rows
            .map((r) => mapStkMinsRecord(r, freq, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            const result = await this.helper.prisma.stkMins.createMany({
              data: mapped,
              skipDuplicates: true,
            })
            totalRows += result.count
          }
        }

        if ((i + 1) % 50 === 0 || i === tsCodes.length - 1) {
          await this.helper.updateProgress(TushareSyncTaskName.STK_MINS, tsCode, i + 1, tsCodes.length)
          ctx?.onProgress?.(i + 1, tsCodes.length, tsCode)
          this.logger.log(`[分钟行情] 进度 ${i + 1}/${tsCodes.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[分钟行情] ${tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    await this.helper.markCompleted(TushareSyncTaskName.STK_MINS)
    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[分钟行情] 同步完成，共 ${totalRows} 条${failed.length ? `，${failed.length} 只失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.STK_MINS,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `分钟行情同步完成，共 ${totalRows} 条`,
        payload: {
          rowCount: totalRows,
          stockCount: tsCodes.length,
          freq,
          syncDays,
          failedStocks: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ─── 同花顺板块指数日线 ─────────────────────────────────────────────────────

  async syncThsDaily(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    context?: TushareSyncPlanContext,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.THS_DAILY)
    await this.syncByTradeDate({
      task: TushareSyncTaskName.THS_DAILY,
      label: '同花顺板块日线',
      modelName: 'thsDaily',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getThsDailyByTradeDate(td)
        return rows.map((r) => mapThsDailyRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress: context?.onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }
}
