import { Injectable } from '@nestjs/common'
import { TushareMoneyflowIndustrySyncService } from './tushare-moneyflow-industry-sync.service'
import { TushareMoneyflowMarketSyncService } from './tushare-moneyflow-market-sync.service'
import { TushareMoneyflowStockSyncService } from './tushare-moneyflow-stock-sync.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareMoneyflowSyncService {
  constructor(
    private readonly stockSyncService: TushareMoneyflowStockSyncService,
    private readonly industrySyncService: TushareMoneyflowIndustrySyncService,
    private readonly marketSyncService: TushareMoneyflowMarketSyncService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      ...this.stockSyncService.getSyncPlan(),
      ...this.industrySyncService.getSyncPlan(),
      ...this.marketSyncService.getSyncPlan(),
    ]
  }
}
