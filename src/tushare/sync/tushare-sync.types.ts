import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'

export interface TaskExecutionResult {
  status: TushareSyncExecutionStatus
  message: string
  tradeDate?: Date
  payload?: Record<string, unknown>
}

export interface DailyLikeSyncOptions {
  task: TushareSyncTaskName
  modelName: string
  latestLocalDate: () => Promise<string | null>
  resolveDates: (startDate: string) => Promise<string[]>
  syncOneDate: (tradeDate: string) => Promise<number>
  targetTradeDate: string
}

export type TushareSyncStage = 'beforeTradeDate' | 'afterTradeDate'

export interface TushareSyncPlanItem {
  task: TushareSyncTaskName
  category:
    | 'basic'
    | 'market'
    | 'financial-performance'
    | 'financial-statement'
    | 'financial-indicator'
    | 'moneyflow-stock'
    | 'moneyflow-industry'
    | 'moneyflow-market'
  stage: TushareSyncStage
  run: (targetTradeDate?: string) => Promise<void>
}
