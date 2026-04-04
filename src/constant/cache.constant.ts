export const CACHE_NAMESPACE = {
  STOCK_LIST: 'stock-list',
  STOCK_SEARCH: 'stock-search',
  STOCK_OVERVIEW: 'stock-overview',
  STOCK_METADATA: 'stock-metadata',
  MARKET: 'market',
  FACTOR_ANALYSIS: 'factor-analysis',
  TRADE_CALENDAR: 'trade-calendar',
  WATCHLIST: 'watchlist',
  WATCHLIST_STOCKS: 'watchlist-stocks',
  INDUSTRY_ROTATION: 'industry-rotation',
} as const

export type CacheNamespace = (typeof CACHE_NAMESPACE)[keyof typeof CACHE_NAMESPACE]

export const CACHE_TTL_SECONDS = {
  STOCK_LIST: 5 * 60,
  STOCK_SEARCH: 10 * 60,
  STOCK_OVERVIEW: 10 * 60,
  STOCK_METADATA: 60 * 60,
  TRADE_CALENDAR: 24 * 60 * 60,
} as const

export const CACHE_KEY_PREFIX = {
  STOCK_LIST: 'stock:list',
  STOCK_SEARCH: 'stock:search',
  STOCK_OVERVIEW: 'stock:overview',
  STOCK_INDUSTRIES: 'stock:industries',
  STOCK_AREAS: 'stock:areas',
  TRADE_CALENDAR_OPEN_RANGE: 'trade-cal:open-range',
  TRADE_CALENDAR_RECENT_OPEN: 'trade-cal:recent-open',
  TRADE_CALENDAR_IS_TODAY_TRADING: 'trade-cal:is-today-trading',
  TRADE_CALENDAR_LATEST_COMPLETED: 'trade-cal:latest-completed',
} as const

export const MONITORED_CACHE_NAMESPACES = Object.values(CACHE_NAMESPACE)

export const SYNC_INVALIDATION_PREFIXES = ['market:', 'factor:', 'ind-rotation:'] as const
