import { Injectable } from '@nestjs/common'
import { TushareSyncPlanItem } from './tushare-sync.types'

/**
 * 预留：财务指标、审计意见、主营业务构成等指标类接口。
 * 后续新增接口时，只需在此服务扩展 getSyncPlan() 与具体同步方法。
 */
@Injectable()
export class TushareFinancialIndicatorSyncService {
  getSyncPlan(): TushareSyncPlanItem[] {
    return []
  }
}
