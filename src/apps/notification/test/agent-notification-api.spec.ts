import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  UserRole,
  AiNotificationChannelStatus,
  AiNotificationChannelType,
  AiNotificationDeliveryStatus,
} from '@prisma/client'
import request from 'supertest'
import { AgentErrorInterceptor } from 'src/apps/agent/api/agent-error.interceptor'
import { AgentStrictBodyGuard } from 'src/apps/agent/api/agent-strict-body.guard'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  AgentNotificationChannelController,
  AgentNotificationDeliveryController,
} from '../agent-notification.controller'
import { NotificationChannelService } from '../notification-channel.service'
import { NotificationDeliveryService } from '../notification-delivery.service'

const user: TokenPayload = { id: 7, account: 'channel-owner', nickname: 'Owner', role: UserRole.USER, jti: 'test-jti' }

describe('Agent notification API', () => {
  let app: INestApplication
  let channels: Record<string, jest.Mock>
  let deliveries: Record<string, jest.Mock>

  beforeEach(async () => {
    channels = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: jest.fn().mockResolvedValue(channelResponse()),
      update: jest.fn().mockResolvedValue(channelResponse()),
      test: jest
        .fn()
        .mockResolvedValue({ channelId: 'channel_1', verified: true, verifiedAt: '2026-07-22T10:30:00.000Z' }),
      delete: jest.fn().mockResolvedValue({ ...channelResponse(), status: AiNotificationChannelStatus.DELETED }),
    }
    deliveries = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      retry: jest.fn().mockResolvedValue(deliveryResponse()),
    }
    const guard: CanActivate = {
      canActivate(context: ExecutionContext): boolean {
        context.switchToHttp().getRequest().user = user
        return true
      },
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentNotificationChannelController, AgentNotificationDeliveryController],
      providers: [
        AgentStrictBodyGuard,
        AgentErrorInterceptor,
        { provide: NotificationChannelService, useValue: channels },
        { provide: NotificationDeliveryService, useValue: deliveries },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, mockLogger()))
    await app.init()
  })

  afterEach(async () => app.close())

  it('NTF-BIZ-001: POST create 绑定当前用户；返回永不包含 secret', async () => {
    const response = await request(app.getHttpServer())
      .post('/agent/notification-channels/create')
      .send({ type: 'IN_APP', name: '系统内提醒' })
      .expect(200)

    expect(channels.create).toHaveBeenCalledWith(7, expect.objectContaining({ type: AiNotificationChannelType.IN_APP }))
    expect(response.body.data).not.toHaveProperty('secret')
    expect(response.body.data).not.toHaveProperty('encryptedConfig')
  })

  it('NTF-SEC-002: 严格 Body 拒绝未声明字段，防止 secret 进入通用 payload', async () => {
    await request(app.getHttpServer())
      .post('/agent/notification-channels/create')
      .send({ type: 'IN_APP', name: '系统内提醒', hiddenSecret: 'must-not-pass' })
      .expect(400)
    expect(channels.create).not.toHaveBeenCalled()
  })

  it('NTF-BIZ-002: POST retry 仅传 owner 与 deliveryId 给 delivery service', async () => {
    const response = await request(app.getHttpServer())
      .post('/agent/notification-deliveries/retry')
      .send({ deliveryId: 'delivery_1' })
      .expect(200)

    expect(deliveries.retry).toHaveBeenCalledWith(7, 'delivery_1')
    expect(response.body.data).toMatchObject({ deliveryId: 'delivery_1', status: AiNotificationDeliveryStatus.PENDING })
  })
})

function channelResponse() {
  return {
    channelId: 'channel_1',
    type: AiNotificationChannelType.IN_APP,
    name: '系统内提醒',
    status: AiNotificationChannelStatus.ACTIVE,
    version: 1,
    isVerified: true,
    lastFour: null,
    verifiedAt: '2026-07-22T10:30:00.000Z',
    createdAt: '2026-07-22T10:30:00.000Z',
    updatedAt: '2026-07-22T10:30:00.000Z',
  }
}

function deliveryResponse() {
  return {
    id: 'delivery_1',
    channelId: 'channel_1',
    executionId: null,
    runId: 'run_1',
    status: AiNotificationDeliveryStatus.PENDING,
    attempt: 1,
    maxAttempts: 5,
    nextAttemptAt: new Date('2026-07-22T10:30:00.000Z'),
    deliveredAt: null,
    providerMessageId: null,
    errorClass: null,
    createdAt: new Date('2026-07-22T10:30:00.000Z'),
    channel: { name: '系统内提醒', type: AiNotificationChannelType.IN_APP },
  }
}

function mockLogger(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as never
}
