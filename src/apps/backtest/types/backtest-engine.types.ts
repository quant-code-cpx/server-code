export type BacktestStrategyType = 'MA_CROSS_SINGLE' | 'SCREENING_ROTATION' | 'FACTOR_RANKING' | 'CUSTOM_POOL_REBALANCE'
export type BacktestStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type PriceMode = 'NEXT_OPEN' | 'NEXT_CLOSE'
export type RebalanceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
export type Universe = 'ALL_A' | 'HS300' | 'CSI500' | 'CSI1000' | 'SSE50' | 'CUSTOM'

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

export interface BacktestConfig {
  runId: string
  strategyType: BacktestStrategyType
  strategyConfig: Record<string, unknown>
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
