import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { BusinessException } from 'src/common/exceptions/business.exception'

type AnyModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<Record<string, unknown> | null>
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  createMany(args: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  deleteMany(args?: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  count(args?: Record<string, unknown>): Prisma.PrismaPromise<number>
}
import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  FACTOR_UNIVERSE_INDEX_CODES,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { FactorDataApiService } from '../api/factor-data-api.service'
import {
  mapHkHoldRecord,
  mapIndexWeightRecord,
  mapStkFactorRecord,
  mapStkLimitRecord,
  mapStkSurvRecord,
  mapSuspendDRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan, TushareSyncPlanContext } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/**
 * FactorDataSyncService — 因子数据同步
 *
 * 同步涨跌停价格、停牌信息、指数成分权重，用于因子分析的辅助数据。
 */
@Injectable()
export class FactorDataSyncService {
  private readonly logger = new Logger(FactorDataSyncService.name)

  /** 指数权重历史回补起始日期 */
  private readonly INDEX_WEIGHT_SYNC_START = '20150101'

  constructor(
    private readonly api: FactorDataApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.STK_LIMIT,
        label: '涨跌停价格',
        category: 'factor',
        order: 510,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 30 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步涨跌停价格',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncStkLimit(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.SUSPEND_D,
        label: '停牌信息',
        category: 'factor',
        order: 520,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 35 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步停牌信息',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncSuspendD(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.INDEX_WEIGHT,
        label: '指数成分权重',
        category: 'factor',
        order: 530,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 20 1 * *',
          timeZone: this.helper.syncTimeZone,
          description: '每月1日同步指数成分权重',
        },
        execute: ({ mode }) => this.syncIndexWeight(mode),
      },
      {
        task: TushareSyncTaskName.HK_HOLD,
        label: '沪深股通持股明细',
        category: 'factor',
        order: 540,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 0 9 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘前同步沪深股通持股',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncHkHold(this.requireTradeDate(ctx.targetTradeDate), ctx.mode),
      },
      {
        task: TushareSyncTaskName.STK_FACTOR,
        label: '技术因子',
        category: 'factor',
        order: 550,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 40 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步技术因子',
          tradingDayOnly: true,
        },
        execute: (ctx: TushareSyncPlanContext) =>
          this.syncStkFactor(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx.onProgress),
      },
      {
        task: TushareSyncTaskName.STK_SURV,
        label: '技术面因子',
        category: 'factor',
        order: 500,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 50 19 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步技术面因子',
          tradingDayOnly: true,
        },
        execute: (ctx: TushareSyncPlanContext) =>
          this.syncStkSurv(this.requireTradeDate(ctx.targetTradeDate), ctx.mode, ctx.onProgress),
      },
    ]
  }

  async syncStkLimit(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.STK_LIMIT)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.STK_LIMIT,
      label: '涨跌停价格',
      modelName: 'stkLimit',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getStkLimitByTradeDate(td)
        return rows.map((r) => mapStkLimitRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  async syncSuspendD(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.SUSPEND_D)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.SUSPEND_D,
      label: '停牌信息',
      modelName: 'suspendD',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getSuspendDByTradeDate(td)
        return rows.map((r) => mapSuspendDRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  async syncIndexWeight(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()
    const today = this.helper.getCurrentShanghaiDateString()

    let startDate: string
    if (mode === 'full') {
      startDate = this.INDEX_WEIGHT_SYNC_START
    } else {
      const latest = await this.helper.getLatestDateString('indexWeight')
      startDate = latest ? this.helper.addDays(latest, 1) : this.INDEX_WEIGHT_SYNC_START
    }

    if (this.helper.compareDateString(startDate, today) > 0) {
      this.logger.log('[指数成分权重] 已是最新，无需同步')
      return
    }

    this.logger.log(`[指数成分权重] 同步范围: ${startDate} → ${today}`)

    let totalRows = 0
    const failed: string[] = []
    const collector = new ValidationCollector(TushareSyncTaskName.INDEX_WEIGHT)

    for (const indexCode of FACTOR_UNIVERSE_INDEX_CODES) {
      try {
        const rows = await this.api.getIndexWeightByMonth(indexCode, startDate, today)
        const mapped = rows
          .map((r) => mapIndexWeightRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        if (mapped.length > 0) {
          await this.helper.prisma.indexWeight.createMany({
            data: mapped,
            skipDuplicates: true,
          })
          totalRows += mapped.length
          this.logger.log(`[指数成分权重] ${indexCode}: ${mapped.length} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[指数成分权重] ${indexCode} 同步失败: ${msg}`)
        failed.push(indexCode)
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.INDEX_WEIGHT,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `指数成分权重同步完成，${totalRows} 条`,
        payload: { rowCount: totalRows, ...(failed.length > 0 && { failedIndexes: failed }) },
      },
      startedAt,
    )
  }

  /**
   * 按交易日字符串同步（用于 tradeDate 为 String 类型的模型）。
   * 与 SyncHelperService.replaceTradeDateRows（接受 Date 类型）不同，
   * 此方法直接使用字符串形式的交易日进行删除和插入操作。
   */
  private async syncByTradeDateString(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    targetTradeDate: string
    fullSync?: boolean
    /** tradeDate 字段的 Prisma 类型：'string'（默认）或 'date'（DateTime 字段需传此值） */
    tradeDateType?: 'string' | 'date'
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
    resolveDates: (startDate: string) => Promise<string[]>
    onProgress?: (completed: number, total: number, currentKey?: string) => void
  }): Promise<void> {
    const {
      task,
      label,
      modelName,
      targetTradeDate,
      fullSync = false,
      tradeDateType = 'string',
      fetchAndMap,
      resolveDates,
      onProgress,
    } = opts

    if (!fullSync && (await this.helper.isTaskSyncedForTradeDate(task, targetTradeDate))) {
      this.logger.log(`[${label}] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const startedAt = new Date()
    const latestDate = fullSync ? null : await this.helper.getLatestDateString(modelName)
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log(`[${label}] 已是最新（本地最新: ${latestDate}），无需同步`)
      return
    }

    const tradeDates = await resolveDates(startDate)
    if (!tradeDates.length) {
      this.logger.log(`[${label}] ${startDate} ~ ${targetTradeDate} 间无交易日，跳过`)
      return
    }

    this.logger.log(
      `[${label}] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        const tradeDateValue = tradeDateType === 'date' ? this.helper.toDate(td) : td
        const [, result] = await this.helper.prisma.$transaction([
          model.deleteMany({ where: { tradeDate: tradeDateValue } }),
          model.createMany({ data: mapped, skipDuplicates: true }),
        ])
        totalRows += (result as { count: number }).count
        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
        onProgress?.(i + 1, tradeDates.length, td)
      } catch (error) {
        const msg =
          error instanceof Error
            ? (error.message
                ?.trim()
                .split('\n')
                .find((l) => l.trim()) ?? String(error))
            : String(error)
        this.logger.error(`[${label}] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    await this.helper.writeSyncLog(
      task,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${label}同步完成，${totalRows} 条，${failed.length} 个日期曾失败`,
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

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) {
      throw new BusinessException(ErrorEnum.TUSHARE_TARGET_TRADE_DATE_REQUIRED)
    }
    return targetTradeDate
  }

  // ─── 技术因子 ────────────────────────────────────────────────────────────────

  async syncStkFactor(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    onProgress?: (completed: number, total: number, currentKey?: string) => void,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.STK_FACTOR)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.STK_FACTOR,
      label: '技术因子',
      modelName: 'stkFactor',
      targetTradeDate,
      fullSync: mode === 'full',
      tradeDateType: 'date',
      fetchAndMap: async (td) => {
        const rows = await this.api.getStkFactorByTradeDate(td)
        return rows.map((r) => mapStkFactorRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }

  // ─── 沪深股通持股明细 ────────────────────────────────────────────────────────

  /** 沪深股通持股明细同步（按交易日敹量） */
  async syncHkHold(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()

    // 注意：2024-08-20 起交易所停止日度北向资金披露，改为季度
    const HK_HOLD_STOP_DATE = '20240820'
    if (this.helper.compareDateString(targetTradeDate, HK_HOLD_STOP_DATE) > 0) {
      this.logger.log(`[沪深股通持股] ${targetTradeDate} 超过 ${HK_HOLD_STOP_DATE}，交易所已停止日度批露，跳过`)
      return
    }

    if (!mode || mode === 'incremental') {
      if (await this.helper.isTaskSyncedToday(TushareSyncTaskName.HK_HOLD)) {
        this.logger.log('[沪深股通持股] 今日已同步，跳过')
        return
      }
    }

    // 确定开始日期
    const latestDate = mode === 'full' ? null : await this.helper.getLatestDateString('hkHold', 'tradeDate')
    const syncStart = latestDate ? this.helper.addDays(latestDate, 1) : '20170317' // 深港通开通日
    const syncEnd =
      this.helper.compareDateString(targetTradeDate, HK_HOLD_STOP_DATE) > 0 ? HK_HOLD_STOP_DATE : targetTradeDate

    if (this.helper.compareDateString(syncStart, syncEnd) > 0) {
      this.logger.log(`[沪深股通持股] 已是最新（本地最新: ${latestDate}），无需同步`)
      return
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(syncStart, syncEnd)
    if (!tradeDates.length) {
      this.logger.log(`[沪深股通持股] ${syncStart} ~ ${syncEnd} 间无交易日，跳过`)
      return
    }

    this.logger.log(
      `[沪深股通持股] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const collector = new ValidationCollector(TushareSyncTaskName.HK_HOLD)

    for (const [i, td] of tradeDates.entries()) {
      try {
        const rows = await this.api.getHkHoldByTradeDate(td)
        const mapped = rows
          .map((r) => mapHkHoldRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))

        const tradeDateTime = this.helper.toDate(td)
        const count = await this.helper.replaceTradeDateRows('hkHold', tradeDateTime, mapped)
        totalRows += count

        if (i === 0 || (i + 1) % 100 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[沪深股通持股] 进度 ${i + 1}/${tradeDates.length}，交易日 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[沪深股通持股] ${td} 同步失败: ${msg}`)
        failed.push({ date: td, error: msg })
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.HK_HOLD,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `沪深股通持股同步完成，${tradeDates.length} 个交易日，共 ${totalRows} 条`,
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

  // ─── 技术面因子（stk_surv）────────────────────────────────────────────────────

  async syncStkSurv(
    targetTradeDate: string,
    mode: TushareSyncMode = 'incremental',
    onProgress?: (completed: number, total: number, currentKey?: string) => void,
  ): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.STK_SURV)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.STK_SURV,
      label: '技术面因子',
      modelName: 'stkSurv',
      targetTradeDate,
      fullSync: mode === 'full',
      tradeDateType: 'date',
      fetchAndMap: async (td) => {
        const rows = await this.api.getStkSurvByTradeDate(td)
        return rows.map((r) => mapStkSurvRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
      onProgress,
    })
    await this.helper.flushValidationLogs(collector)
  }
}
