/**
 * NotificationController — 集成测试
 *
 * 覆盖要点：
 * - POST /notification/list → 201，data 含 page/total/items/unreadCount
 * - POST /notification/unread-count → 201，data 含 unreadCount
 * - POST /notification/mark-read → 201，调用 markRead
 * - POST /notification/mark-all-read → 201，调用 markAllRead
 * - POST /notification/delete → 201，调用 deleteNotification
 * - POST /notification/preferences → 201，data 是数组
 * - POST /notification/preferences/update → 201，调用 updatePreference
 * - markRead NotFoundException → 404
 */

import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import request from 'supertest'
import { NotificationController } from '../notification.controller'
import { NotificationService } from '../notification.service'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { TokenPayload } from 'src/shared/token.interface'

const testUser: TokenPayload = {
  id: 1,
  account: 'test',
  nickname: 'Test',
  role: UserRole.USER,
  jti: 'jti-1',
}

const mockJwtGuard = {
  canActivate: jest.fn((ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockNotificationService = {
  list: jest.fn(async () => ({ page: 1, pageSize: 20, total: 0, unreadCount: 0, items: [] })),
  getUnreadCount: jest.fn(async () => ({ unreadCount: 3 })),
  markRead: jest.fn(async () => undefined),
  markAllRead: jest.fn(async () => undefined),
  deleteNotification: jest.fn(async () => undefined),
  getPreferences: jest.fn(async () => []),
  updatePreference: jest.fn(async () => undefined),
}

describe('NotificationController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: APP_GUARD, useValue: mockJwtGuard },
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockJwtGuard.canActivate.mockImplementation((ctx: ExecutionContext) => {
      const req = ctx.switchToHttp().getRequest()
      req.user = testUser
      return true
    })
  })

  it('POST /notification/list → 201, data 含 page/total/unreadCount/items', async () => {
    const res = await request(app.getHttpServer()).post('/notification/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('page')
    expect(res.body.data).toHaveProperty('total')
    expect(res.body.data).toHaveProperty('unreadCount')
    expect(res.body.data).toHaveProperty('items')
    expect(mockNotificationService.list).toHaveBeenCalledWith(testUser.id, expect.anything())
  })

  it('POST /notification/unread-count → 201, data 含 unreadCount', async () => {
    const res = await request(app.getHttpServer()).post('/notification/unread-count').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('unreadCount', 3)
    expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith(testUser.id)
  })

  it('POST /notification/mark-read → 201', async () => {
    const res = await request(app.getHttpServer()).post('/notification/mark-read').send({ id: 5 }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockNotificationService.markRead).toHaveBeenCalledWith(testUser.id, 5)
  })

  it('[VAL] POST /notification/mark-read 缺 id → 400', async () => {
    await request(app.getHttpServer()).post('/notification/mark-read').send({}).expect(400)
    expect(mockNotificationService.markRead).not.toHaveBeenCalled()
  })

  it('POST /notification/mark-all-read → 201', async () => {
    const res = await request(app.getHttpServer()).post('/notification/mark-all-read').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(testUser.id)
  })

  it('POST /notification/delete → 201', async () => {
    const res = await request(app.getHttpServer()).post('/notification/delete').send({ id: 7 }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(testUser.id, 7)
  })

  it('POST /notification/preferences → 201, data 是数组', async () => {
    mockNotificationService.getPreferences.mockResolvedValueOnce([{ type: 'SYSTEM', enabled: true }] as any)
    const res = await request(app.getHttpServer()).post('/notification/preferences').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(mockNotificationService.getPreferences).toHaveBeenCalledWith(testUser.id)
  })

  it('POST /notification/preferences/update → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/notification/preferences/update')
      .send({ type: 'SYSTEM', enabled: false })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockNotificationService.updatePreference).toHaveBeenCalledWith(
      testUser.id,
      expect.objectContaining({ type: 'SYSTEM', enabled: false }),
    )
  })

  it('[ERR] POST /notification/mark-read NotFoundException → 404', async () => {
    mockNotificationService.markRead.mockRejectedValueOnce(new NotFoundException('不存在'))
    await request(app.getHttpServer()).post('/notification/mark-read').send({ id: 999 }).expect(404)
  })
})
