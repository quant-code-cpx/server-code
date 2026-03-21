import { Injectable } from '@nestjs/common'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { mapMoneyflowDcRecord } from '../tushare-sync.mapper'
import { TushareApiService } from '../tushare-api.service'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareMoneyflowStockSyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.MONEYFLOW_DC,
        category: 'moneyflow-stock',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
    ]
  }

  async checkFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_DC,
      modelName: 'moneyflowDc',
      latestLocalDate: () => this.support.getLatestDateString('moneyflowDc'),
      resolveDates: (startDate) => this.support.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  private async syncByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMoneyflowDcByTradeDate(tradeDate)
    const mapped = rows.map(mapMoneyflowDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('moneyflowDc', this.support.toDate(tradeDate), mapped)
  }

  private requireTargetTradeDate(targetTradeDate?: string) {
    if (!targetTradeDate) {
      throw new Error('个股资金流向同步任务缺少 targetTradeDate。')
    }

    return targetTradeDate
  }
}
