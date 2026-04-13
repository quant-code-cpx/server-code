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
import { PortfolioController } from '../portfolio.controller'
import { PortfolioService } from '../portfolio.service'
import { PortfolioRiskService } from '../portfolio-risk.service'
import { RiskCheckService } from '../risk-check.service'
import { BacktestPortfolioBridgeService } from '../services/backtest-portfolio-bridge.service'
import { RebalancePlanService } from '../services/rebalance-plan.service'
import { PortfolioPerformanceService } from '../services/portfolio-performance.service'
import { DriftDetectionService } from 'src/apps/signal/drift-detection.service'
import { PortfolioTradeLogService } from '../services/portfolio-trade-log.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockPortfolioService = {
  create: jest.fn(),
  list: jest.fn(),
  detail: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  addHolding: jest.fn(),
  updateHolding: jest.fn(),
  removeHolding: jest.fn(),
}

const mockRiskService = {
  getIndustryDistribution: jest.fn(),
  getPositionConcentration: jest.fn(),
  getMarketCapDistribution: jest.fn(),
  getBeta: jest.fn(),
}

const mockRiskCheckService = {
  getRules: jest.fn(),
  upsertRule: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn(),
  checkRisk: jest.fn(),
  getViolations: jest.fn(),
}

const mockBridgeService = { applyBacktest: jest.fn() }
const mockRebalancePlanService = { generatePlan: jest.fn() }
const mockPerformanceService = { getPerformance: jest.fn() }
const mockDriftDetectionService = { detectDrift: jest.fn() }
const mockTradeLogService = { getLogs: jest.fn(), getSummary: jest.fn() }

const allProviders = [
  { provide: PortfolioService, useValue: mockPortfolioService },
  { provide: PortfolioRiskService, useValue: mockRiskService },
  { provide: RiskCheckService, useValue: mockRiskCheckService },
  { provide: BacktestPortfolioBridgeService, useValue: mockBridgeService },
  { provide: RebalancePlanService, useValue: mockRebalancePlanService },
  { provide: PortfolioPerformanceService, useValue: mockPerformanceService },
  { provide: DriftDetectionService, useValue: mockDriftDetectionService },
  { provide: PortfolioTradeLogService, useValue: mockTradeLogService },
]

// ── [BIZ] 正常业务路径 ─────────────────────────────────────────────────────────

describe('PortfolioController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: allProviders,
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

  it('[BIZ] POST /portfolio/create → 201', async () => {
    mockPortfolioService.create.mockResolvedValueOnce({ id: 'p-1', name: '测试组合' })
    const res = await request(app.getHttpServer())
      .post('/portfolio/create')
      .send({ name: '测试组合', initialCash: 100000 })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.id).toBe('p-1')
  })

  it('[BIZ] POST /portfolio/list → 201', async () => {
    mockPortfolioService.list.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/portfolio/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /portfolio/detail → 201', async () => {
    mockPortfolioService.detail.mockResolvedValueOnce({ id: 'p-1', name: '测试组合' })
    const res = await request(app.getHttpServer()).post('/portfolio/detail').send({ portfolioId: 'p-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.id).toBe('p-1')
  })

  // ── [VAL] DTO 校验 ─────────────────────────────────────────────────────────

  it('[VAL] POST /portfolio/create 缺 name → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/create').send({ initialCash: 100000 }).expect(400)
  })

  it('[VAL] POST /portfolio/create initialCash=-100 → 400 (@IsNumber @Min(0))', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/create')
      .send({ name: '测试组合', initialCash: -100 })
      .expect(400)
  })

  it('[VAL] POST /portfolio/holding/add tsCode invalid 格式 → 400 (@Matches /^\\d{6}\\.[A-Z]{2}$/)', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/holding/add')
      .send({ portfolioId: 'p-1', tsCode: 'invalid', quantity: 100, avgCost: 10 })
      .expect(400)
  })

  it('[VAL] POST /portfolio/holding/add quantity=0 → 400 (@IsInt @Min(1))', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/holding/add')
      .send({ portfolioId: 'p-1', tsCode: '000001.SZ', quantity: 0, avgCost: 10 })
      .expect(400)
  })

  it('[VAL] POST /portfolio/holding/add avgCost=-1 → 400 (@IsNumber @Min(0))', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/holding/add')
      .send({ portfolioId: 'p-1', tsCode: '000001.SZ', quantity: 100, avgCost: -1 })
      .expect(400)
  })

  it('[VAL] POST /portfolio/rule/upsert threshold=0 → 400 (@Min(0.01))', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/rule/upsert')
      .send({ portfolioId: 'p-1', ruleType: 'POSITION_CONCENTRATION', threshold: 0, isEnabled: true })
      .expect(400)
  })

  it('[VAL] POST /portfolio/rule/upsert threshold=2.0 → 400 (@Max(1.0))', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/rule/upsert')
      .send({ portfolioId: 'p-1', ruleType: 'POSITION_CONCENTRATION', threshold: 2.0, isEnabled: true })
      .expect(400)
  })

  // ── [ERR] 异常透传 ──────────────────────────────────────────────────────────

  it('[ERR] POST /portfolio/detail → service 抛 NotFoundException → 404', async () => {
    mockPortfolioService.detail.mockRejectedValueOnce(new NotFoundException('组合不存在'))
    const res = await request(app.getHttpServer())
      .post('/portfolio/detail')
      .send({ portfolioId: 'nonexistent' })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /portfolio/holding/remove → service 抛 NotFoundException → 404', async () => {
    mockPortfolioService.removeHolding.mockRejectedValueOnce(new NotFoundException('持仓不存在'))
    const res = await request(app.getHttpServer())
      .post('/portfolio/holding/remove')
      .send({ portfolioId: 'p-1', holdingId: 'nonexistent' })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })
})

// ── [AUTH] 权限边界 ────────────────────────────────────────────────────────────

describe('PortfolioController ([AUTH] 权限边界)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: allProviders.map((p) => ({ provide: p.provide, useValue: {} })),
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

  it('[AUTH] 未登录访问 /portfolio/create → 401', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/create')
      .send({ name: '测试组合', initialCash: 100000 })
      .expect(401)
  })
})
