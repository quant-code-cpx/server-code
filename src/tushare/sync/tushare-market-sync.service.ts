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

  /**
   * 行情类数据统一采用“按交易日拉全市场”的补数策略：
   *
   * - `daily / weekly / monthly / adj_factor / daily_basic` 这些接口都支持按 `trade_date` 查询；
   * - 对“获取所有股票全部历史行情”这一目标来说，按交易日全市场抓取通常比按股票逐只回补更高效；
   * - 断点续跑时，只需要根据本地表里最新的 `tradeDate` 继续向后补，不需要重新遍历全部股票。
   *
   * 因此这里的 plan 设计是：
   * 1. 先根据本地最大日期判断是否需要补数；
   * 2. 再解析出待补的交易日 / 周末日 / 月末日；
   * 3. 最后按日期逐天（或逐周、逐月）覆盖写入。
   */
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
    // 日线：逐个交易日拉取“当日全市场所有股票”的行情。
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
    // 周线：以区间内每个自然周最后一个交易日作为周线 trade_date。
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
    // 月线：以区间内每个自然月最后一个交易日作为月线 trade_date。
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
    // 复权因子：和日线一样按每个交易日全市场增量补齐。
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
    // 每日指标：和日线一样按每个交易日全市场增量补齐。
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
    // 对单个 trade_date，`daily` 接口会返回该日全市场股票行情。
    const rows = await this.tushareApiService.getDailyByTradeDate(tradeDate)
    const mapped = rows.map(mapDailyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('daily', this.support.toDate(tradeDate), mapped)
  }

  private async syncWeeklyByTradeDate(tradeDate: string) {
    // 对单个周末交易日，`weekly` 接口返回该周全市场周线快照。
    const rows = await this.tushareApiService.getWeeklyByTradeDate(tradeDate)
    const mapped = rows.map(mapWeeklyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('weekly', this.support.toDate(tradeDate), mapped)
  }

  private async syncMonthlyByTradeDate(tradeDate: string) {
    // 对单个月末交易日，`monthly` 接口返回该月全市场月线快照。
    const rows = await this.tushareApiService.getMonthlyByTradeDate(tradeDate)
    const mapped = rows.map(mapMonthlyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('monthly', this.support.toDate(tradeDate), mapped)
  }

  private async syncAdjFactorByTradeDate(tradeDate: string) {
    // 复权因子按交易日覆盖写入，保证断点续跑后该日期数据仍然幂等。
    const rows = await this.tushareApiService.getAdjFactorByTradeDate(tradeDate)
    const mapped = rows.map(mapAdjFactorRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceTradeDateRows('adjFactor', this.support.toDate(tradeDate), mapped)
  }

  private async syncDailyBasicByTradeDate(tradeDate: string) {
    // 每日指标也按交易日整批覆盖，避免局部重复写入导致同日数据不完整。
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
