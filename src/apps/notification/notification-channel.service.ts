import { Injectable } from '@nestjs/common'
import { AiNotificationChannelStatus, AiNotificationChannelType, Prisma } from '@prisma/client'
import { AgentHttpException } from 'src/apps/agent/api/agent-http.exception'
import { PrismaService } from 'src/shared/prisma.service'
import {
  WebhookNotificationChannel,
  type WebhookNotificationChannelConfig,
} from './channels/webhook.notification-channel'
import { NotificationCryptoService } from './notification-crypto.service'
import {
  CreateNotificationChannelDto,
  ListNotificationChannelsDto,
  UpdateNotificationChannelDto,
} from './dto/agent-notification-request.dto'

@Injectable()
export class NotificationChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: NotificationCryptoService,
    private readonly webhook: WebhookNotificationChannel,
  ) {}

  async create(userId: number, dto: CreateNotificationChannelDto) {
    if (dto.type === AiNotificationChannelType.IN_APP) {
      if (dto.webhookUrl !== undefined || dto.secret !== undefined) {
        throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', '站内渠道不接受外部配置')
      }
      return this.toResponse(
        await this.prisma.aiNotificationChannel.create({
          data: { userId, type: dto.type, name: dto.name, verifiedAt: new Date() },
        }),
      )
    }
    if (!dto.webhookUrl || !dto.secret) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', 'Webhook 缺少 URL 或 secret')
    }
    const config = { webhookUrl: dto.webhookUrl, secret: dto.secret }
    await this.validateWebhook(config)
    const encrypted = this.crypto.encrypt(config)
    return this.toResponse(
      await this.prisma.aiNotificationChannel.create({
        data: {
          userId,
          type: AiNotificationChannelType.WEBHOOK,
          name: dto.name,
          encryptedConfig: encrypted.ciphertext,
          configKeyVersion: encrypted.keyVersion,
          configFingerprint: encrypted.fingerprint,
          lastFour: lastFour(dto.secret),
        },
      }),
    )
  }

  async list(userId: number, dto: ListNotificationChannelsDto) {
    const rows = await this.prisma.aiNotificationChannel.findMany({
      where: { userId, deletedAt: null, ...(dto.cursor ? { id: { lt: dto.cursor } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: dto.limit + 1,
    })
    const items = rows.slice(0, dto.limit)
    return {
      items: items.map((channel) => this.toResponse(channel)),
      nextCursor: rows.length > dto.limit ? (items.at(-1)?.id ?? null) : null,
    }
  }

  async update(userId: number, dto: UpdateNotificationChannelDto) {
    const channel = await this.findOwned(userId, dto.channelId)
    const data: Prisma.AiNotificationChannelUpdateManyMutationInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.enabled !== undefined)
      data.status = dto.enabled ? AiNotificationChannelStatus.ACTIVE : AiNotificationChannelStatus.DISABLED

    if (channel.type === AiNotificationChannelType.IN_APP) {
      if (dto.webhookUrl !== undefined || dto.secret !== undefined) {
        throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', '站内渠道不接受外部配置')
      }
    } else if (dto.webhookUrl !== undefined || dto.secret !== undefined) {
      const previous = this.decryptWebhookConfig(channel)
      const config = { webhookUrl: dto.webhookUrl ?? previous.webhookUrl, secret: dto.secret ?? previous.secret }
      await this.validateWebhook(config)
      const encrypted = this.crypto.encrypt(config)
      data.encryptedConfig = encrypted.ciphertext
      data.configKeyVersion = encrypted.keyVersion
      data.configFingerprint = encrypted.fingerprint
      data.lastFour = lastFour(config.secret)
      data.verifiedAt = null
    }
    if (Object.keys(data).length === 0) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', '至少提供一个可更新字段')
    }
    const result = await this.prisma.aiNotificationChannel.updateMany({
      where: { id: channel.id, userId, deletedAt: null, version: dto.expectedVersion },
      data: { ...data, version: { increment: 1 } },
    })
    if (result.count !== 1) throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_CONFLICT')
    return this.toResponse(await this.findOwned(userId, channel.id))
  }

  async delete(userId: number, channelId: string, expectedVersion: number) {
    const channel = await this.findOwned(userId, channelId)
    const result = await this.prisma.aiNotificationChannel.updateMany({
      where: { id: channel.id, userId, deletedAt: null, version: expectedVersion },
      data: {
        status: AiNotificationChannelStatus.DELETED,
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    })
    if (result.count !== 1) throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_CONFLICT')
    return this.toResponse(await this.prisma.aiNotificationChannel.findUniqueOrThrow({ where: { id: channel.id } }))
  }

  async test(userId: number, channelId: string) {
    const channel = await this.findOwned(userId, channelId)
    if (channel.status !== AiNotificationChannelStatus.ACTIVE) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_CONFLICT', '停用渠道不可测试')
    }
    if (channel.type === AiNotificationChannelType.WEBHOOK) {
      const config = this.decryptWebhookConfig(channel)
      await this.validateWebhook(config)
    }
    const adapter = channel.type === AiNotificationChannelType.WEBHOOK ? this.webhook : null
    if (adapter) {
      try {
        await adapter.send(
          channel,
          {
            deliveryId: `test-${channel.id}`,
            runId: null,
            executionId: null,
            subject: 'Agent 通知渠道测试',
            summary: '这是用于验证通知渠道配置的测试消息。',
            deepLink: '/agent',
            occurredAt: new Date().toISOString(),
          },
          `test:${channel.id}:${Date.now()}`,
        )
      } catch {
        throw AgentHttpException.fromKey('AI_NOTIFICATION_DELIVERY_FAILED', '通知渠道测试发送失败')
      }
    }
    const verifiedAt = new Date()
    const updated = await this.prisma.aiNotificationChannel.update({ where: { id: channel.id }, data: { verifiedAt } })
    return { channelId: updated.id, verified: true, verifiedAt: verifiedAt.toISOString() }
  }

  private async findOwned(userId: number, channelId: string) {
    const channel = await this.prisma.aiNotificationChannel.findFirst({
      where: { id: channelId, userId, deletedAt: null },
    })
    if (!channel) throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_NOT_FOUND')
    return channel
  }

  private decryptWebhookConfig(channel: {
    encryptedConfig: string | null
    configKeyVersion: number | null
  }): WebhookNotificationChannelConfig {
    if (!channel.encryptedConfig || channel.configKeyVersion === null) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', 'Webhook 配置不可用')
    }
    try {
      const config = this.crypto.decrypt<WebhookNotificationChannelConfig>(
        channel.encryptedConfig,
        channel.configKeyVersion,
      )
      if (typeof config.webhookUrl !== 'string' || typeof config.secret !== 'string') throw new Error('invalid')
      return config
    } catch {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', 'Webhook 配置不可用')
    }
  }

  private async validateWebhook(config: WebhookNotificationChannelConfig): Promise<void> {
    try {
      await this.webhook.validateConfig(config)
    } catch {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', 'Webhook 不符合安全策略或无法验证')
    }
  }

  private toResponse(channel: {
    id: string
    type: AiNotificationChannelType
    name: string
    status: AiNotificationChannelStatus
    version: number
    verifiedAt: Date | null
    lastFour: string | null
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      channelId: channel.id,
      type: channel.type,
      name: channel.name,
      status: channel.status,
      version: channel.version,
      isVerified: channel.type === AiNotificationChannelType.IN_APP || channel.verifiedAt !== null,
      lastFour: channel.lastFour,
      verifiedAt: channel.verifiedAt?.toISOString() ?? null,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    }
  }
}

function lastFour(value: string): string {
  return value.slice(-4)
}
