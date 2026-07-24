import { Inject, Injectable } from '@nestjs/common'
import {
  AiNotificationChannelStatus,
  AiNotificationChannelType,
  AiNotificationDeliveryAttemptStatus,
  AiNotificationDeliveryStatus,
  Prisma,
  type AiAgentRun,
} from '@prisma/client'
import { createHash } from 'node:crypto'
import { AgentHttpException } from 'src/apps/agent/api/agent-http.exception'
import { AgentNotificationConfig, type IAgentNotificationConfig } from 'src/config/agent-notification.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  NOTIFICATION_CHANNEL_ADAPTERS,
  NotificationDeliveryError,
  type NotificationChannelAdapter,
  type NotificationDeliveryEnvelope,
} from './channels/notification-channel.port'

const ACTIVE_DELIVERY_CHANNELS: Prisma.AiNotificationChannelWhereInput = {
  status: AiNotificationChannelStatus.ACTIVE,
  deletedAt: null,
  OR: [
    { type: AiNotificationChannelType.IN_APP },
    { type: AiNotificationChannelType.WEBHOOK, verifiedAt: { not: null } },
  ],
}

export interface NotificationDeliveryListInput {
  cursor: string | null
  limit: number
  status?: AiNotificationDeliveryStatus
}

export interface EnqueueCompletedRunInput {
  run: Pick<AiAgentRun, 'id' | 'userId' | 'conversationId'>
  completedAt: Date
}

@Injectable()
export class NotificationDeliveryService {
  private readonly adapters = new Map<AiNotificationChannelType, NotificationChannelAdapter>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AgentNotificationConfig.KEY) private readonly config: IAgentNotificationConfig,
    @Inject(NOTIFICATION_CHANNEL_ADAPTERS) adapters: readonly NotificationChannelAdapter[],
    private readonly logger: LoggerService,
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.type, adapter)
  }

  /** Must run in the same transaction as Agent Run completion. */
  async enqueueForCompletedRun(tx: Prisma.TransactionClient, input: EnqueueCompletedRunInput): Promise<number> {
    const [execution, channels] = await Promise.all([
      tx.aiTaskExecution.findUnique({ where: { runId: input.run.id }, select: { id: true } }),
      tx.aiNotificationChannel.findMany({
        where: { userId: input.run.userId, ...ACTIVE_DELIVERY_CHANNELS },
        select: { id: true },
      }),
    ])
    if (channels.length === 0) return 0

    const payload = createPayload(input.run, input.completedAt)
    const payloadHash = hashJson(payload)
    const result = await tx.aiNotificationDelivery.createMany({
      data: channels.map((channel) => ({
        userId: input.run.userId,
        channelId: channel.id,
        executionId: execution?.id ?? null,
        runId: input.run.id,
        idempotencyKey: createDeliveryKey(input.run.id, channel.id),
        payload: payload as Prisma.InputJsonValue,
        payloadHash,
        maxAttempts: this.config.deliveryMaxAttempts,
      })),
      skipDuplicates: true,
    })
    return result.count
  }

  async list(userId: number, input: NotificationDeliveryListInput) {
    const rows = await this.prisma.aiNotificationDelivery.findMany({
      where: {
        userId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      include: { channel: { select: { name: true, type: true } } },
    })
    const items = rows.slice(0, input.limit)
    return {
      items: items.map((delivery) => ({
        deliveryId: delivery.id,
        channelId: delivery.channelId,
        channelName: delivery.channel.name,
        channelType: delivery.channel.type,
        executionId: delivery.executionId,
        runId: delivery.runId,
        status: delivery.status,
        attempt: delivery.attempt,
        maxAttempts: delivery.maxAttempts,
        nextAttemptAt: delivery.nextAttemptAt.toISOString(),
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        providerMessageId: delivery.providerMessageId,
        errorClass: delivery.errorClass,
        createdAt: delivery.createdAt.toISOString(),
      })),
      nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
    }
  }

  async retry(userId: number, deliveryId: string) {
    const delivery = await this.prisma.aiNotificationDelivery.findFirst({
      where: { id: deliveryId, userId },
      include: { channel: { select: { status: true, deletedAt: true, verifiedAt: true, type: true } } },
    })
    if (!delivery) throw AgentHttpException.fromKey('AI_NOTIFICATION_DELIVERY_NOT_FOUND')
    if (
      delivery.status === AiNotificationDeliveryStatus.DELIVERED ||
      delivery.status === AiNotificationDeliveryStatus.SENDING
    ) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_DELIVERY_CONFLICT', '该投递当前不可重试')
    }
    if (!isChannelDeliverable(delivery.channel)) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_DELIVERY_CONFLICT', '通知渠道未启用或尚未验证')
    }
    return this.prisma.aiNotificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: AiNotificationDeliveryStatus.PENDING,
        maxAttempts: { increment: this.config.deliveryMaxAttempts },
        nextAttemptAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorClass: null,
        errorMessage: null,
      },
      include: { channel: { select: { name: true, type: true } } },
    })
  }

  async publishableDeliveryIds(limit: number): Promise<string[]> {
    const now = new Date()
    const rows = await this.prisma.aiNotificationDelivery.findMany({
      where: {
        OR: [
          {
            status: { in: [AiNotificationDeliveryStatus.PENDING, AiNotificationDeliveryStatus.RETRY] },
            nextAttemptAt: { lte: now },
          },
          { status: AiNotificationDeliveryStatus.SENDING, leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    })
    return rows.map((row) => row.id)
  }

  async process(
    deliveryId: string,
    workerId: string,
  ): Promise<'DELIVERED' | 'RETRY' | 'FAILED' | 'SUPPRESSED' | 'IGNORED'> {
    const claimed = await this.claim(deliveryId, workerId)
    if (!claimed) return 'IGNORED'
    if (!isChannelDeliverable(claimed.channel)) return this.suppress(claimed, 'CHANNEL_UNAVAILABLE')

    const adapter = this.adapters.get(claimed.channel.type)
    if (!adapter) return this.fail(claimed, new NotificationDeliveryError('PERMANENT', '通知渠道 adapter 未注册'))

    const envelope = parsePayload(claimed.payload, claimed.id, claimed.runId, claimed.executionId)
    try {
      const result = await adapter.send(claimed.channel, envelope, claimed.idempotencyKey)
      if (result.suppressed) return this.suppress(claimed, 'USER_PREFERENCE_DISABLED')
      await this.prisma.$transaction([
        this.prisma.aiNotificationDelivery.update({
          where: { id: claimed.id },
          data: {
            status: AiNotificationDeliveryStatus.DELIVERED,
            providerMessageId: result.providerMessageId,
            deliveredAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            errorClass: null,
            errorMessage: null,
          },
        }),
        this.prisma.aiNotificationDeliveryAttempt.create({
          data: {
            deliveryId: claimed.id,
            attempt: claimed.attempt,
            status: AiNotificationDeliveryAttemptStatus.DELIVERED,
            providerMessageId: result.providerMessageId,
            httpStatus: result.httpStatus,
          },
        }),
      ])
      return 'DELIVERED'
    } catch (error) {
      return this.fail(claimed, toDeliveryError(error))
    }
  }

  private async claim(deliveryId: string, workerId: string) {
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + this.config.deliveryLeaseMs)
    const result = await this.prisma.aiNotificationDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [
          {
            status: { in: [AiNotificationDeliveryStatus.PENDING, AiNotificationDeliveryStatus.RETRY] },
            nextAttemptAt: { lte: now },
          },
          { status: AiNotificationDeliveryStatus.SENDING, leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: AiNotificationDeliveryStatus.SENDING,
        attempt: { increment: 1 },
        leaseOwner: workerId,
        leaseExpiresAt,
      },
    })
    if (result.count !== 1) return null
    return this.prisma.aiNotificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: {
        channel: {
          select: {
            id: true,
            userId: true,
            type: true,
            encryptedConfig: true,
            configKeyVersion: true,
            status: true,
            deletedAt: true,
            verifiedAt: true,
          },
        },
      },
    })
  }

  private async suppress(
    delivery: Awaited<ReturnType<NotificationDeliveryService['claim']>> & {},
    reason: string,
  ): Promise<'SUPPRESSED'> {
    await this.prisma.$transaction([
      this.prisma.aiNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: AiNotificationDeliveryStatus.SUPPRESSED,
          leaseOwner: null,
          leaseExpiresAt: null,
          errorClass: reason,
          errorMessage: null,
        },
      }),
      this.prisma.aiNotificationDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attempt: delivery.attempt,
          status: AiNotificationDeliveryAttemptStatus.SUPPRESSED,
          errorClass: reason,
        },
      }),
    ])
    return 'SUPPRESSED'
  }

  private async fail(
    delivery: Awaited<ReturnType<NotificationDeliveryService['claim']>> & {},
    error: NotificationDeliveryError,
  ): Promise<'RETRY' | 'FAILED'> {
    const retryable = error.classification === 'TRANSIENT' && delivery.attempt < delivery.maxAttempts
    const status = retryable ? AiNotificationDeliveryStatus.RETRY : AiNotificationDeliveryStatus.FAILED
    const attemptStatus = retryable
      ? AiNotificationDeliveryAttemptStatus.RETRY
      : AiNotificationDeliveryAttemptStatus.FAILED
    const nextAttemptAt = retryable
      ? new Date(Date.now() + Math.min(this.config.deliveryBackoffMs * 2 ** Math.max(0, delivery.attempt - 1), 300_000))
      : new Date()
    await this.prisma.$transaction([
      this.prisma.aiNotificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          nextAttemptAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          errorClass: error.classification,
          errorMessage: error.message.slice(0, 512),
        },
      }),
      this.prisma.aiNotificationDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attempt: delivery.attempt,
          status: attemptStatus,
          httpStatus: error.httpStatus,
          errorClass: error.classification,
          errorMessage: error.message.slice(0, 512),
        },
      }),
    ])
    this.logger.warn(
      {
        operation: 'agentNotification.delivery',
        deliveryId: delivery.id,
        channelId: delivery.channelId,
        result: status,
        errorClass: error.classification,
      },
      NotificationDeliveryService.name,
    )
    return retryable ? 'RETRY' : 'FAILED'
  }
}

function createPayload(run: EnqueueCompletedRunInput['run'], completedAt: Date) {
  return {
    version: 1,
    subject: 'Agent 研究已完成',
    summary: '研究结果已生成，请在系统内查看。',
    deepLink: `/agent?conversationId=${encodeURIComponent(run.conversationId)}&runId=${encodeURIComponent(run.id)}`,
    occurredAt: completedAt.toISOString(),
  }
}

function parsePayload(
  value: unknown,
  deliveryId: string,
  runId: string | null,
  executionId: string | null,
): NotificationDeliveryEnvelope {
  const payload = value as Record<string, unknown>
  if (
    !payload ||
    payload.version !== 1 ||
    typeof payload.subject !== 'string' ||
    typeof payload.summary !== 'string' ||
    typeof payload.deepLink !== 'string' ||
    typeof payload.occurredAt !== 'string'
  ) {
    throw new NotificationDeliveryError('PERMANENT', 'Notification payload 非法')
  }
  return {
    deliveryId,
    runId,
    executionId,
    subject: payload.subject,
    summary: payload.summary,
    deepLink: payload.deepLink,
    occurredAt: payload.occurredAt,
  }
}

function isChannelDeliverable(channel: {
  status: AiNotificationChannelStatus
  deletedAt: Date | null
  verifiedAt: Date | null
  type: AiNotificationChannelType
}): boolean {
  return (
    channel.status === AiNotificationChannelStatus.ACTIVE &&
    channel.deletedAt === null &&
    (channel.type === AiNotificationChannelType.IN_APP || channel.verifiedAt !== null)
  )
}

function createDeliveryKey(runId: string, channelId: string): string {
  return createHash('sha256').update(`agent-notification:v1:${runId}:${channelId}`, 'utf8').digest('hex')
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function toDeliveryError(error: unknown): NotificationDeliveryError {
  if (error instanceof NotificationDeliveryError) return error
  return new NotificationDeliveryError('TRANSIENT', '通知投递内部失败')
}
