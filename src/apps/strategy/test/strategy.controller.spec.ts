import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { StrategyController } from '../strategy.controller'
import { StrategyService } from '../strategy.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockStrategyService = {
  create: jest.fn(),
  list: jest.fn(),
  detail: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  clone: jest.fn(),
  run: jest.fn(),
  getSchemas: jest.fn(),
}

const SUCCESS_CODE = 0

describe('StrategyController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyController],
      providers: [{ provide: StrategyService, useValue: mockStrategyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /strategies/create → 200 with code 200000', async () => {
    const mockStrategy = { id: 'strat-1', name: 'Test Strategy' }
    mockStrategyService.create.mockResolvedValueOnce(mockStrategy)

    await request(app.getHttpServer())
      .post('/strategies/create')
      .send({ name: 'Test Strategy', strategyType: 'MA_CROSS_SINGLE', strategyConfig: { fast: 5, slow: 20 } })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toMatchObject(mockStrategy)
      })
  })

  it('POST /strategies/list → 200, data defined', async () => {
    const mockList = { items: [], total: 0, page: 1, pageSize: 20 }
    mockStrategyService.list.mockResolvedValueOnce(mockList)

    await request(app.getHttpServer())
      .post('/strategies/list')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /strategies/detail → 200', async () => {
    const mockDetail = { id: 'strat-1', name: 'Test Strategy' }
    mockStrategyService.detail.mockResolvedValueOnce(mockDetail)

    await request(app.getHttpServer())
      .post('/strategies/detail')
      .send({ id: 'strat-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toMatchObject(mockDetail)
      })
  })

  it('POST /strategies/delete → 200', async () => {
    mockStrategyService.delete.mockResolvedValueOnce(null)

    await request(app.getHttpServer())
      .post('/strategies/delete')
      .send({ id: 'strat-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
      })
  })

  it('POST /strategies/schemas → 200', async () => {
    const mockSchemas = { MA_CROSS_SINGLE: { type: 'object' } }
    mockStrategyService.getSchemas.mockResolvedValueOnce(mockSchemas)

    await request(app.getHttpServer())
      .post('/strategies/schemas')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  // ── [VAL] DTO 校验 ──────────────────────────────────────────────────────────

  it('[VAL] POST /strategies/create 缺 name → 400', async () => {
    await request(app.getHttpServer())
      .post('/strategies/create')
      .send({ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
      .expect(400)
  })

  it('[VAL] POST /strategies/create 缺 strategyType → 400', async () => {
    await request(app.getHttpServer()).post('/strategies/create').send({ name: 'Test', strategyConfig: {} }).expect(400)
  })

  it('[VAL] POST /strategies/create strategyType 非法枚举值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/strategies/create')
      .send({ name: 'Test', strategyType: 'INVALID_TYPE', strategyConfig: {} })
      .expect(400)
  })

  // ── [ERR] 异常透传 ─────────────────────────────────────────────────────────

  it('[ERR] POST /strategies/detail → service 抛 NotFoundException → 404', async () => {
    mockStrategyService.detail.mockRejectedValueOnce(new NotFoundException('策略不存在'))
    const res = await request(app.getHttpServer()).post('/strategies/detail').send({ id: 'nonexistent' }).expect(404)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /strategies/delete → service 抛 ForbiddenException → 403', async () => {
    mockStrategyService.delete.mockRejectedValueOnce(new ForbiddenException('无权操作他人策略'))
    const res = await request(app.getHttpServer())
      .post('/strategies/delete')
      .send({ id: 'other-user-strat' })
      .expect(403)
    expect(res.body.code).not.toBe(0)
  })
})

// ── [AUTH] 权限边界 ────────────────────────────────────────────────────────────

describe('StrategyController ([AUTH] 权限边界)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyController],
      providers: [{ provide: StrategyService, useValue: {} }],
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

  it('[AUTH] 未登录访问 /strategies/create → 401', async () => {
    await request(app.getHttpServer())
      .post('/strategies/create')
      .send({ name: 'Test', strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
      .expect(401)
  })
})
