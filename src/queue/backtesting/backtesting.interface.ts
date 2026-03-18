/** 回测任务数据 */
export interface BacktestingJobData {
  /** 策略标识 */
  strategyId: string
  /** 回测开始日期 (YYYY-MM-DD) */
  startDate: string
  /** 回测结束日期 (YYYY-MM-DD) */
  endDate: string
  /** 初始资金 */
  initialCapital: number
  /** 触发用户 ID */
  userId: number
  /** 其他策略参数（可扩展） */
  params?: Record<string, any>
}

/** 回测任务结果 */
export interface BacktestingJobResult {
  strategyId: string
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
  sharpeRatio: number
  tradeCount: number
  completedAt: string
}
