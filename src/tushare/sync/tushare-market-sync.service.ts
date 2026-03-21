import { Injectable } from '@nestjs/common'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import {
  mapAdjFactorRecord,
  mapDailyBasicRecord,
  mapDailyRecord,
  mapMonthlyRecord,
  mapWeeklyRecord,
} from '../tushare-sync.mapper'
import { TushareApiService } from '../tushare-api.service'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareMarketSyncService {
  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.DAILY,
        category: 'market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkDailyFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
      {
        task: TushareSyncTaskName.WEEKLY,
        category: 'market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkWeeklyFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
      {
        task: TushareSyncTaskName.MONTHLY,
        category: 'market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkMonthlyFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
      {
        task: TushareSyncTaskName.ADJ_FACTOR,
        category: 'market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkAdjFactorFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
      {
        task: TushareSyncTaskName.DAILY_BASIC,
        category: 'market',
        stage: 'afterTradeDate',
        run: async (targetTradeDate) => this.checkDailyBasicFreshness(this.requireTargetTradeDate(targetTradeDate)),
      },
    ]
  }

  async checkDailyFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.DAILY,
      modelName: 'daily',
      latestLocalDate: () => this.support.getLatestDateString('daily'),
      resolveDates: (startDate) => this.support.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncDailyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkWeeklyFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.WEEKLY,
      modelName: 'weekly',
      latestLocalDate: () => this.support.getLatestDateString('weekly'),
      resolveDates: (startDate) => this.support.getPeriodEndTradeDates(startDate, targetTradeDate, 'week'),
      syncOneDate: (tradeDate) => this.syncWeeklyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkMonthlyFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONTHLY,
      modelName: 'monthly',
      latestLocalDate: () => this.support.getLatestDateString('monthly'),
      resolveDates: (startDate) => this.support.getPeriodEndTradeDates(startDate, targetTradeDate, 'month'),
      syncOneDate: (tradeDate) => this.syncMonthlyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkAdjFactorFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.ADJ_FACTOR,
      modelName: 'adjFactor',
      latestLocalDate: () => this.support.getLatestDateString('adjFactor'),
      resolveDates: (startDate) => this.support.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncAdjFactorByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkDailyBasicFreshness(targetTradeDate: string) {
    await this.support.syncDailyLikeDataset({
      task: TushareSyncTaskName.DAILY_BASIC,
      modelName: 'dailyBasic',
      latestLocalDate: () => this.support.getLatestDateString('dailyBasic'),
      resolveDates: (startDate) => this.support.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncDailyBasicByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  private async syncDailyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getDailyByTradeDate(tradeDate)
    const mapped = rows.map(mapDailyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('daily', this.support.toDate(tradeDate), mapped)
  }

  private async syncWeeklyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getWeeklyByTradeDate(tradeDate)
    const mapped = rows.map(mapWeeklyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('weekly', this.support.toDate(tradeDate), mapped)
  }

  private async syncMonthlyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMonthlyByTradeDate(tradeDate)
    const mapped = rows.map(mapMonthlyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('monthly', this.support.toDate(tradeDate), mapped)
  }

  private async syncAdjFactorByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getAdjFactorByTradeDate(tradeDate)
    const mapped = rows.map(mapAdjFactorRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('adjFactor', this.support.toDate(tradeDate), mapped)
  }

  private async syncDailyBasicByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getDailyBasicByTradeDate(tradeDate)
    const mapped = rows.map(mapDailyBasicRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('dailyBasic', this.support.toDate(tradeDate), mapped)
  }

  private requireTargetTradeDate(targetTradeDate?: string) {
    if (!targetTradeDate) {
      throw new Error('行情同步任务缺少 targetTradeDate。')
    }

    return targetTradeDate
  }
}
