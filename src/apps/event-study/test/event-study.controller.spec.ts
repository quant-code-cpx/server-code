import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { Reflector } from '@nestjs/core'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { createTestApp, buildTestUser } from 'test/helpers/create-test-app'
import { EventStudyController } from '../event-study.controller'
import { EventStudyService } from '../event-study.service'
import { EventSignalService } from '../event-signal.service'

const mockEventStudyService = {
  getEventTypes: jest.fn(),
  queryEvents: jest.fn(),
  analyze: jest.fn(),
}
const mockEventSignalService = {
  createRule: jest.fn(),
  listRules: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn(),
  scanAndGenerate: jest.fn(),
}

// ── [BIZ] 正常业务路径 ─────────────────────────────────────────────────────────

describe('EventStudyController', () => {
  let app: INestApplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req: any

  beforeAll(async () => {
    // EventStudyController has no class-level guard; only signal-rules/scan has @UseGuards(RolesGuard)
    // createTestApp provides MockJwtGuard (user injection) + RolesGuard globally
    const result = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
        RolesGuard, // needed for DI resolution of method-level @UseGuards(RolesGuard)
        Reflector,
      ],
      user: buildTestUser({ role: UserRole.USER }),
    })
    app = result.app
    req = result.request
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST /event-study/event-types/list → 201', async () => {
    mockEventStudyService.getEventTypes.mockResolvedValueOnce([])
    const res = await req.post('/event-study/event-types/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /event-study/events → 201', async () => {
    mockEventStudyService.queryEvents.mockResolvedValueOnce({ items: [], total: 0 })
    const res = await req.post('/event-study/events').send({ eventType: 'FORECAST' }).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /event-study/analyze → 201', async () => {
    mockEventStudyService.analyze.mockResolvedValueOnce({})
    const res = await req
      .post('/event-study/analyze')
      .send({ eventType: 'FORECAST', startDate: '20230101', endDate: '20231231' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  // ── [VAL] DTO 校验 ─────────────────────────────────────────────────────────

  it('[VAL] POST /event-study/analyze eventType 非法枚举 → 400', async () => {
    await req.post('/event-study/analyze').send({ eventType: 'INVALID_TYPE' }).expect(400)
  })

  it('[VAL] POST /event-study/signal-rules 缺 name → 400', async () => {
    await req.post('/event-study/signal-rules').send({}).expect(400)
  })

  // ── [ERR] 异常透传 ──────────────────────────────────────────────────────────

  it('[ERR] POST /event-study/signal-rules/update → service 抛 NotFoundException → 404', async () => {
    mockEventSignalService.updateRule.mockRejectedValueOnce(new NotFoundException('规则不存在'))
    const res = await req.post('/event-study/signal-rules/update').send({ id: 999, name: 'Test' }).expect(404)
    expect(res.body.code).not.toBe(0)
  })

  // ── [AUTH] 非 SUPER_ADMIN 访问 scan 端点 ─────────────────────────────────

  it('[AUTH] USER 访问 /event-study/signal-rules/scan → 403 (需 SUPER_ADMIN)', async () => {
    await req.post('/event-study/signal-rules/scan').send({ tradeDate: '20240101' }).expect(403)
  })
})

// ── [AUTH] SUPER_ADMIN 可访问 scan 端点 ────────────────────────────────────────

describe('EventStudyController (SUPER_ADMIN)', () => {
  let app: INestApplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req: any

  beforeAll(async () => {
    const result = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
        RolesGuard,
        Reflector,
      ],
      user: buildTestUser({ role: UserRole.SUPER_ADMIN }),
    })
    app = result.app
    req = result.request
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[AUTH] SUPER_ADMIN 访问 /event-study/signal-rules/scan → 201', async () => {
    mockEventSignalService.scanAndGenerate.mockResolvedValueOnce({ count: 3 })
    const res = await req.post('/event-study/signal-rules/scan').send({ tradeDate: '20240101' }).expect(201)
    expect(res.body.code).toBe(0)
  })
})

// ── [AUTH] 未登录 ─────────────────────────────────────────────────────────────

describe('EventStudyController ([AUTH] 未登录)', () => {
  let app: INestApplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req: any

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: {} },
        { provide: EventSignalService, useValue: {} },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (_ctx: ExecutionContext) => {
          throw new UnauthorizedException('用户未登录')
        },
      })
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterAll(() => app.close())

  it('[AUTH] 未登录访问 /event-study/signal-rules/scan → 401', async () => {
    await req.post('/event-study/signal-rules/scan').send({ tradeDate: '20240101' }).expect(401)
  })
})
