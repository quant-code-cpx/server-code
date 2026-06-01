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
import { LoggerService } from 'src/shared/logger/logger.service'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
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

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn(),
  } as unknown as LoggerService
}

const mockPortfolioService = {
  create: jest.fn(), list: jest.fn(), detail: jest.fn(), update: jest.fn(), delete: jest.fn(),
  addHolding: jest.fn(), updateHolding: jest.fn(), removeHolding: jest.fn(),
  getPnlToday: jest.fn(), getPnlHistory: jest.fn(),
}
const mockRiskService = {
  getIndustryDistribution: jest.fn(), getPositionConcentration: jest.fn(),
  getMarketCapDistribution: jest.fn(), getBetaAnalysis: jest.fn(), getRiskSnapshot: jest.fn(),
}
const mockRiskCheckService = {
  listRules: jest.fn(), upsertRule: jest.fn(), updateRule: jest.fn(), deleteRule: jest.fn(),
  runCheck: jest.fn(), listViolations: jest.fn(),
}
const mockBridgeService = { applyBacktest: jest.fn() }
const mockRebalancePlanService = { rebalancePlan: jest.fn() }
const mockPerformanceService = { getPerformance: jest.fn() }
const mockDriftDetectionService = { detect: jest.fn() }
const mockTradeLogService = { query: jest.fn(), summary: jest.fn() }

const allProviders = [
  { provide: PortfolioService, useValue: mockPortfolioService },
  { provide: PortfolioRiskService, useValue: mockRiskService },
  { provide: RiskCheckService, useValue: mockRiskCheckService },
  { provide: BacktestPortfolioBridgeService, useValue: mockBridgeService },
  { provide: RebalancePlanService, useValue: mockRebalancePlanService },
  { provide: PortfolioPerformanceService, useValue: mockPerformanceService },
  { provide: DriftDetectionService, useValue: mockDriftDetectionService },
  { provide: PortfolioTradeLogService, useValue: mockTradeLogService },
  { provide: LoggerService, useValue: createMockLoggerService() },
]

describe('PortfolioController', () => {
  let app: INestApplication
  let mockJwtGuard: { canActivate: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockJwtGuard = {
      canActivate: jest.fn((ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = testUser
        return true
      }),
    }
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController], providers: allProviders,
    }).overrideGuard(JwtAuthGuard).useValue(mockJwtGuard).compile()
    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
  })
  afterEach(async () => app.close())

  // ── 原有 BIZ ─────────────────────────────────────────────────────────
  it('[BIZ] POST /portfolio/create → 201', async () => {
    mockPortfolioService.create.mockResolvedValueOnce({ id: 'p-1', name: '测试' })
    await request(app.getHttpServer()).post('/portfolio/create').send({ name: '测试', initialCash: 100000 }).expect(201)
  })
  it('[BIZ] POST /portfolio/list → 201', async () => {
    mockPortfolioService.list.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/portfolio/list').send({}).expect(201)
  })
  it('[BIZ] POST /portfolio/detail → 201', async () => {
    mockPortfolioService.detail.mockResolvedValueOnce({ id: 'p-1' })
    await request(app.getHttpServer()).post('/portfolio/detail').send({ portfolioId: 'p-1' }).expect(201)
  })

  // ── 原有 VAL ─────────────────────────────────────────────────────────
  it('[VAL] POST /portfolio/create 缺 name → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/create').send({ initialCash: 100000 }).expect(400)
  })
  it('[VAL] POST /portfolio/create initialCash=-100 → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/create').send({ name: 'x', initialCash: -100 }).expect(400)
  })
  it('[VAL] POST /portfolio/holding/add tsCode invalid → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/holding/add').send({ portfolioId: 'p-1', tsCode: 'invalid', quantity: 100, avgCost: 10 }).expect(400)
  })
  it('[VAL] POST /portfolio/holding/add quantity=0 → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/holding/add').send({ portfolioId: 'p-1', tsCode: '000001.SZ', quantity: 0, avgCost: 10 }).expect(400)
  })
  it('[VAL] POST /portfolio/holding/add avgCost=-1 → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/holding/add').send({ portfolioId: 'p-1', tsCode: '000001.SZ', quantity: 100, avgCost: -1 }).expect(400)
  })
  it('[VAL] POST /portfolio/rule/upsert threshold=0 → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/rule/upsert').send({ portfolioId: 'p-1', ruleType: 'POSITION_CONCENTRATION', threshold: 0, isEnabled: true }).expect(400)
  })
  it('[VAL] POST /portfolio/rule/upsert threshold=2.0 → 400', async () => {
    await request(app.getHttpServer()).post('/portfolio/rule/upsert').send({ portfolioId: 'p-1', ruleType: 'POSITION_CONCENTRATION', threshold: 2.0, isEnabled: true }).expect(400)
  })

  // ── 原有 ERR ─────────────────────────────────────────────────────────
  it('[ERR] POST /portfolio/detail NotFoundException → 404', async () => {
    mockPortfolioService.detail.mockRejectedValueOnce(new NotFoundException('不存在'))
    await request(app.getHttpServer()).post('/portfolio/detail').send({ portfolioId: 'nonexistent' }).expect(404)
  })

  // ── 新增冒烟：全端点 ─────────────────────────────────────────────────
  describe('[BIZ] 剩余端点冒烟', () => {
    it('/portfolio/update → 201', async () => {
      mockPortfolioService.update.mockResolvedValueOnce({ id: 'p-1' })
      await request(app.getHttpServer()).post('/portfolio/update').send({ id: 'p-1', name: 'new' }).expect(201)
    })
    it('/portfolio/delete → 201', async () => {
      mockPortfolioService.delete.mockResolvedValueOnce({ success: true })
      await request(app.getHttpServer()).post('/portfolio/delete').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/holding/update → 201', async () => {
      mockPortfolioService.updateHolding.mockResolvedValueOnce({ holdingId: 'h-1' })
      await request(app.getHttpServer()).post('/portfolio/holding/update').send({ portfolioId: 'p-1', holdingId: 'h-1', quantity: 200, avgCost: 12 }).expect(201)
    })
    it('/portfolio/holding/remove → 201', async () => {
      mockPortfolioService.removeHolding.mockResolvedValueOnce({ success: true })
      await request(app.getHttpServer()).post('/portfolio/holding/remove').send({ holdingId: 'h-1' }).expect(201)
    })
    it('/portfolio/pnl/today → 201', async () => {
      mockPortfolioService.getPnlToday.mockResolvedValueOnce({ pnl: 1000 })
      await request(app.getHttpServer()).post('/portfolio/pnl/today').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/pnl/history → 201', async () => {
      mockPortfolioService.getPnlHistory.mockResolvedValueOnce([])
      await request(app.getHttpServer()).post('/portfolio/pnl/history').send({ portfolioId: 'p-1', startDate: '20230101', endDate: '20231231' }).expect(201)
    })
    it('/portfolio/risk/industry → 201', async () => {
      mockRiskService.getIndustryDistribution.mockResolvedValueOnce([])
      await request(app.getHttpServer()).post('/portfolio/risk/industry').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/position → 201', async () => {
      mockRiskService.getPositionConcentration.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/risk/position').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/market-cap → 201', async () => {
      mockRiskService.getMarketCapDistribution.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/risk/market-cap').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/beta → 201', async () => {
      mockRiskService.getBetaAnalysis.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/risk/beta').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/snapshot → 201', async () => {
      mockRiskService.getRiskSnapshot.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/risk/snapshot').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/check → 201', async () => {
      mockRiskCheckService.runCheck.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/risk/check').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/risk/violations → 201', async () => {
      mockRiskCheckService.listViolations.mockResolvedValueOnce([])
      await request(app.getHttpServer()).post('/portfolio/risk/violations').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/rule/list → 201', async () => {
      mockRiskCheckService.listRules.mockResolvedValueOnce([])
      await request(app.getHttpServer()).post('/portfolio/rule/list').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/rule/update → 201', async () => {
      mockRiskCheckService.updateRule.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/rule/update').send({ portfolioId: 'p-1', ruleId: 'r-1', threshold: 0.3, isEnabled: true }).expect(201)
    })
    it('/portfolio/rule/delete → 201', async () => {
      mockRiskCheckService.deleteRule.mockResolvedValueOnce({ success: true })
      await request(app.getHttpServer()).post('/portfolio/rule/delete').send({ ruleId: 'r-1' }).expect(201)
    })
    it('/portfolio/apply-backtest → 201', async () => {
      mockBridgeService.applyBacktest.mockResolvedValueOnce({ portfolioId: 'p-1' })
      await request(app.getHttpServer()).post('/portfolio/apply-backtest').send({ backtestRunId: 'r-1', mode: 'REPLACE' }).expect(201)
    })
    it('/portfolio/rebalance-plan → 201', async () => {
      mockRebalancePlanService.rebalancePlan.mockResolvedValueOnce({ actions: [] })
      await request(app.getHttpServer()).post('/portfolio/rebalance-plan').send({ portfolioId: 'p-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0.5 }] }).expect(201)
    })
    it('/portfolio/performance → 201', async () => {
      mockPerformanceService.getPerformance.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/performance').send({ portfolioId: 'p-1', startDate: '20230101', endDate: '20231231' }).expect(201)
    })
    it('/portfolio/drift-detection → 201', async () => {
      mockDriftDetectionService.detect.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/drift-detection').send({ portfolioId: 'p-1', strategyId: 's-1' }).expect(201)
    })
    it('/portfolio/trade-log → 201', async () => {
      mockTradeLogService.query.mockResolvedValueOnce({ items: [], total: 0 })
      await request(app.getHttpServer()).post('/portfolio/trade-log').send({ portfolioId: 'p-1' }).expect(201)
    })
    it('/portfolio/trade-log/summary → 201', async () => {
      mockTradeLogService.summary.mockResolvedValueOnce({})
      await request(app.getHttpServer()).post('/portfolio/trade-log/summary').send({ portfolioId: 'p-1' }).expect(201)
    })
  })

  // ── 新增 DTO 校验 ────────────────────────────────────────────────────
  describe('[DTO 校验] 补充', () => {
    it('holding/add 缺 portfolioId → 400', async () => {
      await request(app.getHttpServer()).post('/portfolio/holding/add').send({ tsCode: '000001.SZ', quantity: 100, avgCost: 10 }).expect(400)
    })
    it('holding/add 缺 quantity → 400', async () => {
      await request(app.getHttpServer()).post('/portfolio/holding/add').send({ portfolioId: 'p-1', tsCode: '000001.SZ', avgCost: 10 }).expect(400)
    })
    it('rule/upsert 缺 ruleType → 400', async () => {
      await request(app.getHttpServer()).post('/portfolio/rule/upsert').send({ portfolioId: 'p-1', threshold: 0.5, isEnabled: true }).expect(400)
    })
  })

  // ── AUTH ─────────────────────────────────────────────────────────────
  it('[AUTH] 未登录访问 /portfolio/create → 401', async () => {
    mockJwtGuard.canActivate.mockImplementationOnce(() => { throw new UnauthorizedException() })
    await request(app.getHttpServer()).post('/portfolio/create').send({ name: 'x', initialCash: 100000 }).expect(401)
  })
})
