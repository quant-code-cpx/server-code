import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentQueueProducerModule } from 'src/queue/agent/agent-queue-producer.module'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { AgentNotificationConfig } from 'src/config/agent-notification.config'
import {
  AgentNotificationChannelController,
  AgentNotificationDeliveryController,
} from './agent-notification.controller'
import { InAppNotificationChannel } from './channels/in-app.notification-channel'
import { NOTIFICATION_CHANNEL_ADAPTERS } from './channels/notification-channel.port'
import { WebhookNotificationChannel } from './channels/webhook.notification-channel'
import { NotificationChannelService } from './notification-channel.service'
import { NotificationController } from './notification.controller'
import { NotificationCryptoService } from './notification-crypto.service'
import { NotificationDeliveryService } from './notification-delivery.service'
import { NotificationService } from './notification.service'

@Module({
  imports: [ConfigModule.forFeature(AgentNotificationConfig), WebsocketModule, AgentQueueProducerModule],
  controllers: [NotificationController, AgentNotificationChannelController, AgentNotificationDeliveryController],
  providers: [
    NotificationService,
    NotificationCryptoService,
    InAppNotificationChannel,
    WebhookNotificationChannel,
    {
      provide: NOTIFICATION_CHANNEL_ADAPTERS,
      inject: [InAppNotificationChannel, WebhookNotificationChannel],
      useFactory: (inApp: InAppNotificationChannel, webhook: WebhookNotificationChannel) => [inApp, webhook],
    },
    NotificationChannelService,
    NotificationDeliveryService,
  ],
  exports: [NotificationService, NotificationDeliveryService],
})
export class NotificationModule {}
