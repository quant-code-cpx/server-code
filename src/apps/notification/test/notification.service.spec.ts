/**
 * NotificationService — 单元测试
 *
 * 覆盖要点：
 * - create: 用户偏好 enabled=false 时跳过，不写库不推送
 * - create: 用户偏好 enabled=true 或不存在时，写库并 emitToUser
 * - list: 无读过滤 → 调用 findMany+count+unreadCount，返回正确 DTO
 * - list: unreadOnly=true → where 包含 isRead:false
 * - getUnreadCount: 调用 count({ isRead:false })，返回正确值
 * - markRead: 通知不存在时抛 NotFoundException
 * - markRead: 已读时不重复 update
 * - markRead: 未读时 update 并设置 readAt
 * - markAllRead: 调用 updateMany({ isRead:false })
 * - deleteNotification: 不存在时抛 NotFoundException
 * - deleteNotification: 存在时调用 delete
 * - getPreferences: 未配置类型默认 enabled=true
 * - updatePreference: 调用 upsert
 */

import { NotFoundException } from '@nestjs/common'
import { NotificationType } from '@prisma/client'
import { NotificationService } from '../notification.service'

function buildPrismaMock() {
  return {
    notificationPreference: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async () => ({})),
    },
    notification: {
      create: jest.fn(async () => ({
        id: 1,
        type: NotificationType.PRICE_ALERT,
        title: '测试标题',
        body: '测试内容',
        data: {},
        isRead: false,
        createdAt: new Date('2026-01-01'),
      })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 5 })),
      delete: jest.fn(async () => ({})),
    },
  }
}

function buildGatewayMock() {
  return { emitToUser: jest.fn() }
}

function createService(prismaMock = buildPrismaMock(), gatewayMock = buildGatewayMock()) {
  return new NotificationService(prismaMock as any, gatewayMock as any)
}

describe('NotificationService', () => {
  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('enabled=false → 跳过写库和推送', async () => {
      const prisma = buildPrismaMock()
      prisma.notificationPreference.findUnique.mockResolvedValue({ enabled: false } as any)
      const gateway = buildGatewayMock()
      const svc = createService(prisma, gateway)

      await svc.create({ userId: 1, type: NotificationType.PRICE_ALERT, title: 'T', body: 'B' })

      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(gateway.emitToUser).not.toHaveBeenCalled()
    })

    it('偏好不存在 → 写库并 emitToUser', async () => {
      const prisma = buildPrismaMock()
      prisma.notificationPreference.findUnique.mockResolvedValue(null)
      const gateway = buildGatewayMock()
      const svc = createService(prisma, gateway)

      await svc.create({ userId: 2, type: NotificationType.SYSTEM, title: '系统消息', body: '内容' })

      expect(prisma.notification.create).toHaveBeenCalledTimes(1)
      expect(gateway.emitToUser).toHaveBeenCalledWith(2, 'notification', expect.objectContaining({ isRead: false }))
    })

    it('偏好 enabled=true → 写库并 emitToUser', async () => {
      const prisma = buildPrismaMock()
      prisma.notificationPreference.findUnique.mockResolvedValue({ enabled: true } as any)
      const gateway = buildGatewayMock()
      const svc = createService(prisma, gateway)

      await svc.create({ userId: 3, type: NotificationType.MARKET_ANOMALY, title: '异动', body: '内容' })

      expect(prisma.notification.create).toHaveBeenCalledTimes(1)
      expect(gateway.emitToUser).toHaveBeenCalledWith(3, 'notification', expect.anything())
    })
  })

  // ─── list ────────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('正常返回分页结构', async () => {
      const prisma = buildPrismaMock()
      const mockItem = {
        id: 1,
        type: NotificationType.SYSTEM,
        title: '标题',
        body: '正文',
        data: {},
        isRead: false,
        readAt: null,
        createdAt: new Date('2026-01-01'),
      }
      prisma.notification.findMany.mockResolvedValue([mockItem as any])
      prisma.notification.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3)

      const svc = createService(prisma)
      const result = await svc.list(1, { page: 1, pageSize: 20 })

      expect(result.page).toBe(1)
      expect(result.total).toBe(10)
      expect(result.unreadCount).toBe(3)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe(1)
    })

    it('unreadOnly=true → where 含 isRead:false', async () => {
      const prisma = buildPrismaMock()
      const svc = createService(prisma)
      await svc.list(1, { unreadOnly: true })
      const callArg = (prisma.notification.findMany.mock.calls[0] as any[])[0]
      expect(callArg?.where).toMatchObject({ userId: 1, isRead: false })
    })
  })

  // ─── getUnreadCount ──────────────────────────────────────────────────────────

  describe('getUnreadCount()', () => {
    it('返回 unreadCount', async () => {
      const prisma = buildPrismaMock()
      prisma.notification.count.mockResolvedValue(7)
      const svc = createService(prisma)
      const result = await svc.getUnreadCount(1)
      expect(result.unreadCount).toBe(7)
      expect(prisma.notification.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1, isRead: false } }),
      )
    })
  })

  // ─── markRead ────────────────────────────────────────────────────────────────

  describe('markRead()', () => {
    it('通知不存在 → 抛 NotFoundException', async () => {
      const svc = createService()
      await expect(svc.markRead(1, 999)).rejects.toThrow(NotFoundException)
    })

    it('已读时不重复 update', async () => {
      const prisma = buildPrismaMock()
      prisma.notification.findFirst.mockResolvedValue({ id: 1, userId: 1, isRead: true } as any)
      const svc = createService(prisma)
      await svc.markRead(1, 1)
      expect(prisma.notification.update).not.toHaveBeenCalled()
    })

    it('未读时调用 update 设置 isRead=true', async () => {
      const prisma = buildPrismaMock()
      prisma.notification.findFirst.mockResolvedValue({ id: 1, userId: 1, isRead: false } as any)
      const svc = createService(prisma)
      await svc.markRead(1, 1)
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isRead: true }) }),
      )
    })
  })

  // ─── markAllRead ─────────────────────────────────────────────────────────────

  describe('markAllRead()', () => {
    it('调用 updateMany 标记所有未读', async () => {
      const prisma = buildPrismaMock()
      const svc = createService(prisma)
      await svc.markAllRead(1)
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1, isRead: false } }),
      )
    })
  })

  // ─── deleteNotification ──────────────────────────────────────────────────────

  describe('deleteNotification()', () => {
    it('不存在时抛 NotFoundException', async () => {
      const svc = createService()
      await expect(svc.deleteNotification(1, 999)).rejects.toThrow(NotFoundException)
    })

    it('存在时调用 delete', async () => {
      const prisma = buildPrismaMock()
      prisma.notification.findFirst.mockResolvedValue({ id: 5, userId: 1 } as any)
      const svc = createService(prisma)
      await svc.deleteNotification(1, 5)
      expect(prisma.notification.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    })
  })

  // ─── getPreferences ──────────────────────────────────────────────────────────

  describe('getPreferences()', () => {
    it('未配置类型 → 默认 enabled=true', async () => {
      const svc = createService()
      const prefs = await svc.getPreferences(1)
      // 所有 NotificationType 都应该有一条记录
      const types = Object.values(NotificationType)
      expect(prefs).toHaveLength(types.length)
      prefs.forEach((p) => expect(p.enabled).toBe(true))
    })

    it('已配置 PRICE_ALERT enabled=false → 返回 false', async () => {
      const prisma = buildPrismaMock()
      prisma.notificationPreference.findMany.mockResolvedValue([
        { type: NotificationType.PRICE_ALERT, enabled: false } as any,
      ])
      const svc = createService(prisma)
      const prefs = await svc.getPreferences(1)
      const priceAlertPref = prefs.find((p) => p.type === NotificationType.PRICE_ALERT)
      expect(priceAlertPref?.enabled).toBe(false)
    })
  })

  // ─── updatePreference ────────────────────────────────────────────────────────

  describe('updatePreference()', () => {
    it('调用 upsert', async () => {
      const prisma = buildPrismaMock()
      const svc = createService(prisma)
      await svc.updatePreference(1, { type: NotificationType.SYSTEM, enabled: false })
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_type: { userId: 1, type: NotificationType.SYSTEM } },
          update: { enabled: false },
        }),
      )
    })
  })
})
