/** 回测任务数据 */
export interface BacktestingJobData {
  /** 回测运行记录 ID */
  runId: string
  /** 触发用户 ID */
  userId: number
}

/** 回测任务结果 */
export interface BacktestingJobResult {
  runId: string
  completedAt: string
}
