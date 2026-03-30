import { Module } from '@nestjs/common'

// API 层
import { TushareClient } from './api/tushare-client.service'
import { BasicApiService } from './api/basic-api.service'
import { MarketApiService } from './api/market-api.service'
import { FinancialApiService } from './api/financial-api.service'
import { MoneyflowApiService } from './api/moneyflow-api.service'

// 同步层
import { SyncHelperService } from './sync/sync-helper.service'
import { BasicSyncService } from './sync/basic-sync.service'
import { MarketSyncService } from './sync/market-sync.service'
import { FinancialSyncService } from './sync/financial-sync.service'
import { MoneyflowSyncService } from './sync/moneyflow-sync.service'
import { TushareSyncRegistryService } from './sync/sync-registry.service'
import { TushareSyncService } from './sync/sync.service'
import { WebsocketModule } from 'src/websocket/websocket.module'

/**
 * TushareModule
 *
 * API 层按 Tushare 文档分类：基础数据 / 行情 / 财务 / 资金流向
 * 同步层按分类独立维护，由 TushareSyncService 统一编排
 */
@Module({
  imports: [WebsocketModule],
  providers: [
    // API
    TushareClient,
    BasicApiService,
    MarketApiService,
    FinancialApiService,
    MoneyflowApiService,
    // Sync
    SyncHelperService,
    BasicSyncService,
    MarketSyncService,
    FinancialSyncService,
    MoneyflowSyncService,
    TushareSyncRegistryService,
    TushareSyncService,
  ],
  exports: [TushareClient, FinancialSyncService, TushareSyncRegistryService, TushareSyncService],
})
export class TushareModule {}
