import { AiNotificationChannelType } from '@prisma/client'

export interface NotificationDeliveryEnvelope {
  deliveryId: string
  runId: string | null
  executionId: string | null
  subject: string
  summary: string
  deepLink: string
  occurredAt: string
}

export interface NotificationChannelRecord {
  id: string
  userId: number
  type: AiNotificationChannelType
  encryptedConfig: string | null
  configKeyVersion: number | null
}

export interface NotificationChannelSendResult {
  providerMessageId: string | null
  httpStatus: number | null
  suppressed?: boolean
}

export interface NotificationChannelAdapter {
  readonly type: AiNotificationChannelType
  send(
    channel: NotificationChannelRecord,
    envelope: NotificationDeliveryEnvelope,
    idempotencyKey: string,
  ): Promise<NotificationChannelSendResult>
}

export class NotificationDeliveryError extends Error {
  constructor(
    readonly classification: 'TRANSIENT' | 'PERMANENT' | 'SECURITY',
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message)
    this.name = NotificationDeliveryError.name
  }
}

export const NOTIFICATION_CHANNEL_ADAPTERS = Symbol('NOTIFICATION_CHANNEL_ADAPTERS')
