import { Module } from '@nestjs/common'

// API 层
import { TushareClient } from './api/tushare-client.service'
import { BasicApiService } from './api/basic-api.service'
import { MarketApiService } from './api/market-api.service'
import { FinancialApiService } from './api/financial-api.service'
import { MoneyflowApiService } from './api/moneyflow-api.service'
import { FactorDataApiService } from './api/factor-data-api.service'
import { AlternativeDataApiService } from './api/alternative-data-api.service'

// 同步层
import { SyncHelperService } from './sync/sync-helper.service'
import { BasicSyncService } from './sync/basic-sync.service'
import { MarketSyncService } from './sync/market-sync.service'
import { FinancialSyncService } from './sync/financial-sync.service'
import { MoneyflowSyncService } from './sync/moneyflow-sync.service'
import { FactorDataSyncService } from './sync/factor-data-sync.service'
import { AlternativeDataSyncService } from './sync/alternative-data-sync.service'
import { TushareSyncRegistryService } from './sync/sync-registry.service'
import { TushareSyncService } from './sync/sync.service'
import { DataQualityService } from './sync/quality/data-quality.service'
import { CrossTableCheckService } from './sync/quality/cross-table-check.service'
import { AutoRepairService } from './sync/quality/auto-repair.service'
import { SyncLogService } from './sync/sync-log.service'
import { SyncRetryService } from './sync/sync-retry.service'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { HeatmapModule } from 'src/apps/heatmap/heatmap.module'

/**
 * TushareModule
 *
 * API 层按 Tushare 文档分类：基础数据 / 行情 / 财务 / 资金流向 / 因子 / 另类数据
 * 同步层按分类独立维护，由 TushareSyncService 统一编排
 */
@Module({
  imports: [WebsocketModule, HeatmapModule],
  providers: [
    // API
    TushareClient,
    BasicApiService,
    MarketApiService,
    FinancialApiService,
    MoneyflowApiService,
    FactorDataApiService,
    AlternativeDataApiService,
    // Sync
    SyncHelperService,
    BasicSyncService,
    MarketSyncService,
    FinancialSyncService,
    MoneyflowSyncService,
    FactorDataSyncService,
    AlternativeDataSyncService,
    TushareSyncRegistryService,
    TushareSyncService,
    DataQualityService,
    CrossTableCheckService,
    AutoRepairService,
    SyncLogService,
    SyncRetryService,
  ],
  exports: [TushareClient, FinancialSyncService, TushareSyncRegistryService, TushareSyncService, DataQualityService, CrossTableCheckService, AutoRepairService, SyncLogService],
})
export class TushareModule {}
