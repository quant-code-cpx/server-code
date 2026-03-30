import { Injectable, Logger } from '@nestjs/common'
import { FACTOR_UNIVERSE_INDEX_CODES, TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FactorDataApiService } from '../api/factor-data-api.service'
import { mapIndexWeightRecord, mapStkLimitRecord, mapSuspendDRecord } from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'

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
    ]
  }

  async syncStkLimit(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.STK_LIMIT,
      label: '涨跌停价格',
      modelName: 'stkLimit',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getStkLimitByTradeDate(td)
        return rows.map(mapStkLimitRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
  }

  async syncSuspendD(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.SUSPEND_D,
      label: '停牌信息',
      modelName: 'suspendD',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getSuspendDByTradeDate(td)
        return rows.map(mapSuspendDRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
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

    for (const indexCode of FACTOR_UNIVERSE_INDEX_CODES) {
      try {
        const rows = await this.api.getIndexWeightByMonth(indexCode, startDate, today)
        const mapped = rows.map(mapIndexWeightRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
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
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
    resolveDates: (startDate: string) => Promise<string[]>
  }): Promise<void> {
    const { task, label, modelName, targetTradeDate, fullSync = false, fetchAndMap, resolveDates } = opts

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

    this.logger.log(`[${label}] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`)

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const model = (this.helper.prisma as any)[modelName]

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        const [, result] = await this.helper.prisma.$transaction([
          model.deleteMany({ where: { tradeDate: td } }),
          model.createMany({ data: mapped }),
        ])
        totalRows += (result as { count: number }).count
        if (i === 0 || (i + 1) % 200 === 0 || i === tradeDates.length - 1) {
          this.logger.log(`[${label}] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
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
        payload: { rowCount: totalRows, dateCount: tradeDates.length, ...(failed.length > 0 && { failedDates: failed }) },
      },
      startedAt,
    )
  }

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) throw new Error('targetTradeDate is required')
    return targetTradeDate
  }
}
