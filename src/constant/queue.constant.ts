/** BullMQ 队列名称 */
export const BACKTESTING_QUEUE = 'backtesting'

/** BullMQ 条件订阅队列名称 */
export const SCREENER_SUBSCRIPTION_QUEUE = 'screener-subscription'

/** BullMQ 事件驱动研究队列名称 */
export const EVENT_STUDY_QUEUE = 'event-study'

/** BullMQ Job 名称 */
export enum BacktestingJobName {
  RUN_BACKTEST = 'run-backtest',
  RUN_WALK_FORWARD = 'run-walk-forward',
  RUN_COMPARISON = 'run-comparison',
}

/** BullMQ 条件订阅 Job 名称 */
export enum ScreenerSubscriptionJobName {
  EXECUTE_SUBSCRIPTION = 'execute_subscription',
  BATCH_EXECUTE = 'batch_execute',
}

/** BullMQ 事件驱动研究 Job 名称 */
export enum EventStudyJobName {
  SCAN_SIGNAL_RULES = 'scan-signal-rules',
}
