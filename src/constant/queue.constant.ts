/** BullMQ 队列名称 */
export const BACKTESTING_QUEUE = 'backtesting'

/** BullMQ Job 名称 */
export enum BacktestingJobName {
  RUN_BACKTEST = 'run-backtest',
  RUN_WALK_FORWARD = 'run-walk-forward',
  RUN_COMPARISON = 'run-comparison',
}
