export const MARKET_SCREENING_BOARDS = ['科创板', '创业板'] as const
export type MarketScreeningBoard = (typeof MARKET_SCREENING_BOARDS)[number]

export interface MarketScreeningRequest {
  scope: 'ALL_A' | 'MARKETS'
  markets: MarketScreeningBoard[]
  perMarketLimit: number
}

export class MarketScreeningRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = MarketScreeningRequestError.name
  }
}

export function parseMarketScreeningRequest(userText: string): MarketScreeningRequest | null {
  const normalized = userText.replace(/\s+/g, '').toLowerCase()
  const markets = MARKET_SCREENING_BOARDS.filter((market) => normalized.includes(market))
  const requestsAllA = /全a股|全部a股|a股全市场|全市场/.test(normalized)
  const requestsRanking = /筛选|选股|排名|排行|top\d*|前\d+|买入信号|信号.*(?:多|排名|排行)/.test(normalized)
  if ((markets.length === 0 && !requestsAllA) || !requestsRanking) return null

  const requestedLimit = readRequestedLimit(normalized)
  if (requestedLimit !== null && requestedLimit > 50) {
    throw new MarketScreeningRequestError('单个筛选最多支持 50 只，请缩小数量')
  }
  return {
    scope: markets.length > 0 ? 'MARKETS' : 'ALL_A',
    markets,
    perMarketLimit: requestedLimit ?? 10,
  }
}

function readRequestedLimit(userText: string): number | null {
  const numberPattern = '(\\d{1,3}|[零一二两三四五六七八九十百]{1,5})'
  const matched = new RegExp(`(?:前|top|最多(?:的)?|列(?:出|出来)?)(?:前)?${numberPattern}(?:只|条|个|名)?`).exec(
    userText,
  )
  const trailing = matched ?? new RegExp(`${numberPattern}(?:只|名)(?:股票|个股)?`).exec(userText)
  if (!trailing) return null
  const value = parsePositiveInteger(trailing[1])
  return value >= 1 ? value : null
}

function parsePositiveInteger(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw)
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const parseBelowHundred = (value: string): number => {
    const tenIndex = value.indexOf('十')
    if (tenIndex < 0) return digits[value] ?? 0
    const tens = tenIndex === 0 ? 1 : (digits[value.slice(0, tenIndex)] ?? 0)
    const ones = digits[value.slice(tenIndex + 1)] ?? 0
    return tens * 10 + ones
  }
  const hundredIndex = raw.indexOf('百')
  if (hundredIndex < 0) return parseBelowHundred(raw)
  const hundreds = hundredIndex === 0 ? 1 : (digits[raw.slice(0, hundredIndex)] ?? 0)
  const remainder = raw.slice(hundredIndex + 1).replace(/^零/, '')
  return hundreds * 100 + (remainder ? parseBelowHundred(remainder) : 0)
}
