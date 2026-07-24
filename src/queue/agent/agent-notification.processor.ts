import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job, UnrecoverableError } from 'bullmq'
import { NotificationDeliveryService } from 'src/apps/notification/notification-delivery.service'
import { buildAgentNotificationConfig } from 'src/config/agent-notification.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import {
  AGENT_BULL_CONFIG_KEY,
  AGENT_NOTIFICATION_JOB_NAME,
  AGENT_NOTIFICATION_QUEUE,
  notificationJobId,
} from './agent.queue.constants'
import type { AgentNotificationJob } from './agent-notification-queue.service'

const workerOptions = buildAgentNotificationConfig(process.env)

@Injectable()
@Processor(
  { name: AGENT_NOTIFICATION_QUEUE, configKey: AGENT_BULL_CONFIG_KEY },
  { concurrency: workerOptions.workerConcurrency, lockDuration: 30_000, stalledInterval: 30_000, maxStalledCount: 2 },
)
export class AgentNotificationProcessor extends WorkerHost {
  constructor(
    private readonly deliveries: NotificationDeliveryService,
    private readonly logger: LoggerService,
  ) {
    super()
  }

  async process(job: Job<AgentNotificationJob>) {
    if (job.name !== AGENT_NOTIFICATION_JOB_NAME) throw new UnrecoverableError('未知通知 job name')
    if (!job.data?.deliveryId || job.id !== notificationJobId(job.data.deliveryId)) {
      throw new UnrecoverableError('通知 job payload 或 jobId 非法')
    }
    const result = await this.deliveries.process(
      job.data.deliveryId,
      `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 128),
    )
    this.logger.log(
      { operation: 'agentNotificationProcessor.process', deliveryId: job.data.deliveryId, result },
      AgentNotificationProcessor.name,
    )
    return result
  }
}
