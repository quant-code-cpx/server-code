import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'

@Injectable()
export class ScreenerSubscriptionScheduler {
  private readonly logger = new Logger(ScreenerSubscriptionScheduler.name)

  constructor(@InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue) {}

  /**
   * 每个交易日（周一至周五）20:30 触发日频订阅。
   * 时序：18:30 Tushare 同步 → 20:00 因子预计算 → 20:30 订阅执行
   */
  @Cron('0 30 20 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async triggerDailySubscriptions() {
    this.logger.log('Triggering DAILY screener subscriptions')
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'DAILY', tradeDate: this.getLatestTradeDateStr() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }

  /** 每周一 20:30 触发周频订阅 */
  @Cron('0 30 20 * * 1', { timeZone: 'Asia/Shanghai' })
  async triggerWeeklySubscriptions() {
    this.logger.log('Triggering WEEKLY screener subscriptions')
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'WEEKLY', tradeDate: this.getLatestTradeDateStr() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }

  /** 每月 1 日 20:30 触发月频订阅 */
  @Cron('0 30 20 1 * *', { timeZone: 'Asia/Shanghai' })
  async triggerMonthlySubscriptions() {
    this.logger.log('Triggering MONTHLY screener subscriptions')
    await this.queue.add(
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: 'MONTHLY', tradeDate: this.getLatestTradeDateStr() },
      { removeOnComplete: 100, removeOnFail: 50 },
    )
  }

  private getLatestTradeDateStr(): string {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }
}
