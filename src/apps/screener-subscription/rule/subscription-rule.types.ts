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
  universe: AllAUniverseSpec
  filters: RuleJsonObject
}

export type FactorRuleOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'BETWEEN' | 'TOP_PERCENT' | 'BOTTOM_PERCENT'

export interface FactorConditionSpec {
  factorId: string
  operator: FactorRuleOperator
  value: number | [number, number]
}

export interface FactorScreeningRuleSpec {
  type: SubscriptionRuleType.FACTOR_SCREENING
  version: 1
  universe: AllAUniverseSpec
  conditions: FactorConditionSpec[]
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
}

export type SignalEventType =
  | 'GOLDEN_CROSS'
  | 'DEATH_CROSS'
  | 'OVERBOUGHT_ENTER'
  | 'OVERSOLD_ENTER'
  | 'BREAK_UP'
  | 'BREAK_DOWN'

export interface SignalConditionSpec {
  metricId: string
  eventType: SignalEventType
  threshold?: number
  strengthAtLeast?: number
}

export interface SignalEventRuleSpec {
  type: SubscriptionRuleType.SIGNAL_EVENT
  version: 1
  universe: AllAUniverseSpec
  conditions: SignalConditionSpec[]
  minSatisfied: number
}

export interface FutureSubscriptionRuleSpec {
  type: SubscriptionRuleType.COMPOSITE
  version: number
  [key: string]: unknown
}

export type SubscriptionRuleSpec =
  | StockScreeningRuleSpec
  | FactorScreeningRuleSpec
  | SignalEventRuleSpec
  | FutureSubscriptionRuleSpec

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

export const DEFAULT_SIGNAL_EVENT_TRIGGER_SPEC: Readonly<SubscriptionTriggerSpec> = {
  mode: 'EVENT',
  notifyOnInitialMatch: true,
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
