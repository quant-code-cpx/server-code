/**
 * 条件订阅规则协议 v1。
 *
 * 当前执行器只开放 STOCK_SCREENING + ALL_A；其余枚举和类型提前冻结，
 * 以避免后续新增规则类型时改变既有 JSONB 协议的含义。
 */
export enum SubscriptionRuleType {
  STOCK_SCREENING = 'STOCK_SCREENING',
  FACTOR_SCREENING = 'FACTOR_SCREENING',
  SIGNAL_EVENT = 'SIGNAL_EVENT',
  COMPOSITE = 'COMPOSITE',
}

export type RuleJsonPrimitive = string | number | boolean | null
export type RuleJsonValue = RuleJsonPrimitive | RuleJsonValue[] | RuleJsonObject
export type RuleJsonObject = { [key: string]: RuleJsonValue }

export interface AllAUniverseSpec {
  type: 'ALL_A'
  excludeSt: boolean
  excludeSuspended: boolean
  excludeBse: boolean
}

export interface IndexUniverseSpec {
  type: 'INDEX'
  indexCode: string
  excludeSt: boolean
  excludeSuspended: boolean
}

export interface WatchlistGroupUniverseSpec {
  type: 'WATCHLIST_GROUP'
  groupId: number
  excludeSt: boolean
  excludeSuspended: boolean
}

export interface FixedUniverseSpec {
  type: 'FIXED'
  tsCodes: string[]
}

export type UniverseSpec = AllAUniverseSpec | IndexUniverseSpec | WatchlistGroupUniverseSpec | FixedUniverseSpec

export interface StockScreeningRuleSpec {
  type: SubscriptionRuleType.STOCK_SCREENING
  version: 1
  universe: UniverseSpec
  filters: RuleJsonObject
}

/**
 * B2+ 规则类型的协议占位。B0 validator 会明确拒绝这些类型，不能误执行。
 */
export interface FutureSubscriptionRuleSpec {
  type: SubscriptionRuleType.FACTOR_SCREENING | SubscriptionRuleType.SIGNAL_EVENT | SubscriptionRuleType.COMPOSITE
  version: number
  universe?: UniverseSpec
  [key: string]: unknown
}

export type SubscriptionRuleSpec = StockScreeningRuleSpec | FutureSubscriptionRuleSpec

export type SubscriptionTriggerMode = 'ENTER' | 'EXIT' | 'BOTH' | 'EVENT'
export type SubscriptionEventWindow = 'CURRENT_TRADE_DATE' | 'SINCE_LAST_SUCCESS'

export interface SubscriptionTriggerSpec {
  mode: SubscriptionTriggerMode
  notifyOnInitialMatch: boolean
  eventWindow: SubscriptionEventWindow
  cooldownTradingDays: number
  maxHitsPerNotification: number
}

export const DEFAULT_STOCK_SCREENING_TRIGGER_SPEC: Readonly<SubscriptionTriggerSpec> = {
  mode: 'ENTER',
  notifyOnInitialMatch: false,
  eventWindow: 'CURRENT_TRADE_DATE',
  cooldownTradingDays: 0,
  maxHitsPerNotification: 20,
}

/** 迁移 legacy filters 时使用的唯一 B0 universe。 */
export const LEGACY_ALL_A_UNIVERSE: Readonly<AllAUniverseSpec> = {
  type: 'ALL_A',
  excludeSt: true,
  excludeSuspended: true,
  excludeBse: false,
}

export interface RuleValidationIssue {
  code: string
  path: string
  message: string
}

export interface CollectionTriggerPlannerInput {
  /**
   * 是否已有成功基线。不能由空数组推断：空集合也可能是一次已成功执行的结果。
   */
  hasBaseline: boolean
  previousMatchCodes: readonly string[]
  currentMatchCodes: readonly string[]
  triggerSpec?: unknown
}

export type CollectionTriggerKind = 'ENTER' | 'EXIT'

export interface CollectionTriggerHit {
  tsCode: string
  kind: CollectionTriggerKind
}

export interface CollectionTriggerPlan {
  isInitialBaseline: boolean
  matchedCodes: string[]
  observedEnterCodes: string[]
  observedExitCodes: string[]
  enterCodes: string[]
  exitCodes: string[]
  hits: CollectionTriggerHit[]
}
