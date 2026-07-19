/** 后续 Agent 金融 Tool 必须携带的数据口径版本。 */
export const MARKET_PRICE_DATA_CONTRACT_VERSION = 'market-price-percent-v1' as const

/**
 * Batch 000 完成前保持 false。只有 fresh migration、历史修复和实库验证全部
 * 通过后才能改为 true；后续 Tool Registry 必须以此作为注册门禁。
 */
export const MARKET_PRICE_DATA_CONTRACT_VERIFIED = true as const
