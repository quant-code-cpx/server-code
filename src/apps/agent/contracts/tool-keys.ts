export const AGENT_TOOL_KEYS = [
  'resolve_security',
  'get_stock_price_history',
  'get_stock_overview',
  'get_financial_statements',
  'get_financial_indicators',
  'get_stock_moneyflow',
  'get_market_snapshot',
  'get_sector_membership',
  'get_user_watchlist',
  'get_portfolio_risk',
  'get_backtest_result',
  'compute_performance_metrics',
  'compute_valuation_percentile',
  'search_web',
  'fetch_web_page',
] as const

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number]

export function isAgentToolKey(value: unknown): value is AgentToolKey {
  return typeof value === 'string' && (AGENT_TOOL_KEYS as readonly string[]).includes(value)
}
