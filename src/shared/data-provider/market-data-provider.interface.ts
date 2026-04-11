// ────────────────────────────────────────────────────────────────
//  市场数据供应商抽象接口
//
//  当前实现: TushareMarketDataProvider (从 Prisma DB 读取历史数据)
//  未来扩展: 可接入实时行情 (Sina / 东方财富 WS) / Wind / Bloomberg 等
// ────────────────────────────────────────────────────────────────

/** 日频 K 线数据 */
export interface DailyBarData {
  tsCode: string
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  vol: number | null
  amount: number | null
}

/** 复权因子 */
export interface AdjustmentFactorData {
  tsCode: string
  tradeDate: Date
  adjFactor: number
}

/** 涨跌停价格 */
export interface LimitPriceData {
  tsCode: string
  tradeDate: string
  upLimit: number | null
  downLimit: number | null
}

/** 停牌信息 */
export interface SuspendInfoData {
  tsCode: string
  tradeDate: string
  suspendTiming: string | null
}

/** 实时报价（预留，当前不实现） */
export interface RealTimeQuote {
  tsCode: string
  name: string
  price: number
  open: number
  high: number
  low: number
  preClose: number
  volume: number
  amount: number
  bid1: number
  ask1: number
  bidVol1: number
  askVol1: number
  timestamp: Date
}

/** 分钟线数据（预留，当前不实现） */
export interface IntradayBar {
  tsCode: string
  datetime: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

/** 行情订阅回调（预留，当前不实现） */
export type QuoteCallback = (quote: RealTimeQuote) => void

/**
 * 市场数据供应商抽象接口
 *
 * 设计目标:
 *  1. 解耦数据消费方 (回测引擎 / 因子计算 / 组合估值) 与数据来源
 *  2. 支持多 Provider 并存 (历史数据 + 实时行情)
 *  3. 预留实时行情接口, 日后接入时零改动消费端
 *
 * 当前实现: TushareMarketDataProvider — 从 PostgreSQL (Tushare 同步数据) 读取
 * 未来实现: RealtimeMarketDataProvider — 从实时行情 WebSocket / REST 读取
 */
export interface IMarketDataProvider {
  /** 供应商唯一标识 (如 'tushare-prisma', 'sina-realtime', 'wind') */
  readonly providerId: string

  // ── 历史数据 (已实现) ──────────────────────────────────────────────

  /** 获取交易日历 (默认 SSE) */
  getTradingDays(startDate: Date, endDate: Date): Promise<Date[]>

  /** 获取日频 K 线 */
  getDailyBars(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<DailyBarData[]>

  /** 获取复权因子 */
  getAdjustmentFactors(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<AdjustmentFactorData[]>

  /** 获取涨跌停价格 */
  getLimitPrices(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<LimitPriceData[]>

  /** 获取停牌信息 */
  getSuspendData(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<SuspendInfoData[]>

  // ── 实时数据 (预留接口, 当前不实现) ────────────────────────────────

  /** 获取实时报价快照 */
  getRealTimeQuote?(tsCodes: string[]): Promise<RealTimeQuote[]>

  /** 订阅实时行情推送, 返回取消订阅函数 */
  subscribeQuote?(
    tsCodes: string[],
    callback: QuoteCallback,
  ): Promise<() => void>

  /** 获取分钟线数据 */
  getIntradayBars?(
    tsCode: string,
    date: Date,
    interval: '1m' | '5m' | '15m' | '30m' | '60m',
  ): Promise<IntradayBar[]>
}
