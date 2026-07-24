import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { PortfolioRiskRuleType, StockExchange, UserRole, UserStatus } from '@prisma/client'
import request from 'supertest'
import type { RedisClientType } from 'redis'

import { AuthModule } from 'src/apps/auth/auth.module'
import { PortfolioController } from 'src/apps/portfolio/portfolio.controller'
import { PortfolioRiskService } from 'src/apps/portfolio/portfolio-risk.service'
import { PortfolioService } from 'src/apps/portfolio/portfolio.service'
import { RiskCheckService } from 'src/apps/portfolio/risk-check.service'
import { BacktestPortfolioBridgeService } from 'src/apps/portfolio/services/backtest-portfolio-bridge.service'
import { PortfolioPerformanceService } from 'src/apps/portfolio/services/portfolio-performance.service'
import { PortfolioTradeLogService } from 'src/apps/portfolio/services/portfolio-trade-log.service'
import { RebalancePlanService } from 'src/apps/portfolio/services/rebalance-plan.service'
import { DriftDetectionService } from 'src/apps/signal/drift-detection.service'
import { TokenService } from 'src/shared/token.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'

const TRADE_DATE = new Date('2026-07-20T00:00:00.000Z')

describe('旧业务 E2E Flow 3 — 组合管理与风控', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType
  let ownerToken: string
  let otherToken: string

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({
      imports: [AuthModule],
      controllers: [PortfolioController],
      providers: [
        PortfolioService,
        PortfolioRiskService,
        RiskCheckService,
        PortfolioTradeLogService,
        { provide: EventsGateway, useValue: { emitToUser: jest.fn() } },
        { provide: BacktestPortfolioBridgeService, useValue: {} },
        { provide: RebalancePlanService, useValue: {} },
        { provide: PortfolioPerformanceService, useValue: {} },
        { provide: DriftDetectionService, useValue: {} },
      ],
    })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis
    await cleanPortfolioFixture(prisma)
    await redis.flushDb()

    const [owner, other] = await Promise.all([
      prisma.user.create({
        data: {
          account: 'legacy_portfolio_owner',
          password: 'unused',
          nickname: 'Portfolio Owner',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          account: 'legacy_portfolio_other',
          password: 'unused',
          nickname: 'Portfolio Other',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        },
      }),
    ])
    const tokenService = app.get(TokenService)
    ;[ownerToken, otherToken] = await Promise.all([
      tokenService.generateAccessToken({
        id: owner.id,
        account: owner.account,
        nickname: owner.nickname,
        role: owner.role,
      }),
      tokenService.generateAccessToken({
        id: other.id,
        account: other.account,
        nickname: other.nickname,
        role: other.role,
      }),
    ])

    await prisma.stockBasic.createMany({
      data: [
        { tsCode: '000001.SZ', symbol: '000001', name: '平安银行', industry: '银行' },
        { tsCode: '600519.SH', symbol: '600519', name: '贵州茅台', industry: '白酒' },
      ],
    })
    await prisma.tradeCal.create({
      data: { exchange: StockExchange.SSE, calDate: TRADE_DATE, isOpen: '1' },
    })
    await prisma.daily.create({
      data: {
        tsCode: '000001.SZ',
        tradeDate: TRADE_DATE,
        open: 10,
        high: 11,
        low: 10,
        close: 11,
        preClose: 10,
        change: 1,
        pctChg: 10,
      },
    })
    await prisma.dailyBasic.createMany({
      data: [
        { tsCode: '000001.SZ', tradeDate: TRADE_DATE, close: 11, totalMv: 100_000 },
        { tsCode: '600519.SH', tradeDate: TRADE_DATE, close: 1800, totalMv: 1_000_000 },
      ],
    })
  })

  afterAll(async () => {
    await cleanPortfolioFixture(prisma)
    await redis.flushDb()
    await app.close()
  })

  it('LEG-PF-BIZ-001/DATA-001：加权成本、减仓、缺行情 P&L 均符合手算', async () => {
    const created = await post(ownerToken, '/api/portfolio/create', {
      name: 'E2E 组合',
      initialCash: 500_000,
    })
    expect(created.body.code).toBe(0)
    const portfolioId = created.body.data.id as string

    const first = await post(ownerToken, '/api/portfolio/holding/add', {
      portfolioId,
      tsCode: '000001.SZ',
      quantity: 1000,
      avgCost: 10.5,
    })
    const holdingId = first.body.data.id as string
    expect(Number(first.body.data.avgCost)).toBeCloseTo(10.5, 4)

    const second = await post(ownerToken, '/api/portfolio/holding/add', {
      portfolioId,
      tsCode: '000001.SZ',
      quantity: 500,
      avgCost: 11,
    })
    const weightedCost = (1000 * 10.5 + 500 * 11) / 1500
    const storedWeightedCost = Math.round(weightedCost * 10_000) / 10_000
    expect(second.body.data.quantity).toBe(1500)
    expect(Number(second.body.data.avgCost)).toBe(storedWeightedCost)

    const reduced = await post(ownerToken, '/api/portfolio/holding/update', {
      holdingId,
      quantity: 500,
      avgCost: storedWeightedCost,
    })
    expect(reduced.body.data.quantity).toBe(500)
    expect(Number(reduced.body.data.avgCost)).toBe(storedWeightedCost)

    await post(ownerToken, '/api/portfolio/holding/add', {
      portfolioId,
      tsCode: '600519.SH',
      quantity: 10,
      avgCost: 1800,
    })

    const detail = await post(ownerToken, '/api/portfolio/detail', { portfolioId })
    expect(detail.body.data.holdings).toHaveLength(2)
    expect(detail.body.data.summary.totalCost).toBe(storedWeightedCost * 500 + 18_000)

    const pnl = await post(ownerToken, '/api/portfolio/pnl/today', { portfolioId })
    expect(pnl.body.data.todayPnl).toBeCloseTo(500, 6)
    expect(pnl.body.data.todayPnlPct).toBeCloseTo(0.1, 6)
    expect(pnl.body.data.byHolding).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tsCode: '000001.SZ', pctChg: 10, todayPnl: 500 }),
        expect.objectContaining({ tsCode: '600519.SH', pctChg: null, todayPnl: null }),
      ]),
    )
    expect(Number.isFinite(pnl.body.data.todayPnl)).toBe(true)
  })

  it('LEG-PF-BIZ-002：集中度规则触发、禁用与空组合边界正确', async () => {
    const created = await post(ownerToken, '/api/portfolio/create', {
      name: '风控组合',
      initialCash: 100_000,
    })
    const portfolioId = created.body.data.id as string
    await post(ownerToken, '/api/portfolio/holding/add', {
      portfolioId,
      tsCode: '600519.SH',
      quantity: 10,
      avgCost: 1800,
    })
    const rule = await post(ownerToken, '/api/portfolio/rule/upsert', {
      portfolioId,
      ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION,
      threshold: 0.3,
    })
    const ruleId = rule.body.data.id as string

    const violated = await post(ownerToken, '/api/portfolio/risk/check', { portfolioId })
    expect(violated.body.data.violations).toHaveLength(1)
    expect(violated.body.data.violations[0]).toMatchObject({
      ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION,
      actualValue: 1,
      threshold: 0.3,
    })

    await post(ownerToken, '/api/portfolio/rule/update', {
      ruleId,
      threshold: 0.3,
      isEnabled: false,
    })
    const disabled = await post(ownerToken, '/api/portfolio/risk/check', { portfolioId })
    expect(disabled.body.data.violations).toEqual([])

    const empty = await post(ownerToken, '/api/portfolio/create', {
      name: '空组合',
      initialCash: 10_000,
    })
    const emptyCheck = await post(ownerToken, '/api/portfolio/risk/check', {
      portfolioId: empty.body.data.id,
    })
    expect(emptyCheck.body.data.violations).toEqual([])
  })

  it('LEG-PF-SEC-001：其他用户不能读取或修改组合', async () => {
    const created = await post(ownerToken, '/api/portfolio/create', {
      name: '私有组合',
      initialCash: 10_000,
    })
    const portfolioId = created.body.data.id as string

    await request(app.getHttpServer())
      .post('/api/portfolio/detail')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ portfolioId })
      .expect(403)
    await request(app.getHttpServer())
      .post('/api/portfolio/holding/add')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ portfolioId, tsCode: '000001.SZ', quantity: 100, avgCost: 10 })
      .expect(403)
  })

  function post(token: string, path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body).expect(201)
  }
})

async function cleanPortfolioFixture(prisma: PrismaService): Promise<void> {
  await prisma.riskViolationLog.deleteMany()
  await prisma.portfolioRiskRule.deleteMany()
  await prisma.portfolioTradeLog.deleteMany()
  await prisma.portfolioHolding.deleteMany()
  await prisma.portfolio.deleteMany()
  await prisma.daily.deleteMany({ where: { tsCode: { in: ['000001.SZ', '600519.SH'] } } })
  await prisma.dailyBasic.deleteMany({ where: { tsCode: { in: ['000001.SZ', '600519.SH'] } } })
  await prisma.tradeCal.deleteMany({ where: { calDate: TRADE_DATE } })
  await prisma.stockBasic.deleteMany({ where: { tsCode: { in: ['000001.SZ', '600519.SH'] } } })
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { account: { startsWith: 'legacy_portfolio_' } } })
}
