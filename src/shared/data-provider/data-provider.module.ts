import { Module } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { MARKET_DATA_PROVIDER } from './data-provider.constants'
import { TushareMarketDataProvider } from './tushare-market-data.provider'

/**
 * 市场数据供应商模块
 *
 * 通过 MARKET_DATA_PROVIDER token 提供 IMarketDataProvider 实现。
 * 当前默认注册 TushareMarketDataProvider (从 Prisma DB 读取历史数据)。
 *
 * 日后接入实时行情时，只需:
 *  1. 新增 RealtimeMarketDataProvider implements IMarketDataProvider
 *  2. 在此模块中注册为额外 Provider (或条件切换)
 *  3. 消费端通过 @Inject(MARKET_DATA_PROVIDER) 自动获取，零改动
 */
@Module({
  providers: [
    PrismaService,
    TushareMarketDataProvider,
    {
      provide: MARKET_DATA_PROVIDER,
      useExisting: TushareMarketDataProvider,
    },
  ],
  exports: [MARKET_DATA_PROVIDER, TushareMarketDataProvider],
})
export class DataProviderModule {}
