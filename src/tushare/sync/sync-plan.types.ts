import { TushareSyncTaskName } from 'src/constant/tushare.constant'

export const TUSHARE_SYNC_MODES = ['incremental', 'full'] as const

export type TushareSyncMode = (typeof TUSHARE_SYNC_MODES)[number]
export type TushareSyncTrigger = 'bootstrap' | 'schedule' | 'manual'
export type TushareSyncCategory = 'basic' | 'market' | 'financial' | 'moneyflow'

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
  schedule?: TushareSyncSchedule
  execute: (context: TushareSyncPlanContext) => Promise<void>
}
