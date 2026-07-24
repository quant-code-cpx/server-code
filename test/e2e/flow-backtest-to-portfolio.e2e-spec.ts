import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { StockExchange, UserRole, UserStatus } from '@prisma/client'
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
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'

const TRADE_DATE = new Date('2026-07-20T00:00:00.000Z')

describe('旧业务 E2E Flow 5 — 回测结果导入组合', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType
  let token: string
  let userId: number
  let completedRunId: string
  let pendingRunId: string

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({
      imports: [AuthModule],
      controllers: [PortfolioController],
      providers: [
        PortfolioService,
        BacktestPortfolioBridgeService,
        RebalancePlanService,
        PortfolioTradeLogService,
        { provide: PortfolioRiskService, useValue: {} },
        { provide: RiskCheckService, useValue: {} },
        { provide: PortfolioPerformanceService, useValue: {} },
        { provide: DriftDetectionService, useValue: {} },
      ],
    })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis
    await cleanBridgeFixture(prisma)
    await redis.flushDb()

    const user = await prisma.user.create({
      data: {
        account: 'legacy_bridge_owner',
        password: 'unused',
        nickname: 'Bridge Owner',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      },
    })
    userId = user.id
    token = await app.get(TokenService).generateAccessToken({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
      role: user.role,
    })

    await prisma.stockBasic.createMany({
      data: [
        { tsCode: '000001.SZ', symbol: '000001', name: '平安银行', industry: '银行' },
        { tsCode: '000858.SZ', symbol: '000858', name: '五粮液', industry: '白酒' },
      ],
    })
    await prisma.tradeCal.create({
      data: { exchange: StockExchange.SSE, calDate: TRADE_DATE, isOpen: '1' },
    })
    await prisma.daily.createMany({
      data: [
        { tsCode: '000001.SZ', tradeDate: TRADE_DATE, close: 10 },
        { tsCode: '000858.SZ', tradeDate: TRADE_DATE, close: 20 },
      ],
    })
    await prisma.dailyBasic.createMany({
      data: [
        { tsCode: '000001.SZ', tradeDate: TRADE_DATE, close: 10 },
        { tsCode: '000858.SZ', tradeDate: TRADE_DATE, close: 20 },
      ],
    })

    const [completed, pending] = await Promise.all([
      createBacktestRun(prisma, userId, 'COMPLETED', '已完成回测'),
      createBacktestRun(prisma, userId, 'PENDING', '未完成回测'),
    ])
    completedRunId = completed.id
    pendingRunId = pending.id
    await prisma.backtestPositionSnapshot.createMany({
      data: [
        {
          runId: completed.id,
          tradeDate: TRADE_DATE,
          tsCode: '000001.SZ',
          quantity: 200,
          costPrice: 12,
          closePrice: 10,
          marketValue: 2000,
          weight: 0.5,
        },
        {
          runId: completed.id,
          tradeDate: TRADE_DATE,
          tsCode: '000858.SZ',
          quantity: 200,
          costPrice: 18,
          closePrice: 20,
          marketValue: 4000,
          weight: 0.5,
        },
      ],
    })
  })

  afterAll(async () => {
    await cleanBridgeFixture(prisma)
    await redis.flushDb()
    await app.close()
  })

  it('LEG-BP-BIZ-001：REPLACE 精确替换末日持仓，MERGE 使用加权平均成本', async () => {
    const replacePortfolioId = await createPortfolio('REPLACE 组合')
    await addHolding(replacePortfolioId, '000001.SZ', 100, 8)
    await addHolding(replacePortfolioId, '000858.SZ', 500, 15)

    const replaced = await post('/api/portfolio/apply-backtest', {
      backtestRunId: completedRunId,
      portfolioId: replacePortfolioId,
      mode: 'REPLACE',
    })
    expect(replaced.body.data.summary).toEqual({
      added: 0,
      updated: 2,
      removed: 0,
      unchanged: 0,
      totalHoldings: 2,
    })
    const replaceDetail = await post('/api/portfolio/detail', { portfolioId: replacePortfolioId })
    expect(normalizeHoldings(replaceDetail.body.data.holdings)).toEqual([
      { tsCode: '000001.SZ', quantity: 200, avgCost: 12 },
      { tsCode: '000858.SZ', quantity: 200, avgCost: 18 },
    ])

    const mergePortfolioId = await createPortfolio('MERGE 组合')
    await addHolding(mergePortfolioId, '000001.SZ', 100, 8)
    const merged = await post('/api/portfolio/apply-backtest', {
      backtestRunId: completedRunId,
      portfolioId: mergePortfolioId,
      mode: 'MERGE',
    })
    expect(merged.body.data.summary).toEqual({
      added: 1,
      updated: 1,
      removed: 0,
      unchanged: 0,
      totalHoldings: 2,
    })
    const mergeDetail = await post('/api/portfolio/detail', { portfolioId: mergePortfolioId })
    expect(normalizeHoldings(mergeDetail.body.data.holdings)).toEqual([
      { tsCode: '000001.SZ', quantity: 300, avgCost: 10.6667 },
      { tsCode: '000858.SZ', quantity: 200, avgCost: 18 },
    ])
  })

  it('LEG-BP-DATA-001：未完成回测被拒绝，原组合持仓不变', async () => {
    const portfolioId = await createPortfolio('原子性组合')
    await addHolding(portfolioId, '000001.SZ', 100, 8)

    const rejected = await request(app.getHttpServer())
      .post('/api/portfolio/apply-backtest')
      .set('Authorization', `Bearer ${token}`)
      .send({ backtestRunId: pendingRunId, portfolioId, mode: 'REPLACE' })
      .expect(400)
    expect(rejected.body.code).not.toBe(0)

    const detail = await post('/api/portfolio/detail', { portfolioId })
    expect(normalizeHoldings(detail.body.data.holdings)).toEqual([{ tsCode: '000001.SZ', quantity: 100, avgCost: 8 }])
  })

  it('LEG-BP-BIZ-002：目标权重换算为整手，停牌股票返回 SKIP', async () => {
    const portfolioId = await createPortfolio('调仓组合')
    await addHolding(portfolioId, '000001.SZ', 100, 8)
    await addHolding(portfolioId, '000858.SZ', 100, 18)

    const plan = await post('/api/portfolio/rebalance-plan', {
      portfolioId,
      totalValue: 100_000,
      targets: [
        { tsCode: '000001.SZ', targetWeight: 0.6 },
        { tsCode: '000858.SZ', targetWeight: 0.4 },
      ],
      omitUnspecified: 'HOLD',
    })
    expect(plan.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tsCode: '000001.SZ', targetShares: 6000 }),
        expect.objectContaining({ tsCode: '000858.SZ', targetShares: 2000 }),
      ]),
    )
    expect(plan.body.data.items.every((item: { targetShares: number }) => item.targetShares % 100 === 0)).toBe(true)

    await prisma.suspendD.create({
      data: { tsCode: '000858.SZ', tradeDate: '20260720', suspendType: '盘中停牌' },
    })
    const suspended = await post('/api/portfolio/rebalance-plan', {
      portfolioId,
      totalValue: 100_000,
      targets: [
        { tsCode: '000001.SZ', targetWeight: 0.6 },
        { tsCode: '000858.SZ', targetWeight: 0.4 },
      ],
      omitUnspecified: 'HOLD',
    })
    expect(suspended.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tsCode: '000858.SZ',
          action: 'SKIP',
          skipReason: 'SUSPENDED',
          targetShares: 100,
        }),
      ]),
    )
  })

  async function createPortfolio(name: string): Promise<string> {
    const response = await post('/api/portfolio/create', { name, initialCash: 100_000 })
    return response.body.data.id as string
  }

  async function addHolding(portfolioId: string, tsCode: string, quantity: number, avgCost: number): Promise<void> {
    const response = await post('/api/portfolio/holding/add', { portfolioId, tsCode, quantity, avgCost })
    expect(response.body.code).toBe(0)
  }

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body).expect(201)
  }
})

async function createBacktestRun(prisma: PrismaService, userId: number, status: string, name: string) {
  return prisma.backtestRun.create({
    data: {
      userId,
      name,
      strategyType: 'MA_CROSS_SINGLE',
      strategyConfig: { shortPeriod: 5, longPeriod: 20 },
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: TRADE_DATE,
      benchmarkTsCode: '000300.SH',
      universe: 'ALL_A',
      initialCapital: 100_000,
      rebalanceFrequency: 'MONTHLY',
      priceMode: 'NEXT_OPEN',
      status,
      progress: status === 'COMPLETED' ? 100 : 0,
      completedAt: status === 'COMPLETED' ? new Date() : null,
    },
  })
}

function normalizeHoldings(items: Array<{ tsCode: string; quantity: number; avgCost: number }>) {
  return items
    .map((item) => ({
      tsCode: item.tsCode,
      quantity: item.quantity,
      avgCost: Number(item.avgCost),
    }))
    .sort((a, b) => a.tsCode.localeCompare(b.tsCode))
}

async function cleanBridgeFixture(prisma: PrismaService): Promise<void> {
  await prisma.suspendD.deleteMany({ where: { tsCode: { in: ['000001.SZ', '000858.SZ'] } } })
  await prisma.portfolioTradeLog.deleteMany()
  await prisma.portfolioHolding.deleteMany()
  await prisma.portfolio.deleteMany()
  await prisma.backtestPositionSnapshot.deleteMany()
  await prisma.backtestRun.deleteMany()
  await prisma.daily.deleteMany({ where: { tsCode: { in: ['000001.SZ', '000858.SZ'] } } })
  await prisma.dailyBasic.deleteMany({ where: { tsCode: { in: ['000001.SZ', '000858.SZ'] } } })
  await prisma.tradeCal.deleteMany({ where: { calDate: TRADE_DATE } })
  await prisma.stockBasic.deleteMany({ where: { tsCode: { in: ['000001.SZ', '000858.SZ'] } } })
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { account: 'legacy_bridge_owner' } })
}
