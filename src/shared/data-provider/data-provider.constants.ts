/**
 * 市场数据供应商注入 Token
 *
 * 使用方式:
 *   @Inject(MARKET_DATA_PROVIDER) private readonly dataProvider: IMarketDataProvider
 */
export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER')
