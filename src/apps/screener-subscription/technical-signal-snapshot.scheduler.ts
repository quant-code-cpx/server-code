import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import { TechnicalSignalSnapshotService } from './technical-signal-snapshot.service'

@Injectable()
export class TechnicalSignalSnapshotScheduler {
  private readonly logger = new Logger(TechnicalSignalSnapshotScheduler.name)

  constructor(
    private readonly subscriptionService: ScreenerSubscriptionService,
    private readonly snapshotService: TechnicalSignalSnapshotService,
    private readonly cronLock: DistributedCronLockService,
  ) {}

  /** 数据同步与因子快照后运行；订阅 dispatcher 在 20:30 才会消费已提交事件。 */
  @Cron('0 5 20 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async buildForLatestTradeDate() {
    const tradeDate = await this.subscriptionService.getLatestTradeDateStr()
    await this.cronLock.runIfScheduler(`technical-signal-snapshot:${tradeDate}`, async () => {
      try {
        await this.snapshotService.buildForTradeDate(tradeDate)
      } catch (error) {
        this.logger.error(
          `Technical signal snapshot failed for ${tradeDate}`,
          error instanceof Error ? error.stack : undefined,
        )
      }
    })
  }
}
