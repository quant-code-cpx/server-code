import { Injectable } from '@nestjs/common'
import { TushareSyncPlanItem } from './tushare-sync.types'

/**
 * 预留：利润表、资产负债表、现金流量表等财务报表类接口。
 * 后续新增接口时，只需在此服务扩展 getSyncPlan() 与具体同步方法。
 */
@Injectable()
export class TushareFinancialStatementSyncService {
  getSyncPlan(): TushareSyncPlanItem[] {
    return []
  }
}
