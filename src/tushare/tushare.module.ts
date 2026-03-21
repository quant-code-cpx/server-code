import { Module } from '@nestjs/common'
import { TushareService } from './tushare.service'
import { TushareApiService } from './tushare-api.service'
import { TushareSyncService } from './tushare-sync.service'
import { TushareBasicSyncService } from './sync/tushare-basic-sync.service'
import { TushareFinancialIndicatorSyncService } from './sync/tushare-financial-indicator-sync.service'
import { TushareFinancialPerformanceSyncService } from './sync/tushare-financial-performance-sync.service'
import { TushareFinancialStatementSyncService } from './sync/tushare-financial-statement-sync.service'
import { TushareFinancialSyncService } from './sync/tushare-financial-sync.service'
import { TushareMarketSyncService } from './sync/tushare-market-sync.service'
import { TushareMoneyflowIndustrySyncService } from './sync/tushare-moneyflow-industry-sync.service'
import { TushareMoneyflowMarketSyncService } from './sync/tushare-moneyflow-market-sync.service'
import { TushareMoneyflowStockSyncService } from './sync/tushare-moneyflow-stock-sync.service'
import { TushareMoneyflowSyncService } from './sync/tushare-moneyflow-sync.service'
import { TushareSyncSupportService } from './sync/tushare-sync-support.service'

/**
 * TushareModule
 *
 * 导出 TushareService，供其他功能模块（股票、市场、热力图等）注入使用。
 * TushareSyncService 在应用启动时自动执行数据新鲜度检测。
 */
@Module({
  providers: [
    TushareService,
    TushareApiService,
    TushareSyncSupportService,
    TushareBasicSyncService,
    TushareMarketSyncService,
    TushareFinancialPerformanceSyncService,
    TushareFinancialStatementSyncService,
    TushareFinancialIndicatorSyncService,
    TushareFinancialSyncService,
    TushareMoneyflowStockSyncService,
    TushareMoneyflowIndustrySyncService,
    TushareMoneyflowMarketSyncService,
    TushareMoneyflowSyncService,
    TushareSyncService,
  ],
  exports: [TushareService, TushareApiService, TushareFinancialPerformanceSyncService],
})
export class TushareModule {}
