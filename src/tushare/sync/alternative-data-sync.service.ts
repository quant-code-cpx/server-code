import { Injectable, Logger } from '@nestjs/common'
import { Prisma, StockListStatus } from '@prisma/client'
import { BusinessException } from 'src/common/exceptions/business.exception'

type AnyModelDelegate = {
  findFirst(args?: Record<string, unknown>): Promise<Record<string, unknown> | null>
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  createMany(args: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  deleteMany(args?: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>
  count(args?: Record<string, unknown>): Prisma.PrismaPromise<number>
}
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { AlternativeDataApiService } from '../api/alternative-data-api.service'
import {
  mapBlockTradeRecord,
  mapLimitListDRecord,
  mapShareFloatRecord,
  mapTopInstRecord,
  mapTopListRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/**
 * AlternativeDataSyncService — 另类数据同步
 *
 * 同步龙虎榜明细、龙虎榜机构交易、大宗交易、限售股解禁，
 * 用于游资追踪、机构减持分析、事件驱动策略等研究场景。
 *
 * 注意：上述接口均需 Tushare 2000 积分，bootstrapEnabled 默认关闭，
 * 请确认账户积分后通过手动同步或修改配置启用历史回补。
 */
@Injectable()
export class AlternativeDataSyncService {
  private readonly logger = new Logger(AlternativeDataSyncService.name)

  constructor(
    private readonly api: AlternativeDataApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.TOP_LIST,
        label: '龙虎榜明细',
        category: 'alternative',
        order: 540,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 0 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步龙虎榜明细（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncTopList(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.TOP_INST,
        label: '龙虎榜机构明细',
        category: 'alternative',
        order: 545,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 5 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步龙虎榜机构明细（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncTopInst(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.BLOCK_TRADE,
        label: '大宗交易',
        category: 'alternative',
        order: 550,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 10 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步大宗交易（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncBlockTrade(this.requireTradeDate(targetTradeDate), mode),
      },
      {
        task: TushareSyncTaskName.SHARE_FLOAT,
        label: '限售股解禁',
        category: 'alternative',
        order: 560,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 3 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一凌晨同步限售股解禁数据（需 Tushare 2000 积分）',
        },
        execute: ({ mode }) => this.syncShareFloat(mode),
      },
      {
        task: TushareSyncTaskName.LIMIT_LIST_D,
        label: '每日涨跌停明细',
        category: 'alternative',
        order: 565,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 15 20 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步涨跌停明细（需 Tushare 2000 积分）',
          tradingDayOnly: true,
        },
        execute: ({ mode, targetTradeDate }) => this.syncLimitListD(this.requireTradeDate(targetTradeDate), mode),
      },
    ]
  }

  async syncTopList(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.TOP_LIST)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.TOP_LIST,
      label: '龙虎榜明细',
      modelName: 'topList',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getTopListByTradeDate(td)
        return rows.map((r) => mapTopListRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  async syncTopInst(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.TOP_INST)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.TOP_INST,
      label: '龙虎榜机构明细',
      modelName: 'topInst',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getTopInstByTradeDate(td)
        return rows.map((r) => mapTopInstRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  async syncBlockTrade(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.BLOCK_TRADE)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.BLOCK_TRADE,
      label: '大宗交易',
      modelName: 'blockTrade',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getBlockTradeByTradeDate(td)
        return rows.map((r) => mapBlockTradeRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

  async syncShareFloat(mode: TushareSyncMode = 'incremental'): Promise<void> {
    const startedAt = new Date()

    // 获取全部上市股票列表（仅在全量模式下包含退市股）
    const stocks = await this.helper.prisma.stockBasic.findMany({
      select: { tsCode: true },
      where: mode === 'full' ? undefined : { listStatus: StockListStatus.L },
    })

    this.logger.log(`[限售股解禁] 开始同步，共 ${stocks.length} 只股票（模式: ${mode}）`)

    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []
    const collector = new ValidationCollector(TushareSyncTaskName.SHARE_FLOAT)

    for (const [i, stock] of stocks.entries()) {
      try {
        const rows = await this.api.getShareFloat(stock.tsCode)
        const mapped = rows
          .map((r) => mapShareFloatRecord(r, collector))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        if (mapped.length > 0) {
          await this.helper.prisma.$transaction([
            this.helper.prisma.shareFloat.deleteMany({ where: { tsCode: stock.tsCode } }),
            this.helper.prisma.shareFloat.createMany({ data: mapped, skipDuplicates: true }),
          ])
          totalRows += mapped.length
        }
        if (i === 0 || (i + 1) % 500 === 0 || i === stocks.length - 1) {
          this.logger.log(`[限售股解禁] 进度 ${i + 1}/${stocks.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[限售股解禁] ${stock.tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode: stock.tsCode, error: msg })
      }
    }

    await this.helper.flushValidationLogs(collector)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.SHARE_FLOAT,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `限售股解禁同步完成，${totalRows} 条，${failed.length} 只股票曾失败`,
        payload: {
          rowCount: totalRows,
          stockCount: stocks.length,
          ...(failed.length > 0 && { failedStocks: failed }),
        },
      },
      startedAt,
    )
  }

  /**
   * 按交易日字符串同步（复用 FactorDataSyncService 相同模板）
   */
  async syncLimitListD(targetTradeDate: string, mode: TushareSyncMode = 'incremental'): Promise<void> {
    const collector = new ValidationCollector(TushareSyncTaskName.LIMIT_LIST_D)
    await this.syncByTradeDateString({
      task: TushareSyncTaskName.LIMIT_LIST_D,
      label: '每日涨跌停明细',
      modelName: 'limitListD',
      targetTradeDate,
      fullSync: mode === 'full',
      fetchAndMap: async (td) => {
        const rows = await this.api.getLimitListDByTradeDate(td)
        return rows.map((r) => mapLimitListDRecord(r, collector)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
      resolveDates: (start) => this.helper.getOpenTradeDatesBetween(start, targetTradeDate),
    })
    await this.helper.flushValidationLogs(collector)
  }

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

    this.logger.log(
      `[${label}] 开始同步 ${tradeDates.length} 个交易日: ${tradeDates[0]} → ${tradeDates[tradeDates.length - 1]}`,
    )

    let totalRows = 0
    const failed: Array<{ date: string; error: string }> = []
    const model = (this.helper.prisma as unknown as Record<string, AnyModelDelegate>)[modelName]

    for (const [i, td] of tradeDates.entries()) {
      try {
        const mapped = await fetchAndMap(td)
        const [, result] = await this.helper.prisma.$transaction([
          model.deleteMany({ where: { tradeDate: td } }),
          model.createMany({ data: mapped, skipDuplicates: true }),
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
}
