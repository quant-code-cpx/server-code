import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Notification, NotificationType, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import {
  ListNotificationsDto,
  NotificationItemDto,
  NotificationListDataDto,
  NotificationPreferenceItemDto,
  UnreadCountDataDto,
  UpdateNotificationPreferenceDto,
} from './dto/notification.dto'

export interface CreateNotificationInput {
  userId: number
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  deliveryId?: string
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /** 持久化通知是权威结果；WebSocket 仅是失败可忽略的实时加速。 */
  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
      select: { enabled: true },
    })
    if (pref?.enabled === false) {
      this.logger.debug(`[Notification] 用户 ${input.userId} 已关闭 ${input.type} 类型通知，跳过`)
      return null
    }

    if (input.deliveryId) {
      const existing = await this.prisma.notification.findUnique({ where: { deliveryId: input.deliveryId } })
      if (existing) return existing
    }

    let notification: Notification
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
          ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
        },
      })
    } catch (error) {
      if (input.deliveryId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.notification.findUniqueOrThrow({ where: { deliveryId: input.deliveryId } })
      }
      throw error
    }

    try {
      this.eventsGateway.emitToUser(input.userId, 'notification', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        isRead: false,
        createdAt: notification.createdAt,
      })
    } catch {
      this.logger.warn(
        { operation: 'notification.websocketEmit', notificationId: notification.id },
        NotificationService.name,
      )
    }
    return notification
  }

  async list(userId: number, dto: ListNotificationsDto): Promise<NotificationListDataDto> {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    const skip = (page - 1) * pageSize
    const where = { userId, ...(dto.unreadOnly ? { isRead: false } : {}) }

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ])

    return {
      page,
      pageSize,
      total,
      unreadCount,
      items: items.map(this.toItemDto),
    }
  }

  async getUnreadCount(userId: number): Promise<UnreadCountDataDto> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    })
    return { unreadCount }
  }

  async markRead(userId: number, id: number): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    })
    if (!notification) throw new NotFoundException('通知不存在或无权访问')

    if (!notification.isRead) {
      await this.prisma.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      })
    }
  }

  async markAllRead(userId: number): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
  }

  async deleteNotification(userId: number, id: number): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    })
    if (!notification) throw new NotFoundException('通知不存在或无权访问')
    await this.prisma.notification.delete({ where: { id } })
  }

  async getPreferences(userId: number): Promise<NotificationPreferenceItemDto[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { type: true, enabled: true },
    })

    // 返回所有类型，未配置的默认 enabled=true
    const prefMap = new Map(prefs.map((p) => [p.type, p.enabled]))
    return Object.values(NotificationType).map((type) => ({
      type,
      enabled: prefMap.get(type) ?? true,
    }))
  }

  async updatePreference(userId: number, dto: UpdateNotificationPreferenceDto): Promise<void> {
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: dto.type } },
      create: { userId, type: dto.type, enabled: dto.enabled },
      update: { enabled: dto.enabled },
    })
  }

  private toItemDto(n: {
    id: number
    type: NotificationType
    title: string
    body: string
    data: unknown
    isRead: boolean
    readAt: Date | null
    createdAt: Date
  }): NotificationItemDto {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: (n.data ?? {}) as Record<string, unknown>,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }
  }
}
