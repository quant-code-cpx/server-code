import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { AGENT_NOTIFICATION_JOB_NAME, AGENT_NOTIFICATION_QUEUE, notificationJobId } from './agent.queue.constants'

export interface AgentNotificationJob {
  deliveryId: string
}

@Injectable()
export class AgentNotificationQueueService {
  constructor(@InjectQueue(AGENT_NOTIFICATION_QUEUE) private readonly queue: Queue<AgentNotificationJob>) {}

  async enqueueDelivery(deliveryId: string): Promise<void> {
    const jobId = notificationJobId(deliveryId)
    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (!['completed', 'failed', 'unknown'].includes(state)) return
      await existing.remove()
    }
    await this.queue.add(AGENT_NOTIFICATION_JOB_NAME, { deliveryId }, { jobId })
  }
}
