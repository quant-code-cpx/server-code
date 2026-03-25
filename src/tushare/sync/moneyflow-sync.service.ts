import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  MoneyflowContentType,
  TUSHARE_MONEYFLOW_CONTENT_TYPES,
  TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { MoneyflowApiService } from '../api/moneyflow-api.service'
import { mapMoneyflowDcRecord, mapMoneyflowIndDcRecord, mapMoneyflowMktDcRecord } from '../tushare-sync.mapper'
import { TushareApiError } from '../api/tushare-client.service'
import { SyncHelperService } from './sync-helper.service'

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

  // ─── 个股资金流 ────────────────────────────────────────────────────────────

  async syncMoneyflowDc(targetTradeDate: string): Promise<void> {
    await this.syncMoneyflow({
      task: TushareSyncTaskName.MONEYFLOW_DC,
      label: '个股资金流',
      modelName: 'moneyflowDc',
      targetTradeDate,
      fetchAndMap: async (td) => {
        const rows = await this.api.getMoneyflowDcByTradeDate(td)
        return rows.map(mapMoneyflowDcRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
    })
  }

  // ─── 行业/概念/地域资金流 ──────────────────────────────────────────────────

  async syncMoneyflowIndDc(targetTradeDate: string): Promise<void> {
    await this.syncMoneyflow({
      task: TushareSyncTaskName.MONEYFLOW_IND_DC,
      label: '行业资金流',
      modelName: 'moneyflowIndDc',
      targetTradeDate,
      fetchAndMap: async (td) => {
        let all: unknown[] = []
        for (const ct of TUSHARE_MONEYFLOW_CONTENT_TYPES) {
          const rows = await this.api.getMoneyflowIndDcByTradeDate(td, ct)
          const mapped = rows.map(mapMoneyflowIndDcRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
          all = all.concat(mapped)
        }
        return all
      },
    })
  }

  // ─── 大盘资金流 ────────────────────────────────────────────────────────────

  async syncMoneyflowMktDc(targetTradeDate: string): Promise<void> {
    await this.syncMoneyflow({
      task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
      label: '大盘资金流',
      modelName: 'moneyflowMktDc',
      targetTradeDate,
      fetchAndMap: async (td) => {
        const rows = await this.api.getMoneyflowMktDcByTradeDate(td)
        return rows.map(mapMoneyflowMktDcRecord).filter((r): r is NonNullable<typeof r> => Boolean(r))
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用资金流向同步模板
  // ═══════════════════════════════════════════════════════════════════════════

  private async syncMoneyflow(opts: {
    task: TushareSyncTaskName
    label: string
    modelName: string
    targetTradeDate: string
    fetchAndMap: (tradeDate: string) => Promise<unknown[]>
  }): Promise<void> {
    const { task, label, modelName, targetTradeDate, fetchAndMap } = opts

    if (await this.helper.isTaskSyncedToday(task)) {
      this.logger.log(`[${label}] 今日已同步，跳过`)
      return
    }

    const startedAt = new Date()

    // 确定同步范围
    let tradeDates: string[]
    let retentionCutoff: Date | null = null

    if (this.fullHistory) {
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
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          fullHistory: this.fullHistory,
          failedDates: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  private isDailyQuotaExceeded(error: unknown): boolean {
    return error instanceof TushareApiError && error.code === 40203 && /(每天|每小时)最多访问该接口/.test(error.message)
  }
}
