import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Interval } from '@nestjs/schedule'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Queue } from 'bullmq'
import type { Gauge } from 'prom-client'
import { LoggerService } from 'src/shared/logger/logger.service'
import {
  BULLMQ_ACTIVE_JOBS,
  BULLMQ_DELAYED_JOBS,
  BULLMQ_FAILED_JOBS,
  BULLMQ_QUEUE_DEPTH,
} from 'src/shared/metrics/metrics.constants'
import { AGENT_EXECUTION_QUEUE } from './agent.queue.constants'

@Injectable()
export class AgentQueueMetricsService {
  constructor(
    @InjectQueue(AGENT_EXECUTION_QUEUE) private readonly queue: Queue,
    @InjectMetric(BULLMQ_QUEUE_DEPTH) private readonly waiting: Gauge,
    @InjectMetric(BULLMQ_ACTIVE_JOBS) private readonly active: Gauge,
    @InjectMetric(BULLMQ_FAILED_JOBS) private readonly failed: Gauge,
    @InjectMetric(BULLMQ_DELAYED_JOBS) private readonly delayed: Gauge,
    private readonly logger: LoggerService,
  ) {}

  @Interval('agent-queue-metrics', 10_000)
  async collect(): Promise<void> {
    try {
      const [waiting, active, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ])
      const labels = { queue: AGENT_EXECUTION_QUEUE }
      this.waiting.set(labels, waiting)
      this.active.set(labels, active)
      this.failed.set(labels, failed)
      this.delayed.set(labels, delayed)
    } catch (error) {
      this.logger.warn(
        { operation: 'agentQueue.metrics', error: error instanceof Error ? error.message : String(error) },
        AgentQueueMetricsService.name,
      )
    }
  }
}
