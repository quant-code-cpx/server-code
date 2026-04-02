export type BacktestStrategyType = 'MA_CROSS_SINGLE' | 'SCREENING_ROTATION' | 'FACTOR_RANKING' | 'CUSTOM_POOL_REBALANCE' | 'FACTOR_SCREENING_ROTATION'
export type BacktestStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type PriceMode = 'NEXT_OPEN' | 'NEXT_CLOSE'
export type RebalanceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
export type Universe = 'ALL_A' | 'HS300' | 'CSI500' | 'CSI1000' | 'SSE50' | 'CUSTOM'
export type StrategyRankOrder = 'asc' | 'desc'
export type CustomWeightMode = 'EQUAL' | 'CUSTOM'

export const SCREENING_ROTATION_RANK_FIELDS = [
  'totalMv',
  'peTtm',
  'pb',
  'dvTtm',
  'turnoverRate',
  'turnoverRateF',
] as const

export type ScreeningRotationRankField = (typeof SCREENING_ROTATION_RANK_FIELDS)[number]

export const FACTOR_RANKING_FACTOR_NAMES = [
  'pe_ttm',
  'pb',
  'total_mv',
  'turnover_rate_f',
  'dv_ttm',
  'turnover_rate',
  'roe',
  'roa',
  'revenue_yoy',
  'netprofit_yoy',
  'grossprofit_margin',
  'netprofit_margin',
] as const

export type FactorRankingFactorName = (typeof FACTOR_RANKING_FACTOR_NAMES)[number]

export interface MaCrossSingleStrategyConfig {
  tsCode: string
  shortWindow?: number
  longWindow?: number
  priceField?: 'close'
  allowFlat?: boolean
}

export interface ScreeningRotationStrategyConfig {
  rankBy?: ScreeningRotationRankField
  rankOrder?: StrategyRankOrder
  topN?: number
  minDaysListed?: number
}

export interface FactorRankingOptionalFilters {
  minTotalMv?: number
  minTurnoverRate?: number
  maxPeTtm?: number
}

export interface FactorRankingStrategyConfig {
  factorName: FactorRankingFactorName
  rankOrder?: StrategyRankOrder
  topN?: number
  minDaysListed?: number
  optionalFilters?: FactorRankingOptionalFilters
}

export interface CustomPoolWeight {
  tsCode: string
  weight: number
}

export interface CustomPoolRebalanceStrategyConfig {
  tsCodes: string[]
  weightMode?: CustomWeightMode
  customWeights?: CustomPoolWeight[]
}

/** Factor screening rotation strategy (from factor module) */
export interface FactorScreeningCondition {
  factorName: string
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'top_pct' | 'bottom_pct'
  value?: number
  min?: number
  max?: number
  percent?: number
}

export interface FactorScreeningRotationStrategyConfig {
  conditions: FactorScreeningCondition[]
  sortBy?: string
  sortOrder?: StrategyRankOrder
  topN?: number
  weightMethod?: 'equal_weight' | 'factor_weight'
}

export interface BacktestStrategyConfigMap {
  MA_CROSS_SINGLE: MaCrossSingleStrategyConfig
  SCREENING_ROTATION: ScreeningRotationStrategyConfig
  FACTOR_RANKING: FactorRankingStrategyConfig
  CUSTOM_POOL_REBALANCE: CustomPoolRebalanceStrategyConfig
  FACTOR_SCREENING_ROTATION: FactorScreeningRotationStrategyConfig
}

export type BacktestStrategyConfig = BacktestStrategyConfigMap[BacktestStrategyType]

/** Map universe names to index codes */
export const UNIVERSE_INDEX_CODE: Record<string, string> = {
  HS300: '000300.SH',
  CSI500: '000905.SH',
  CSI1000: '000852.SH',
  SSE50: '000016.SH',
}

export interface DailyBar {
  tsCode: string
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  vol: number | null
  adjFactor: number | null
  upLimit: number | null
  downLimit: number | null
  isSuspended: boolean
  // ── 前复权价格（用于信号生成）──
  adjClose: number | null   // close * adjFactor / latestAdjFactor
  adjOpen: number | null    // open  * adjFactor / latestAdjFactor
  adjHigh: number | null    // high  * adjFactor / latestAdjFactor
  adjLow: number | null     // low   * adjFactor / latestAdjFactor
}

export interface Position {
  tsCode: string
  quantity: number
  costPrice: number
  entryDate: Date
}

export interface PortfolioState {
  cash: number
  positions: Map<string, Position>
  nav: number
}

export interface TradeRecord {
  tradeDate: Date
  tsCode: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  amount: number
  commission: number
  stampDuty: number
  slippageCost: number
  reason: string | null
}

export interface DailyNavRecord {
  tradeDate: Date
  nav: number
  benchmarkNav: number
  dailyReturn: number
  benchmarkReturn: number
  drawdown: number
  cash: number
  positionValue: number
  exposure: number
  cashRatio: number
}

export interface RebalanceLogRecord {
  signalDate: Date
  executeDate: Date
  targetCount: number
  executedBuyCount: number
  executedSellCount: number
  skippedLimitCount: number
  skippedSuspendCount: number
  message: string | null
}

export interface PositionSnapshot {
  tradeDate: Date
  tsCode: string
  quantity: number
  costPrice: number | null
  closePrice: number | null
  marketValue: number | null
  weight: number | null
  unrealizedPnl: number | null
  holdingDays: number | null
}

export interface BacktestConfig<T extends BacktestStrategyType = BacktestStrategyType> {
  runId: string
  strategyType: T
  strategyConfig: BacktestStrategyConfigMap[T]
  startDate: Date
  endDate: Date
  benchmarkTsCode: string
  universe: Universe
  customUniverseTsCodes?: string[]
  initialCapital: number
  rebalanceFrequency: RebalanceFrequency
  priceMode: PriceMode
  commissionRate: number
  stampDutyRate: number
  minCommission: number
  slippageBps: number
  maxPositions: number
  maxWeightPerStock: number
  minDaysListed: number
  enableTradeConstraints: boolean
  // ── 新增 ──
  enableT1Restriction: boolean     // 是否启用 T+1 限制（默认 true）
  partialFillEnabled: boolean      // 是否允许部分成交（默认 true）
}

export interface BacktestResult {
  navRecords: DailyNavRecord[]
  trades: TradeRecord[]
  positions: PositionSnapshot[]
  rebalanceLogs: RebalanceLogRecord[]
  metrics: BacktestMetrics
}

export interface BacktestMetrics {
  totalReturn: number
  annualizedReturn: number
  benchmarkReturn: number
  excessReturn: number
  maxDrawdown: number
  sharpeRatio: number
  sortinoRatio: number
  calmarRatio: number
  volatility: number
  alpha: number
  beta: number
  informationRatio: number
  winRate: number
  turnoverRate: number
  tradeCount: number
}

/** Strategy signal output */
export interface SignalOutput {
  targets: Array<{
    tsCode: string
    weight?: number // if null/undefined, use equal weight
  }>
}
