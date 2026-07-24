import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { NotificationDeliveryService } from 'src/apps/notification/notification-delivery.service'
import {
  AgentNotificationConfig,
  buildAgentNotificationConfig,
  type IAgentNotificationConfig,
} from 'src/config/agent-notification.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AGENT_NOTIFICATION_RECONCILER_INTERVAL_NAME } from './agent.queue.constants'
import { AgentNotificationQueueService } from './agent-notification-queue.service'

const options = buildAgentNotificationConfig(process.env)

@Injectable()
export class AgentNotificationReconcilerService implements OnModuleInit {
  private running = false

  constructor(
    private readonly deliveries: NotificationDeliveryService,
    private readonly queue: AgentNotificationQueueService,
    @Inject(AgentNotificationConfig.KEY) private readonly config: IAgentNotificationConfig,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    void this.publishDueDeliveries()
  }

  @Interval(AGENT_NOTIFICATION_RECONCILER_INTERVAL_NAME, options.reconcileIntervalMs)
  async publishDueDeliveries(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const deliveryIds = await this.deliveries.publishableDeliveryIds(this.config.reconcileBatchSize)
      let published = 0
      for (const deliveryId of deliveryIds) {
        try {
          await this.queue.enqueueDelivery(deliveryId)
          published += 1
        } catch {
          this.logger.warn(
            { operation: 'agentNotificationReconciler.enqueue', deliveryId },
            AgentNotificationReconcilerService.name,
          )
        }
      }
      return published
    } finally {
      this.running = false
    }
  }
}
