export const AGENT_LEGACY_MVP_READ_TOOL_KEYS = [
  'resolve_security',
  'get_stock_price_history',
  'get_stock_overview',
  'screen_stocks',
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

export const AGENT_MVP_READ_TOOL_KEYS = AGENT_LEGACY_MVP_READ_TOOL_KEYS

export const AGENT_V5_READ_TOOL_KEYS = [
  ...AGENT_LEGACY_MVP_READ_TOOL_KEYS,
  'get_stock_technical_indicators',
  'get_stock_technical_signals',
  'get_data_availability',
] as const

export const AGENT_V6_READ_TOOL_KEYS = [
  ...AGENT_V5_READ_TOOL_KEYS,
  'get_stock_chip_profile',
  'get_stock_margin_history',
  'get_stock_relative_strength',
  'get_stock_events',
  'get_stock_shareholder_profile',
] as const

export const AGENT_V7_READ_TOOL_KEYS = [
  ...AGENT_V6_READ_TOOL_KEYS,
  'get_index_market_data',
  'get_fund_research',
  'get_industry_rotation',
  'get_factor_analysis',
  'get_macro_snapshot',
] as const

export const AGENT_V8_READ_TOOL_KEYS = [
  ...AGENT_V7_READ_TOOL_KEYS,
  'get_option_market',
  'get_convertible_bond_market',
  'run_event_study',
] as const

export const AGENT_V9_READ_TOOL_KEYS = [
  ...AGENT_V8_READ_TOOL_KEYS,
  'get_backtest_analytics',
  'get_portfolio_analytics',
] as const

export const AGENT_READ_TOOL_KEYS = [...AGENT_V9_READ_TOOL_KEYS, 'get_market_news'] as const

export const AGENT_WRITE_TOOL_KEYS = ['save_research_report'] as const

export const AGENT_LEGACY_TOOL_KEYS = [...AGENT_LEGACY_MVP_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_V5_TOOL_KEYS = [...AGENT_V5_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_V6_TOOL_KEYS = [...AGENT_V6_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_V7_TOOL_KEYS = [...AGENT_V7_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_V8_TOOL_KEYS = [...AGENT_V8_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_V9_TOOL_KEYS = [...AGENT_V9_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export const AGENT_TOOL_KEYS = [...AGENT_READ_TOOL_KEYS, ...AGENT_WRITE_TOOL_KEYS] as const

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number]

export function isAgentToolKey(value: unknown): value is AgentToolKey {
  return typeof value === 'string' && (AGENT_TOOL_KEYS as readonly string[]).includes(value)
}
