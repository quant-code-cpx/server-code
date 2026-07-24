import { Injectable } from '@nestjs/common'
import { AiNotificationChannelType, NotificationType } from '@prisma/client'
import { NotificationService } from '../notification.service'
import type {
  NotificationChannelAdapter,
  NotificationChannelRecord,
  NotificationChannelSendResult,
  NotificationDeliveryEnvelope,
} from './notification-channel.port'

@Injectable()
export class InAppNotificationChannel implements NotificationChannelAdapter {
  readonly type = AiNotificationChannelType.IN_APP

  constructor(private readonly notifications: NotificationService) {}

  async send(
    channel: NotificationChannelRecord,
    envelope: NotificationDeliveryEnvelope,
  ): Promise<NotificationChannelSendResult> {
    const notification = await this.notifications.create({
      userId: channel.userId,
      type: NotificationType.SYSTEM,
      title: envelope.subject,
      body: envelope.summary,
      data: {
        source: 'AGENT_DELIVERY',
        runId: envelope.runId,
        executionId: envelope.executionId,
        deepLink: envelope.deepLink,
      },
      deliveryId: envelope.deliveryId,
    })
    if (!notification) return { providerMessageId: null, httpStatus: null, suppressed: true }
    return { providerMessageId: `in-app:${notification.id}`, httpStatus: null }
  }
}
