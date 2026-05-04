import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import request from 'supertest'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { TokenPayload } from 'src/shared/token.interface'
import { AlertController } from '../alert.controller'
import { AlertCalendarService } from '../alert-calendar.service'
import { PriceAlertService } from '../price-alert.service'
import { MarketAnomalyService } from '../market-anomaly.service'
import { AlertLimitService } from '../alert-limit.service'

const mockCalendarService = { getCalendar: jest.fn() }
const mockPriceAlertService = {
  createRule: jest.fn(),
  listRules: jest.fn(),
  listHistory: jest.fn(),
  scanStatus: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn(),
  runScan: jest.fn(),
}
const mockAnomalyService = {
  queryAnomalies: jest.fn(),
  getSummary: jest.fn(),
  getDetail: jest.fn(),
  runScan: jest.fn(),
}
const mockLimitService = { list: jest.fn(), summary: jest.fn(), nextDayPerf: jest.fn() }

const allProviders = [
  { provide: AlertCalendarService, useValue: mockCalendarService },
  { provide: PriceAlertService, useValue: mockPriceAlertService },
  { provide: MarketAnomalyService, useValue: mockAnomalyService },
  { provide: AlertLimitService, useValue: mockLimitService },
]

/** 构建带 RolesGuard 覆盖的测试应用（模拟用户注入 + 角色检查） */
async function buildAlertApp(user: TokenPayload | null): Promise<INestApplication> {
  const customRolesGuard = {
    canActivate(ctx: ExecutionContext): boolean {
      if (!user) throw new UnauthorizedException('用户未登录')
      const req = ctx.switchToHttp().getRequest()
      req.user = user

      const reflector = new Reflector()
      const required = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()])
      if (!required?.length) return true

      const level = ROLE_LEVEL[user.role] ?? 0
      const meets = required.some((r) => level >= ROLE_LEVEL[r])
      if (!meets) throw new ForbiddenException('权限不足')
      return true
    },
  }

  const module: TestingModule = await Test.createTestingModule({
    controllers: [AlertController],
    providers: [...allProviders, Reflector],
  })
    .overrideGuard(RolesGuard)
    .useValue(customRolesGuard)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.init()
  return app
}

const userPayload: TokenPayload = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
const adminPayload: TokenPayload = { id: 1, account: 'admin', nickname: 'Admin', role: UserRole.ADMIN, jti: 'jti-2' }

// ── [BIZ] 正常业务路径 ─────────────────────────────────────────────────────────

describe('AlertController (USER 普通用户)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildAlertApp(userPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('[BIZ] POST /alert/calendar/list → 201', async () => {
    mockCalendarService.getCalendar.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer())
      .post('/alert/calendar/list')
      .send({ startDate: '20240101', endDate: '20240131' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /alert/price-rules → 201 (创建价格预警规则)', async () => {
    mockPriceAlertService.createRule.mockResolvedValueOnce({ id: 1 })
    const res = await request(app.getHttpServer())
      .post('/alert/price-rules')
      .send({ ruleType: 'PRICE_ABOVE', tsCode: '000001.SZ', threshold: 10 })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /alert/price-rules/list → 201', async () => {
    mockPriceAlertService.listRules.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/alert/price-rules/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  // ── [VAL] DTO 校验 ──────────────────────────────────────────────────────────

  it('[VAL] POST /alert/calendar/list startDate 含横线格式 → 400 (@Matches /^\\d{8}$/)', async () => {
    await request(app.getHttpServer())
      .post('/alert/calendar/list')
      .send({ startDate: '2024-01-01', endDate: '20240131' })
      .expect(400)
  })

  it('[VAL] POST /alert/price-rules ruleType 非法枚举 → 400', async () => {
    await request(app.getHttpServer())
      .post('/alert/price-rules')
      .send({ ruleType: 'INVALID_RULE', tsCode: '000001.SZ', threshold: 10 })
      .expect(400)
  })

  // ── [ERR] 异常透传 ──────────────────────────────────────────────────────────

  it('[ERR] POST /alert/price-rules/update → service 抛 NotFoundException → 404', async () => {
    mockPriceAlertService.updateRule.mockRejectedValueOnce(new NotFoundException('规则不存在'))
    const res = await request(app.getHttpServer())
      .post('/alert/price-rules/update')
      .send({ id: 999, ruleType: 'PRICE_ABOVE', threshold: 10 })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })

  // ── [AUTH] 权限边界 — USER 访问 ADMIN 端点 →  403 ─────────────────────────

  it('[AUTH] USER 访问 /alert/price-rules/scan → 403 (需 ADMIN 角色)', async () => {
    await request(app.getHttpServer()).post('/alert/price-rules/scan').send({}).expect(403)
  })

  it('[AUTH] USER 访问 /alert/anomalies/scan → 403 (需 ADMIN 角色)', async () => {
    await request(app.getHttpServer()).post('/alert/anomalies/scan').send({}).expect(403)
  })
})

// ── [AUTH] ADMIN 访问受限端点 ─────────────────────────────────────────────────

describe('AlertController (ADMIN 管理员)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildAlertApp(adminPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('[AUTH] ADMIN 访问 /alert/price-rules/scan → 201', async () => {
    mockPriceAlertService.runScan.mockResolvedValueOnce({ count: 5 })
    const res = await request(app.getHttpServer()).post('/alert/price-rules/scan').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })
})

// ── [AUTH] 未登录 ─────────────────────────────────────────────────────────────

describe('AlertController (未登录)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildAlertApp(null)
  })
  afterAll(() => app.close())

  it('[AUTH] 未登录访问 /alert/calendar/list → 401', async () => {
    await request(app.getHttpServer())
      .post('/alert/calendar/list')
      .send({ startDate: '20240101', endDate: '20240131' })
      .expect(401)
  })
})
