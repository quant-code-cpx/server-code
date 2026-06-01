/**
 * Notification 模块 API 测试 — 业务优先
 *
 * 覆盖：通知列表、未读计数、标记已读、删除通知、通知偏好
 * 方法：Test.createTestingModule + useGlobalGuards(mock) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { NotificationType } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { NotificationController } from '../notification.controller'
import { NotificationService } from '../notification.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Notification API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockNotificationService: Record<string, jest.Mock>

  const user = buildTestUser()

  const sampleNotification = {
    id: 1,
    type: NotificationType.PRICE_ALERT,
    title: '价格预警',
    body: '平安银行股价突破 15 元',
    data: { tsCode: '000001.SZ', price: 15.5 },
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-05-24T10:00:00Z'),
  }

  const sampleListResponse = {
    page: 1,
    pageSize: 20,
    total: 1,
    unreadCount: 1,
    items: [sampleNotification],
  }

  beforeEach(async () => {
    mockNotificationService = {
      list: jest.fn().mockResolvedValue(sampleListResponse),
      getUnreadCount: jest.fn().mockResolvedValue({ unreadCount: 3 }),
      markRead: jest.fn().mockResolvedValue(undefined),
      markAllRead: jest.fn().mockResolvedValue(undefined),
      deleteNotification: jest.fn().mockResolvedValue(undefined),
      getPreferences: jest.fn().mockResolvedValue([
        { type: NotificationType.PRICE_ALERT, enabled: true },
        { type: NotificationType.MARKET_ANOMALY, enabled: true },
        { type: NotificationType.SCREENER_ALERT, enabled: false },
        { type: NotificationType.SIGNAL_TRIGGERED, enabled: true },
        { type: NotificationType.SYSTEM, enabled: true },
      ]),
      updatePreference: jest.fn().mockResolvedValue(undefined),
    }

    const mockAuthGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationService, useValue: mockNotificationService }],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalGuards(mockAuthGuard)
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 通知列表 ──────────────────────────────────────────────────────────────

  describe('通知列表', () => {
    it('NT-BIZ-001: 查询通知列表（默认分页）', async () => {
      const res = await req
        .post('/notification/list')
        .send({})
        .expect(201)
      expect(res.body.data).toHaveProperty('page')
      expect(res.body.data).toHaveProperty('pageSize')
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data).toHaveProperty('unreadCount')
      expect(res.body.data).toHaveProperty('items')
      expect(Array.isArray(res.body.data.items)).toBe(true)
      expect(res.body.data.items).toHaveLength(1)
      expect(mockNotificationService.list).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1, pageSize: 20 }))
    })

    it('NT-BIZ-002: 查询未读通知列表', async () => {
      const res = await req
        .post('/notification/list')
        .send({ unreadOnly: true })
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(mockNotificationService.list).toHaveBeenCalledWith(1, expect.objectContaining({ unreadOnly: true }))
    })

    it('NT-ERR-001: page=0 应 400', async () => {
      await req
        .post('/notification/list')
        .send({ page: 0 })
        .expect(400)
    })

    it('NT-ERR-002: pageSize=0 应 400', async () => {
      await req
        .post('/notification/list')
        .send({ pageSize: 0 })
        .expect(400)
    })

    it('NT-EDGE-001: pageSize=100（最大）应 201', async () => {
      await req
        .post('/notification/list')
        .send({ pageSize: 100 })
        .expect(201)
      expect(mockNotificationService.list).toHaveBeenCalledWith(1, expect.objectContaining({ pageSize: 100 }))
    })

    it('NT-EDGE-002: pageSize=101 应 400', async () => {
      await req
        .post('/notification/list')
        .send({ pageSize: 101 })
        .expect(400)
    })
  })

  // ── 未读计数 ──────────────────────────────────────────────────────────────

  describe('未读计数', () => {
    it('NT-BIZ-003: 获取未读通知数', async () => {
      const res = await req
        .post('/notification/unread-count')
        .send({})
        .expect(201)
      expect(res.body.data).toHaveProperty('unreadCount')
      expect(res.body.data.unreadCount).toBe(3)
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith(1)
    })
  })

  // ── 标记已读 ──────────────────────────────────────────────────────────────

  describe('标记已读', () => {
    it('NT-BIZ-004: 标记指定通知已读', async () => {
      const res = await req
        .post('/notification/mark-read')
        .send({ id: 1 })
        .expect(201)
      expect(res.body.data).toBeNull()
      expect(mockNotificationService.markRead).toHaveBeenCalledWith(1, 1)
    })

    it('NT-BIZ-005: 标记所有通知已读', async () => {
      const res = await req
        .post('/notification/mark-all-read')
        .send({})
        .expect(201)
      expect(res.body.data).toBeNull()
      expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(1)
    })

    it('NT-ERR-003: mark-read 缺 id 应 400', async () => {
      await req
        .post('/notification/mark-read')
        .send({})
        .expect(400)
    })

    it('NT-ERR-004: mark-read id 非整数应 400', async () => {
      await req
        .post('/notification/mark-read')
        .send({ id: 'abc' })
        .expect(400)
    })
  })

  // ── 删除通知 ──────────────────────────────────────────────────────────────

  describe('删除通知', () => {
    it('NT-BIZ-006: 删除指定通知', async () => {
      const res = await req
        .post('/notification/delete')
        .send({ id: 1 })
        .expect(201)
      expect(res.body.data).toBeNull()
      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(1, 1)
    })

    it('NT-ERR-005: delete 缺 id 应 400', async () => {
      await req
        .post('/notification/delete')
        .send({})
        .expect(400)
    })

    it('NT-ERR-006: delete id 非整数应 400', async () => {
      await req
        .post('/notification/delete')
        .send({ id: 'abc' })
        .expect(400)
    })
  })

  // ── 通知偏好 ──────────────────────────────────────────────────────────────

  describe('通知偏好', () => {
    it('NT-BIZ-007: 获取通知偏好列表', async () => {
      const res = await req
        .post('/notification/preferences')
        .send({})
        .expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(5)
      expect(res.body.data[0]).toHaveProperty('type')
      expect(res.body.data[0]).toHaveProperty('enabled')
      expect(mockNotificationService.getPreferences).toHaveBeenCalledWith(1)
    })

    it('NT-BIZ-008: 更新通知偏好', async () => {
      const res = await req
        .post('/notification/preferences/update')
        .send({ type: NotificationType.PRICE_ALERT, enabled: false })
        .expect(201)
      expect(res.body.data).toBeNull()
      expect(mockNotificationService.updatePreference).toHaveBeenCalledWith(1, {
        type: NotificationType.PRICE_ALERT,
        enabled: false,
      })
    })

    it('NT-ERR-007: update 缺 type 应 400', async () => {
      await req
        .post('/notification/preferences/update')
        .send({ enabled: true })
        .expect(400)
    })

    it('NT-ERR-008: update 缺 enabled 应 400', async () => {
      await req
        .post('/notification/preferences/update')
        .send({ type: NotificationType.PRICE_ALERT })
        .expect(400)
    })

    it('NT-ERR-009: update type 无效枚举应 400', async () => {
      await req
        .post('/notification/preferences/update')
        .send({ type: 'INVALID_TYPE', enabled: true })
        .expect(400)
    })

    it('NT-ERR-010: update enabled 非布尔应 400', async () => {
      await req
        .post('/notification/preferences/update')
        .send({ type: NotificationType.PRICE_ALERT, enabled: 'yes' })
        .expect(400)
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('NT-SEC-001: 无 Token 访问 list 应 401', async () => {
      const mockAuthGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [NotificationController],
        providers: [{ provide: NotificationService, useValue: mockNotificationService }],
      }).compile()

      const unauthApp = moduleRef.createNestApplication()
      unauthApp.useGlobalGuards(mockAuthGuardNoAuth)
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/notification/list')
        .expect(401)
      await unauthApp.close()
    })

    it('NT-SEC-002: 无 Token 访问 unread-count 应 401', async () => {
      const mockAuthGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [NotificationController],
        providers: [{ provide: NotificationService, useValue: mockNotificationService }],
      }).compile()

      const unauthApp = moduleRef.createNestApplication()
      unauthApp.useGlobalGuards(mockAuthGuardNoAuth)
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/notification/unread-count')
        .expect(401)
      await unauthApp.close()
    })
  })
})
