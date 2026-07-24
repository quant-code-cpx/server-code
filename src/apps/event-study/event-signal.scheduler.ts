import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { EventSignalService } from './event-signal.service'

@Injectable()
export class EventSignalScheduler {
  private readonly logger = new Logger(EventSignalScheduler.name)

  constructor(
    private readonly eventSignalService: EventSignalService,
    private readonly cronLock: DistributedCronLockService,
  ) {}

  /**
   * 每日 19:00（上海时间，工作日）执行一次事件信号扫描。
   * 在 Tushare 数据同步（18:30 触发）完成后执行。
   */
  @Cron('0 0 19 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async dailyScan() {
    await this.cronLock.runIfScheduler('event-signal:daily', async () => {
      const job = await this.eventSignalService.enqueueScan(undefined)
      this.logger.log(`定时任务：事件信号扫描已入队 jobId=${job.jobId} tradeDate=${job.tradeDate}`)
    })
  }
}
