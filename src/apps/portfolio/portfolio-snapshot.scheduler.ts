import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { PortfolioSnapshotService } from './portfolio-snapshot.service'

@Injectable()
export class PortfolioSnapshotScheduler {
  private readonly logger = new Logger(PortfolioSnapshotScheduler.name)

  constructor(
    private readonly snapshots: PortfolioSnapshotService,
    private readonly cronLock: DistributedCronLockService,
  ) {}

  @Cron('0 30 20 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async rebuildAfterClose(): Promise<void> {
    await this.cronLock.runIfScheduler('portfolio-snapshot:daily', async () => {
      const result = await this.snapshots.rebuildLatestForAll()
      this.logger.log(`组合点时快照完成 tradeDate=${result.tradeDate ?? 'none'} snapshots=${result.snapshots}`)
    })
  }
}
