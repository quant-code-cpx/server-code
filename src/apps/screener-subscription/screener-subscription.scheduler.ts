import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectQueue } from '@nestjs/bullmq'
import { SubscriptionFrequency } from '@prisma/client'
import { Queue } from 'bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { ScreenerSubscriptionService } from './screener-subscription.service'

@Injectable()
export class ScreenerSubscriptionScheduler {
  private readonly logger = new Logger(ScreenerSubscriptionScheduler.name)

  constructor(
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
    private readonly subscriptionService: ScreenerSubscriptionService,
    private readonly cronLock: DistributedCronLockService,
  ) {}

  /**
   * 每个交易日（周一至周五）20:30 触发日频订阅。
   * 时序：18:30 Tushare 同步 → 20:00 因子预计算 → 20:30 订阅执行
   */
  @Cron('0 30 20 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async triggerDailySubscriptions() {
    await this.triggerWithLease('screener-subscription:daily', SubscriptionFrequency.DAILY)
  }

  /** 每周一 20:30 触发周频订阅 */
  @Cron('0 30 20 * * 1', { timeZone: 'Asia/Shanghai' })
  async triggerWeeklySubscriptions() {
    await this.triggerWithLease('screener-subscription:weekly', SubscriptionFrequency.WEEKLY)
  }

  /** 每月 1 日 20:30 触发月频订阅 */
  @Cron('0 30 20 1 * *', { timeZone: 'Asia/Shanghai' })
  async triggerMonthlySubscriptions() {
    await this.triggerWithLease('screener-subscription:monthly', SubscriptionFrequency.MONTHLY)
  }

  private async triggerWithLease(key: string, frequency: SubscriptionFrequency): Promise<void> {
    await this.cronLock.runIfScheduler(key, async () => {
      this.logger.log(`Triggering ${frequency} screener subscriptions`)
      const tradeDate = await this.subscriptionService.getLatestTradeDateStr()
      await this.queue.add(
        ScreenerSubscriptionJobName.BATCH_EXECUTE,
        { frequency, tradeDate },
        { removeOnComplete: 100, removeOnFail: 50 },
      )
    })
  }
}
