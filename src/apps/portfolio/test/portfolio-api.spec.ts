/**
 * Portfolio 模块 API 测试 — 业务优先
 *
 * 覆盖：组合 CRUD、持仓管理、盈亏分析、风险分析、风控规则、风险检测、
 *       回测导入、调仓清单、绩效跟踪、策略漂移、交易日志
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PortfolioController } from '../portfolio.controller'
import { PortfolioService } from '../portfolio.service'
import { PortfolioRiskService } from '../portfolio-risk.service'
import { RiskCheckService } from '../risk-check.service'
import { BacktestPortfolioBridgeService } from '../services/backtest-portfolio-bridge.service'
import { RebalancePlanService } from '../services/rebalance-plan.service'
import { PortfolioPerformanceService } from '../services/portfolio-performance.service'
import { DriftDetectionService } from '../../signal/drift-detection.service'
import { PortfolioTradeLogService } from '../services/portfolio-trade-log.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Portfolio API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockPortfolioService: Record<string, jest.Mock>
  let mockRiskService: Record<string, jest.Mock>
  let mockRiskCheckService: Record<string, jest.Mock>
  let mockBridgeService: Record<string, jest.Mock>
  let mockRebalanceService: Record<string, jest.Mock>
  let mockPerformanceService: Record<string, jest.Mock>
  let mockDriftService: Record<string, jest.Mock>
  let mockTradeLogService: Record<string, jest.Mock>

  const user = buildTestUser()
  const samplePortfolio = { id: 'port-1', name: '科技成长组合', initialCash: 100000, description: '专注AI', createdAt: new Date() }
  const sampleHolding = { id: 'hold-1', tsCode: '000001.SZ', stockName: '平安银行', quantity: 1000, avgCost: 12.5, updatedAt: new Date() }
  const sampleRiskRule = { id: 'rule-1', portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 0.3, isEnabled: true, createdAt: new Date(), updatedAt: new Date() }

  beforeEach(async () => {
    mockPortfolioService = {
      create: jest.fn().mockResolvedValue(samplePortfolio),
      list: jest.fn().mockResolvedValue([{ ...samplePortfolio, holdingCount: 1 }]),
      detail: jest.fn().mockResolvedValue({
        portfolio: samplePortfolio,
        holdings: [{ ...sampleHolding, currentPrice: 13.2, marketValue: 13200, unrealizedPnl: 700, pnlPct: 0.056, weight: 0.22, industry: '银行' }],
        summary: { totalCost: 12500, totalMarketValue: 13200, totalUnrealizedPnl: 700, totalPnlPct: 0.056, cashBalance: 87500 },
      }),
      update: jest.fn().mockResolvedValue({ ...samplePortfolio, name: '更新后组合' }),
      delete: jest.fn().mockResolvedValue({ success: true }),
      addHolding: jest.fn().mockResolvedValue(sampleHolding),
      updateHolding: jest.fn().mockResolvedValue({ ...sampleHolding, quantity: 2000 }),
      removeHolding: jest.fn().mockResolvedValue({ success: true }),
      getPnlToday: jest.fn().mockResolvedValue({ tradeDate: '2026-05-24', todayPnl: 320.5, todayPnlPct: 0.0243, byHolding: [{ tsCode: '000001.SZ', stockName: '平安银行', pctChg: 1.23, todayPnl: 150.6 }] }),
      getPnlHistory: jest.fn().mockResolvedValue([{ date: new Date(), marketValue: 13200, costBasis: 12500, nav: 1.056 }]),
    }

    mockRiskService = {
      getIndustryDistribution: jest.fn().mockResolvedValue({ tradeDate: '2026-05-24', industries: [{ industry: '银行', stockCount: 2, totalMarketValue: 26400, weight: 0.44 }] }),
      getPositionConcentration: jest.fn().mockResolvedValue({ tradeDate: '2026-05-24', positions: [{ tsCode: '000001.SZ', stockName: '平安银行', marketValue: 13200, weight: 0.22 }], concentration: { hhi: 0.1234, top1Weight: 0.22, top3Weight: 0.55, top5Weight: 0.78 } }),
      getMarketCapDistribution: jest.fn().mockResolvedValue({ tradeDate: '2026-05-24', buckets: [{ label: '大盘（> 1000亿）', count: 2, weight: 0.44 }] }),
      getBetaAnalysis: jest.fn().mockResolvedValue({ tradeDate: '2026-05-24', portfolioBeta: 0.91, holdings: [{ tsCode: '000001.SZ', stockName: '平安银行', beta: 0.85, weight: 0.22 }] }),
      getRiskSnapshot: jest.fn().mockResolvedValue({ industry: {}, position: {}, marketCap: {}, beta: {} }),
    }

    mockRiskCheckService = {
      listRules: jest.fn().mockResolvedValue([sampleRiskRule]),
      upsertRule: jest.fn().mockResolvedValue(sampleRiskRule),
      updateRule: jest.fn().mockResolvedValue({ ...sampleRiskRule, threshold: 0.4 }),
      deleteRule: jest.fn().mockResolvedValue({ success: true }),
      runCheck: jest.fn().mockResolvedValue({ portfolioId: 'port-1', violations: [{ ruleType: 'MAX_SINGLE_POSITION', tsCode: '000001.SZ', stockName: '平安银行', currentValue: 0.22, threshold: 0.2, message: '单票仓位 22% 超过阈值 20%' }], checkedAt: new Date() }),
      listViolations: jest.fn().mockResolvedValue([{ id: 'vio-1', portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', tsCode: '000001.SZ', currentValue: 0.22, threshold: 0.2, message: '超限', detectedAt: new Date() }]),
    }

    mockBridgeService = {
      applyBacktest: jest.fn().mockResolvedValue({ portfolioId: 'port-1', portfolioName: '回测导入-价值策略', backtestRunId: 'bt-1', mode: 'REPLACE', snapshotDate: '2024-12-31', changes: [], summary: { added: 3, updated: 2, removed: 1, unchanged: 0, totalHoldings: 5 } }),
    }

    mockRebalanceService = {
      rebalancePlan: jest.fn().mockResolvedValue({ portfolioId: 'port-1', portfolioName: '科技成长组合', refDate: '2026-05-24', totalValue: 500000, items: [{ tsCode: '000001.SZ', stockName: '平安银行', currentShares: 1000, currentPrice: 13.2, currentMarketValue: 13200, currentWeight: 0.22, targetWeight: 0.15, targetShares: 600, targetMarketValue: 7500, action: 'SELL', deltaShares: -400, deltaAmount: 5000, estimatedTradingCost: 6.25 }], summary: { totalBuyAmount: 50000, totalSellProceeds: 30000, totalTradingCost: 87.5, buyCount: 3, sellCount: 2, adjustCount: 1, holdCount: 2, skipCount: 1, cashBefore: 20000, cashAfter: 3000, isFeasible: true } }),
    }

    mockPerformanceService = {
      getPerformance: jest.fn().mockResolvedValue({ portfolioId: 'port-1', benchmarkTsCode: '000300.SH', startDate: '20260101', endDate: '20260524', metrics: { totalReturn: 0.15, benchmarkTotalReturn: 0.08, cumulativeExcessReturn: 0.07, annualizedReturn: 0.12, annualizedVolatility: 0.18, trackingError: 0.05, informationRatio: 1.4, maxDrawdown: -0.12, sharpeRatio: 0.67 }, dailySeries: [{ date: '20260524', portfolioNav: 1.15, benchmarkNav: 1.08, dailyReturn: 0.005, benchmarkReturn: 0.003, excessReturn: 0.002, cumulativeExcess: 0.07 }] }),
    }

    mockDriftService = {
      detect: jest.fn().mockResolvedValue({ driftScore: 0.15, details: [] }),
    }

    mockTradeLogService = {
      query: jest.fn().mockResolvedValue({ items: [{ id: 'log-1', tsCode: '000001.SZ', action: 'BUY', quantity: 1000, price: 12.5, amount: 12500, reason: '手动买入', tradeDate: '20260524' }], total: 1 }),
      summary: jest.fn().mockResolvedValue({ totalBuyAmount: 50000, totalSellAmount: 30000, tradeCount: 10 }),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: PortfolioRiskService, useValue: mockRiskService },
        { provide: RiskCheckService, useValue: mockRiskCheckService },
        { provide: BacktestPortfolioBridgeService, useValue: mockBridgeService },
        { provide: RebalancePlanService, useValue: mockRebalanceService },
        { provide: PortfolioPerformanceService, useValue: mockPerformanceService },
        { provide: DriftDetectionService, useValue: mockDriftService },
        { provide: PortfolioTradeLogService, useValue: mockTradeLogService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    const reflector = moduleRef.get(Reflector)
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalGuards(
      { canActivate: () => true } as CanActivate,
      new RolesGuard(reflector),
    )
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 组合 CRUD ──────────────────────────────────────────────────────────────

  describe('组合 CRUD', () => {
    it('P-BIZ-001: 创建组合', async () => {
      const res = await req
        .post('/portfolio/create')
        .send({ name: '科技成长组合', initialCash: 100000, description: '专注AI' })
        .expect(201)
      expect(res.body.data.id).toBe('port-1')
      expect(res.body.data.name).toBe('科技成长组合')
      expect(mockPortfolioService.create).toHaveBeenCalledWith(1, expect.objectContaining({ name: '科技成长组合', initialCash: 100000 }))
    })

    it('P-BIZ-002: 获取组合列表', async () => {
      const res = await req
        .post('/portfolio/list')
        .send({})
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].holdingCount).toBe(1)
    })

    it('P-BIZ-003: 获取组合详情', async () => {
      const res = await req
        .post('/portfolio/detail')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.portfolio.id).toBe('port-1')
      expect(res.body.data.holdings).toHaveLength(1)
      expect(res.body.data.summary.totalMarketValue).toBe(13200)
    })

    it('P-BIZ-004: 更新组合', async () => {
      await req
        .post('/portfolio/update')
        .send({ id: 'port-1', name: '更新后组合' })
        .expect(201)
      expect(mockPortfolioService.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'port-1', name: '更新后组合' }), 1)
    })

    it('P-BIZ-005: 删除组合', async () => {
      const res = await req
        .post('/portfolio/delete')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.success).toBe(true)
    })

    it('P-EDGE-001: 组合名称 100 字符', async () => {
      const name = 'a'.repeat(100)
      await req
        .post('/portfolio/create')
        .send({ name, initialCash: 100000 })
        .expect(201)
    })

    it('P-EDGE-002: 组合名称 101 字符应 400', async () => {
      const name = 'a'.repeat(101)
      await req
        .post('/portfolio/create')
        .send({ name, initialCash: 100000 })
        .expect(400)
    })

    it('P-EDGE-003: 初始资金=0', async () => {
      await req
        .post('/portfolio/create')
        .send({ name: '零资金组合', initialCash: 0 })
        .expect(201)
    })

    it('P-EDGE-004: 初始资金负数应 400', async () => {
      await req
        .post('/portfolio/create')
        .send({ name: '负资金组合', initialCash: -1 })
        .expect(400)
    })

    it('P-ERR-001: 创建缺 name 应 400', async () => {
      await req
        .post('/portfolio/create')
        .send({ initialCash: 100000 })
        .expect(400)
    })

    it('P-ERR-002: 创建缺 initialCash 应 400', async () => {
      await req
        .post('/portfolio/create')
        .send({ name: '缺资金' })
        .expect(400)
    })

    it('P-ERR-003: detail 不存在的组合', async () => {
      mockPortfolioService.detail.mockResolvedValue(null)
      const res = await req
        .post('/portfolio/detail')
        .send({ portfolioId: '999999' })
        .expect(201)
      expect(res.body.data).toBeNull()
    })

    it('P-ERR-004: update 不存在的组合', async () => {
      mockPortfolioService.update.mockRejectedValue(new Error('组合不存在'))
      await req
        .post('/portfolio/update')
        .send({ id: '999999', name: '不存在' })
        .expect(500)
    })

    it('P-ERR-005: delete 不存在的组合', async () => {
      mockPortfolioService.delete.mockRejectedValue(new Error('组合不存在'))
      await req
        .post('/portfolio/delete')
        .send({ portfolioId: '999999' })
        .expect(500)
    })
  })

  // ── 持仓管理 ──────────────────────────────────────────────────────────────

  describe('持仓管理', () => {
    it('P-BIZ-006: 添加持仓', async () => {
      const res = await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 1000, avgCost: 12.5 })
        .expect(201)
      expect(res.body.data.id).toBe('hold-1')
      expect(res.body.data.tsCode).toBe('000001.SZ')
    })

    it('P-BIZ-007: 更新持仓', async () => {
      await req
        .post('/portfolio/holding/update')
        .send({ holdingId: 'hold-1', quantity: 2000, avgCost: 13.0 })
        .expect(201)
      expect(mockPortfolioService.updateHolding).toHaveBeenCalledWith(expect.objectContaining({ holdingId: 'hold-1', quantity: 2000 }), 1)
    })

    it('P-BIZ-008: 删除持仓', async () => {
      const res = await req
        .post('/portfolio/holding/remove')
        .send({ holdingId: 'hold-1' })
        .expect(201)
      expect(res.body.data.success).toBe(true)
    })

    it('P-EDGE-005: 股票代码格式正确', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 100, avgCost: 10 })
        .expect(201)
    })

    it('P-EDGE-006: 股票代码格式错误应 400', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001', quantity: 100, avgCost: 10 })
        .expect(400)
    })

    it('P-EDGE-007: 持仓数量=0 应 400', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 0, avgCost: 10 })
        .expect(400)
    })

    it('P-EDGE-008: 持仓数量=1（最小）', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 1, avgCost: 10 })
        .expect(201)
    })

    it('P-EDGE-009: 成本价=0', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 100, avgCost: 0 })
        .expect(201)
    })

    it('P-EDGE-010: 成本价负数应 400', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', quantity: 100, avgCost: -1 })
        .expect(400)
    })

    it('P-ERR-006: add 缺 tsCode 应 400', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', quantity: 100, avgCost: 10 })
        .expect(400)
    })

    it('P-ERR-007: add 缺 quantity 应 400', async () => {
      await req
        .post('/portfolio/holding/add')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ', avgCost: 10 })
        .expect(400)
    })

    it('P-ERR-008: update 不存在的持仓', async () => {
      mockPortfolioService.updateHolding.mockRejectedValue(new Error('持仓不存在'))
      await req
        .post('/portfolio/holding/update')
        .send({ holdingId: '999999', quantity: 100, avgCost: 10 })
        .expect(500)
    })
  })

  // ── 盈亏分析 ──────────────────────────────────────────────────────────────

  describe('盈亏分析', () => {
    it('P-BIZ-010: 当日盈亏', async () => {
      const res = await req
        .post('/portfolio/pnl/today')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.todayPnl).toBe(320.5)
      expect(res.body.data.byHolding).toHaveLength(1)
    })

    it('P-BIZ-011: 历史净值', async () => {
      const res = await req
        .post('/portfolio/pnl/history')
        .send({ portfolioId: 'port-1', startDate: '20260101', endDate: '20260524' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].nav).toBe(1.056)
    })

    it('P-EDGE-011: 日期格式正确', async () => {
      await req
        .post('/portfolio/pnl/history')
        .send({ portfolioId: 'port-1', startDate: '20260101', endDate: '20260524' })
        .expect(201)
    })

    it('P-EDGE-012: 日期格式错误应 400', async () => {
      await req
        .post('/portfolio/pnl/history')
        .send({ portfolioId: 'port-1', startDate: '2026/01/01', endDate: '20260524' })
        .expect(400)
    })

    it('P-ERR-009: pnl/history 缺 endDate 应 400', async () => {
      await req
        .post('/portfolio/pnl/history')
        .send({ portfolioId: 'port-1', startDate: '20260101' })
        .expect(400)
    })
  })

  // ── 风险分析 ──────────────────────────────────────────────────────────────

  describe('风险分析', () => {
    it('P-BIZ-012: 行业分布', async () => {
      const res = await req
        .post('/portfolio/risk/industry')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.industries).toHaveLength(1)
      expect(res.body.data.industries[0].industry).toBe('银行')
    })

    it('P-BIZ-013: 仓位集中度', async () => {
      const res = await req
        .post('/portfolio/risk/position')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.concentration.hhi).toBe(0.1234)
      expect(res.body.data.positions).toHaveLength(1)
    })

    it('P-BIZ-014: 市值分布', async () => {
      const res = await req
        .post('/portfolio/risk/market-cap')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.buckets).toHaveLength(1)
      expect(res.body.data.buckets[0].label).toContain('大盘')
    })

    it('P-BIZ-015: Beta 分析', async () => {
      const res = await req
        .post('/portfolio/risk/beta')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.portfolioBeta).toBe(0.91)
      expect(res.body.data.holdings[0].beta).toBe(0.85)
    })

    it('P-BIZ-016: 风险快照', async () => {
      const res = await req
        .post('/portfolio/risk/snapshot')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data).toHaveProperty('industry')
      expect(res.body.data).toHaveProperty('position')
      expect(res.body.data).toHaveProperty('marketCap')
      expect(res.body.data).toHaveProperty('beta')
    })
  })

  // ── 风控规则 ──────────────────────────────────────────────────────────────

  describe('风控规则', () => {
    it('P-BIZ-017: 创建风控规则', async () => {
      const res = await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 0.3 })
        .expect(201)
      expect(res.body.data.id).toBe('rule-1')
      expect(res.body.data.ruleType).toBe('MAX_SINGLE_POSITION')
    })

    it('P-BIZ-018: 查询规则列表', async () => {
      const res = await req
        .post('/portfolio/rule/list')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].ruleType).toBe('MAX_SINGLE_POSITION')
    })

    it('P-BIZ-019: 更新规则', async () => {
      await req
        .post('/portfolio/rule/update')
        .send({ ruleId: 'rule-1', threshold: 0.4, isEnabled: true })
        .expect(201)
      expect(mockRiskCheckService.updateRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-1', threshold: 0.4 }), 1)
    })

    it('P-BIZ-020: 删除规则', async () => {
      const res = await req
        .post('/portfolio/rule/delete')
        .send({ ruleId: 'rule-1' })
        .expect(201)
      expect(res.body.data.success).toBe(true)
    })

    it('P-EDGE-013: 阈值=0.01（最小）', async () => {
      await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 0.01 })
        .expect(201)
    })

    it('P-EDGE-014: 阈值=1.0（最大）', async () => {
      await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 1.0 })
        .expect(201)
    })

    it('P-EDGE-015: 阈值=0.009（超限）应 400', async () => {
      mockRiskCheckService.upsertRule.mockClear()

      const res = await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 0.009 })
        .expect(400)

      expect(res.body.code).not.toBe(0)
      expect(mockRiskCheckService.upsertRule).not.toHaveBeenCalled()
    })

    it('P-EDGE-016: 阈值=1.01（超限）应 400', async () => {
      mockRiskCheckService.upsertRule.mockClear()

      const res = await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'MAX_SINGLE_POSITION', threshold: 1.01 })
        .expect(400)

      expect(res.body.code).not.toBe(0)
      expect(mockRiskCheckService.upsertRule).not.toHaveBeenCalled()
    })

    it('P-ERR-011: 无效 ruleType 应 400', async () => {
      await req
        .post('/portfolio/rule/upsert')
        .send({ portfolioId: 'port-1', ruleType: 'INVALID_TYPE', threshold: 0.3 })
        .expect(400)
    })

    it('P-ERR-012: upsert 缺 portfolioId 应 400', async () => {
      await req
        .post('/portfolio/rule/upsert')
        .send({ ruleType: 'MAX_SINGLE_POSITION', threshold: 0.3 })
        .expect(400)
    })
  })

  // ── 风险检测 ──────────────────────────────────────────────────────────────

  describe('风险检测', () => {
    it('P-BIZ-021: 执行风控检测', async () => {
      const res = await req
        .post('/portfolio/risk/check')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.violations).toHaveLength(1)
      expect(res.body.data.violations[0].ruleType).toBe('MAX_SINGLE_POSITION')
    })

    it('P-BIZ-022: 查询违规记录', async () => {
      const res = await req
        .post('/portfolio/risk/violations')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].message).toContain('超限')
    })
  })

  // ── 回测导入 ──────────────────────────────────────────────────────────────

  describe('回测导入', () => {
    it('P-BIZ-023: REPLACE 模式导入', async () => {
      const res = await req
        .post('/portfolio/apply-backtest')
        .send({ backtestRunId: 'bt-1', mode: 'REPLACE' })
        .expect(201)
      expect(res.body.data.mode).toBe('REPLACE')
      expect(res.body.data.summary.added).toBe(3)
    })

    it('P-BIZ-024: MERGE 模式导入', async () => {
      await req
        .post('/portfolio/apply-backtest')
        .send({ backtestRunId: 'bt-1', mode: 'MERGE' })
        .expect(201)
      expect(mockBridgeService.applyBacktest).toHaveBeenCalledWith(expect.objectContaining({ mode: 'MERGE' }), 1)
    })

    it('P-BIZ-025: 自动创建新组合', async () => {
      await req
        .post('/portfolio/apply-backtest')
        .send({ backtestRunId: 'bt-1' })
        .expect(201)
    })

    it('P-ERR-014: 无效 mode 应 400', async () => {
      await req
        .post('/portfolio/apply-backtest')
        .send({ backtestRunId: 'bt-1', mode: 'INVALID' })
        .expect(400)
    })

    it('P-ERR-015: 缺 backtestRunId 应 400', async () => {
      await req
        .post('/portfolio/apply-backtest')
        .send({ mode: 'REPLACE' })
        .expect(400)
    })
  })

  // ── 调仓清单 ──────────────────────────────────────────────────────────────

  describe('调仓清单', () => {
    it('P-BIZ-026: 生成调仓计划', async () => {
      const res = await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0.15 }] })
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.summary.isFeasible).toBe(true)
    })

    it('P-BIZ-027: 指定 totalValue', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0.15 }], totalValue: 500000 })
        .expect(201)
      expect(mockRebalanceService.rebalancePlan).toHaveBeenCalledWith(expect.objectContaining({ totalValue: 500000 }), 1)
    })

    it('P-BIZ-028: 未指定持仓=SELL', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0.15 }], omitUnspecified: 'SELL' })
        .expect(201)
    })

    it('P-BIZ-029: 未指定持仓=HOLD', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0.15 }], omitUnspecified: 'HOLD' })
        .expect(201)
    })

    it('P-EDGE-018: targets 权重=0', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 0 }] })
        .expect(201)
    })

    it('P-EDGE-019: targets 权重=1', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 1 }] })
        .expect(201)
    })

    it('P-EDGE-020: targets 权重=1.01 应 400', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1', targets: [{ tsCode: '000001.SZ', targetWeight: 1.01 }] })
        .expect(400)
    })

    it('P-ERR-016: 缺 targets 应 400', async () => {
      await req
        .post('/portfolio/rebalance-plan')
        .send({ portfolioId: 'port-1' })
        .expect(400)
    })
  })

  // ── 绩效跟踪 ──────────────────────────────────────────────────────────────

  describe('绩效跟踪', () => {
    it('P-BIZ-030: 绩效查询', async () => {
      const res = await req
        .post('/portfolio/performance')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.metrics.totalReturn).toBe(0.15)
      expect(res.body.data.dailySeries).toHaveLength(1)
    })

    it('P-BIZ-031: 指定基准', async () => {
      await req
        .post('/portfolio/performance')
        .send({ portfolioId: 'port-1', benchmarkTsCode: '000001.SH' })
        .expect(201)
      expect(mockPerformanceService.getPerformance).toHaveBeenCalledWith(expect.objectContaining({ benchmarkTsCode: '000001.SH' }), 1)
    })

    it('P-BIZ-032: 指定日期范围', async () => {
      await req
        .post('/portfolio/performance')
        .send({ portfolioId: 'port-1', startDate: '20260101', endDate: '20260524' })
        .expect(201)
    })
  })

  // ── 策略漂移 ──────────────────────────────────────────────────────────────

  describe('策略漂移', () => {
    it('P-BIZ-033: 漂移检测', async () => {
      const res = await req
        .post('/portfolio/drift-detection')
        .send({ portfolioId: 'port-1', signalRuleId: 'rule-1' })
        .expect(201)
      expect(res.body.data.driftScore).toBe(0.15)
    })
  })

  // ── 交易日志 ──────────────────────────────────────────────────────────────

  describe('交易日志', () => {
    it('P-BIZ-034: 查询交易日志', async () => {
      const res = await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.total).toBe(1)
    })

    it('P-BIZ-035: 按日期过滤', async () => {
      await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1', startDate: '20260101', endDate: '20260524' })
        .expect(201)
      expect(mockTradeLogService.query).toHaveBeenCalledWith(expect.objectContaining({ startDate: '20260101', endDate: '20260524' }), 1)
    })

    it('P-BIZ-036: 按股票过滤', async () => {
      await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1', tsCode: '000001.SZ' })
        .expect(201)
      expect(mockTradeLogService.query).toHaveBeenCalledWith(expect.objectContaining({ tsCode: '000001.SZ' }), 1)
    })

    it('P-BIZ-037: 交易日志汇总', async () => {
      const res = await req
        .post('/portfolio/trade-log/summary')
        .send({ portfolioId: 'port-1' })
        .expect(201)
      expect(res.body.data.totalBuyAmount).toBe(50000)
      expect(res.body.data.tradeCount).toBe(10)
    })

    it('P-EDGE-021: 分页 page=1', async () => {
      await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1', page: 1 })
        .expect(201)
    })

    it('P-EDGE-022: 分页 page=0 应 400', async () => {
      await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1', page: 0 })
        .expect(400)
    })

    it('P-ERR-020: 日期格式错误应 400', async () => {
      await req
        .post('/portfolio/trade-log')
        .send({ portfolioId: 'port-1', startDate: 'abc' })
        .expect(400)
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('P-SEC-001: 无 Token 应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [PortfolioController],
        providers: [
          { provide: PortfolioService, useValue: mockPortfolioService },
          { provide: PortfolioRiskService, useValue: mockRiskService },
          { provide: RiskCheckService, useValue: mockRiskCheckService },
          { provide: BacktestPortfolioBridgeService, useValue: mockBridgeService },
          { provide: RebalancePlanService, useValue: mockRebalanceService },
          { provide: PortfolioPerformanceService, useValue: mockPerformanceService },
          { provide: DriftDetectionService, useValue: mockDriftService },
          { provide: PortfolioTradeLogService, useValue: mockTradeLogService },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue(mockJwtGuardNoAuth)
        .compile()

      const reflector = moduleRef.get(Reflector)
      const unauthApp = moduleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/portfolio/list')
        .expect(401)
      await unauthApp.close()
    })
  })
})
