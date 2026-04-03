import { TushareSyncTaskName } from 'src/constant/tushare.constant'

export const TUSHARE_SYNC_MODES = ['incremental', 'full'] as const

export type TushareSyncMode = (typeof TUSHARE_SYNC_MODES)[number]
export type TushareSyncTrigger = 'bootstrap' | 'schedule' | 'manual'
export type TushareSyncCategory = 'basic' | 'market' | 'financial' | 'moneyflow' | 'factor' | 'alternative'

export interface TushareSyncSchedule {
  cron: string
  timeZone: string
  description: string
  tradingDayOnly?: boolean
}

export interface TushareSyncPlanContext {
  trigger: TushareSyncTrigger
  mode: TushareSyncMode
  targetTradeDate?: string
  /**
   * 进度回调（可选），sync service 在调用 execute 前注入。
   * 各分类同步服务在循环体中每完成一个分片（日期/季度/页）时调用。
   * @param completed 已完成分片数（从 1 开始）
   * @param total 总分片数
   * @param currentKey 当前分片键（如 "20260401"）
   */
  onProgress?: (completed: number, total: number, currentKey?: string) => void
}

export interface TushareSyncPlan {
  task: TushareSyncTaskName
  label: string
  category: TushareSyncCategory
  order: number
  bootstrapEnabled: boolean
  supportsManual: boolean
  supportsFullSync: boolean
  requiresTradeDate: boolean
  /** 并发分组标识（默认同 category），同组内串行，不同组可并行 */
  concurrencyGroup?: string
  schedule?: TushareSyncSchedule
  execute: (context: TushareSyncPlanContext) => Promise<void>
}
