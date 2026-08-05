export const MARKET_SCREENING_BOARDS = ['科创板', '创业板'] as const
export type MarketScreeningBoard = (typeof MARKET_SCREENING_BOARDS)[number]

export interface MarketScreeningRequest {
  markets: MarketScreeningBoard[]
  perMarketLimit: number
}

export function parseMarketScreeningRequest(userText: string): MarketScreeningRequest | null {
  const normalized = userText.replace(/\s+/g, '').toLowerCase()
  const markets = MARKET_SCREENING_BOARDS.filter((market) => normalized.includes(market))
  const requestsRanking = /筛选|选股|排名|排行|top\d*|前\d+|买入信号|信号.*(?:多|排名|排行)/.test(normalized)
  if (markets.length === 0 || !requestsRanking) return null

  const requestedLimit = readRequestedLimit(normalized)
  return { markets, perMarketLimit: requestedLimit ?? 10 }
}

function readRequestedLimit(userText: string): number | null {
  const matched = /(?:前|top|最多|列(?:出|出来)?)(\d{1,2})(?:只|条|个|名)?/.exec(userText)
  if (!matched) return null
  const value = Number(matched[1])
  return Number.isInteger(value) && value >= 1 ? Math.min(value, 50) : null
}
