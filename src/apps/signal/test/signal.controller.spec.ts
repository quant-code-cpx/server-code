import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { UserRole } from '@prisma/client'
import { SignalController } from '../signal.controller'
import { SignalService } from '../signal.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockSignalService = {
  activate: jest.fn(),
  deactivate: jest.fn(),
  listActivations: jest.fn(),
  getLatestSignals: jest.fn(),
  getSignalHistory: jest.fn(),
}

// ── [BIZ] 正常业务路径 ─────────────────────────────────────────────────────────

describe('SignalController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignalController],
      providers: [{ provide: SignalService, useValue: mockSignalService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST /signal/strategies/activate → 201', async () => {
    mockSignalService.activate.mockResolvedValueOnce({ strategyId: 's-1', activated: true })
    const res = await request(app.getHttpServer())
      .post('/signal/strategies/activate')
      .send({ strategyId: 's-1' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockSignalService.activate).toHaveBeenCalledTimes(1)
  })

  it('[BIZ] POST /signal/strategies/list → 201', async () => {
    mockSignalService.listActivations.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/signal/strategies/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /signal/latest → 201', async () => {
    mockSignalService.getLatestSignals.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/signal/latest').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  // ── [VAL] DTO 校验 ─────────────────────────────────────────────────────────

  it('[VAL] POST /signal/strategies/activate 缺 strategyId → 400', async () => {
    await request(app.getHttpServer()).post('/signal/strategies/activate').send({}).expect(400)
  })

  // ── [ERR] 异常透传 ──────────────────────────────────────────────────────────

  it('[ERR] POST /signal/strategies/deactivate → service 抛 NotFoundException → 404', async () => {
    mockSignalService.deactivate.mockRejectedValueOnce(new NotFoundException('策略未激活'))
    const res = await request(app.getHttpServer())
      .post('/signal/strategies/deactivate')
      .send({ strategyId: 'nonexistent' })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })
})

// ── [AUTH] 权限边界 ────────────────────────────────────────────────────────────

describe('SignalController ([AUTH] 权限边界)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignalController],
      providers: [{ provide: SignalService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
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
  })

  afterAll(() => app.close())

  it('[AUTH] 未登录访问 /signal/strategies/activate → 401', async () => {
    await request(app.getHttpServer()).post('/signal/strategies/activate').send({ strategyId: 's-1' }).expect(401)
  })
})
