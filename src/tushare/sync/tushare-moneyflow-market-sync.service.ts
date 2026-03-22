import { Injectable } from '@nestjs/common'
import { TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { mapMoneyflowMktDcRecord } from '../tushare-sync.mapper'
import { TushareApiService } from '../tushare-api.service'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareMoneyflowMarketSyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
        category: 'moneyflow-market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
    ]
  }

  async checkFreshness(targetTradeDate: string) {
    const recentTradeDates = await this.resolveRecentTradeDates(targetTradeDate)
    const earliestRetainedTradeDate = recentTradeDates[0]

    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
      modelName: 'moneyflowMktDc',
      latestLocalDate: () => this.support.getLatestDateString('moneyflowMktDc'),
      resolveDates: (startDate) => this.filterTradeDatesByStartDate(recentTradeDates, startDate),
      syncOneDate: (tradeDate) => this.syncByTradeDate(tradeDate),
      targetTradeDate,
    })

    if (earliestRetainedTradeDate) {
      await this.support.deleteRowsBeforeDate(
        'moneyflowMktDc',
        'tradeDate',
        this.support.toDate(earliestRetainedTradeDate),
      )
    }
  }

  private async syncByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMoneyflowMktDcByTradeDate(tradeDate)
    const mapped = rows.map(mapMoneyflowMktDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('moneyflowMktDc', this.support.toDate(tradeDate), mapped)
  }

  private requireTargetTradeDate(targetTradeDate?: string) {
    if (!targetTradeDate) {
      throw new Error('市场资金流向同步任务缺少 targetTradeDate。')
    }

    return targetTradeDate
  }

  private async resolveRecentTradeDates(targetTradeDate: string) {
    return this.support.getRecentOpenTradeDates(targetTradeDate, TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS)
  }

  private async filterTradeDatesByStartDate(tradeDates: string[], startDate: string) {
    return tradeDates.filter((tradeDate) => this.support.compareDateString(tradeDate, startDate) >= 0)
  }
}
