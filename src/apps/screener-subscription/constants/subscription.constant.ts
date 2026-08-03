/** 每用户最大订阅数量 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10

/** 连续失败次数阈值（超过后自动暂停） */
export const MAX_CONSECUTIVE_FAILS = 3

/** 执行日志保留天数 */
export const LOG_RETENTION_DAYS = 90

/** 手动触发最短冷却时间（毫秒） */
export const MANUAL_TRIGGER_COOLDOWN_MS = 5 * 60 * 1000

/** 数据库正式运行幂等键。 */
export const buildSubscriptionRunKey = (subscriptionId: number, tradeDate: string, ruleVersion: number): string =>
  `subscription:${subscriptionId}:${tradeDate}:v${ruleVersion}`

/**
 * BullMQ 自定义 job ID。使用连字符而非冒号，避免与 BullMQ 的内部 key 分隔符冲突。
 */
export const buildSubscriptionQueueJobId = (subscriptionId: number, tradeDate: string, ruleVersion: number): string =>
  `subscription-${subscriptionId}-${tradeDate}-v${ruleVersion}`
