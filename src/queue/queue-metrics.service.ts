import { Injectable, Logger } from '@nestjs/common'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Gauge } from 'prom-client'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Queue } from 'bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { BULLMQ_QUEUE_DEPTH, BULLMQ_ACTIVE_JOBS } from 'src/shared/metrics/metrics.constants'

@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name)

  constructor(
    @InjectQueue(BACKTESTING_QUEUE) private readonly backtestQueue: Queue,
    @InjectMetric(BULLMQ_QUEUE_DEPTH) private readonly queueDepthGauge: Gauge,
    @InjectMetric(BULLMQ_ACTIVE_JOBS) private readonly activeJobsGauge: Gauge,
  ) {}

  /** 每 10 秒采集一次队列状态 */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async collectQueueMetrics() {
    try {
      const waiting = await this.backtestQueue.getWaitingCount()
      const active = await this.backtestQueue.getActiveCount()

      this.queueDepthGauge.set({ queue: BACKTESTING_QUEUE }, waiting)
      this.activeJobsGauge.set({ queue: BACKTESTING_QUEUE }, active)
    } catch (error) {
      this.logger.warn(`队列指标采集失败: ${(error as Error).message}`)
    }
  }
}
