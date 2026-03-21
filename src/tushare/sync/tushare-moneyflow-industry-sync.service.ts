import { Injectable } from '@nestjs/common'
import { TUSHARE_MONEYFLOW_CONTENT_TYPES, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { mapMoneyflowIndDcRecord } from '../tushare-sync.mapper'
import { TushareApiService } from '../tushare-api.service'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareMoneyflowIndustrySyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.MONEYFLOW_IND_DC,
        category: 'moneyflow-industry',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
    ]
  }

  async checkFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_IND_DC,
      modelName: 'moneyflowIndDc',
      latestLocalDate: () => this.support.getLatestDateString('moneyflowIndDc'),
      resolveDates: (startDate) => this.support.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  private async syncByTradeDate(tradeDate: string) {
    let totalRows = 0

    for (const contentType of TUSHARE_MONEYFLOW_CONTENT_TYPES) {
      const rows = await this.tushareApiService.getMoneyflowIndDcByTradeDate(tradeDate, contentType)
      const mapped = rows.map(mapMoneyflowIndDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
      totalRows += await this.support.replaceTradeDateRows('moneyflowIndDc', this.support.toDate(tradeDate), mapped, {
        contentType: this.support.toPrismaMoneyflowContentType(contentType),
      })
    }

    return totalRows
  }

  private requireTargetTradeDate(targetTradeDate?: string) {
    if (!targetTradeDate) {
      throw new Error('行业资金流向同步任务缺少 targetTradeDate。')
    }

    return targetTradeDate
  }
}
