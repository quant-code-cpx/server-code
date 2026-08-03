import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { MAX_CONSECUTIVE_FAILS } from './constants/subscription.constant'
import { ScreenerSubscriptionService } from './screener-subscription.service'

const BATCH_JOB_RETRY_DELAY_MS = 30_000

@Injectable()
export class ScreenerSubscriptionScheduler {
  private readonly logger = new Logger(ScreenerSubscriptionScheduler.name)

  constructor(
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
    private readonly subscriptionService: ScreenerSubscriptionService,
    private readonly cronLock: DistributedCronLockService,
  ) {}

  /**
   * 每个工作日 20:30 由交易日 dispatcher 统一分派。
   * 日历而非自然周一/月初决定周频、月频，避免节假日漏跑。
   */
  @Cron('0 30 20 * * *', { timeZone: 'Asia/Shanghai' })
  async dispatchForTradeDate() {
    const dispatch = await this.subscriptionService.getDispatchFrequencies()
    if (!dispatch) return

    // 先补投递已有的 delayed run；恢复 job 具有更高 queue priority，避免新的交易日
    // 先推进基线而使旧 run 只能记录 superseded warning。
    await this.retryDataNotReadyRuns()
    await this.cronLock.runIfScheduler(`screener-subscription:${dispatch.tradeDate}`, async () => {
      this.logger.log(`Dispatching ${dispatch.frequencies.join(', ')} screener subscriptions for ${dispatch.tradeDate}`)
      for (const frequency of dispatch.frequencies) {
        await this.queue.add(
          ScreenerSubscriptionJobName.BATCH_EXECUTE,
          { frequency, tradeDate: dispatch.tradeDate },
          {
            jobId: `screener-subscription-batch-${frequency}-${dispatch.tradeDate}`,
            attempts: MAX_CONSECUTIVE_FAILS + 1,
            backoff: { type: 'exponential', delay: BATCH_JOB_RETRY_DELAY_MS },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        )
      }
    })
  }

  /** 数据同步迟到后的 5 / 15 / 30 分钟补偿窗口；21:20 后停止当晚自动补投递。 */
  @Cron('0 35,50 20 * * *', { timeZone: 'Asia/Shanghai' })
  async retryDataNotReadyAfterFiveAndFifteenMinutes() {
    await this.retryDataNotReadyRuns()
  }

  @Cron('0 20 21 * * *', { timeZone: 'Asia/Shanghai' })
  async retryDataNotReadyAfterThirtyMinutes() {
    await this.retryDataNotReadyRuns()
  }

  private async retryDataNotReadyRuns() {
    const minuteBucket = new Date().toISOString().slice(0, 16)
    await this.cronLock.runIfScheduler(`screener-subscription:data-recovery:${minuteBucket}`, async () => {
      const requeued = await this.subscriptionService.retryDataNotReadyRuns()
      if (requeued > 0) this.logger.log(`Requeued ${requeued} data-not-ready screener subscription runs`)
    })
  }
}
