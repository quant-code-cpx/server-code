import { Injectable } from '@nestjs/common'
import { TushareFinancialIndicatorSyncService } from './tushare-financial-indicator-sync.service'
import { TushareFinancialPerformanceSyncService } from './tushare-financial-performance-sync.service'
import { TushareFinancialStatementSyncService } from './tushare-financial-statement-sync.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareFinancialSyncService {
  constructor(
    private readonly performanceSyncService: TushareFinancialPerformanceSyncService,
    private readonly statementSyncService: TushareFinancialStatementSyncService,
    private readonly indicatorSyncService: TushareFinancialIndicatorSyncService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      ...this.performanceSyncService.getSyncPlan(),
      ...this.statementSyncService.getSyncPlan(),
      ...this.indicatorSyncService.getSyncPlan(),
    ]
  }
}
