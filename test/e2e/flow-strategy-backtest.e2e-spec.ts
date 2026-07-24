import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { StockExchange, UserRole, UserStatus } from '@prisma/client'
import type { RedisClientType } from 'redis'
import request from 'supertest'

import { AuthModule } from 'src/apps/auth/auth.module'
import { StrategyModule } from 'src/apps/strategy/strategy.module'
import { TokenService } from 'src/shared/token.service'
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'
import { LegacyBacktestWorkerModule } from './support/legacy-backtest-worker.module'

const TS_CODE = '000001.SZ'
const BENCHMARK_CODE = '000300.SH'
const START_DATE = '20260706'
const END_DATE = '20260715'
const INITIAL_CAPITAL = 100_000
const TRADE_DATES = [
  '2026-07-06',
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-13',
  '2026-07-14',
  '2026-07-15',
] as const
const CLOSES = [10, 9, 8, 10, 12, 11, 7, 6] as const
const STRATEGY_CONFIG = {
  tsCode: TS_CODE,
  shortWindow: 2,
  longWindow: 3,
  priceField: 'close',
  allowFlat: false,
}

describe('旧业务 E2E Flow 2 — 策略发起回测', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType
  let ownerToken: string
  let otherToken: string
  let ownerId: number
  let strategyId: string
  let runId: string

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({
      imports: [AuthModule, StrategyModule, LegacyBacktestWorkerModule],
    })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis

    await cleanStrategyBacktestFixture(prisma)
    await redis.flushDb()

    const [owner, other] = await Promise.all([
      prisma.user.create({
        data: {
          account: 'legacy_strategy_owner',
          password: 'unused',
          nickname: 'Strategy Owner',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          account: 'legacy_strategy_other',
          password: 'unused',
          nickname: 'Strategy Other',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        },
      }),
    ])
    ownerId = owner.id

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

    await seedBacktestMarketFixture(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanStrategyBacktestFixture(prisma)
    if (redis) await redis.flushDb()
    if (app) await app.close()
  })

  it('LEG-SB-BIZ-001：创建策略→真实 Worker 回测→详情/净值/交易/持仓完整归属', async () => {
    const created = await post(ownerToken, '/api/strategies/create', {
      name: '均线反转 E2E',
      strategyType: 'MA_CROSS_SINGLE',
      strategyConfig: STRATEGY_CONFIG,
      backtestDefaults: {
        universe: 'CUSTOM',
        customUniverse: [TS_CODE],
        rebalanceFrequency: 'DAILY',
        priceMode: 'NEXT_OPEN',
      },
      tags: ['legacy-e2e'],
    })
    strategyId = created.body.data.id as string

    const strategyDetail = await post(ownerToken, '/api/strategies/detail', { id: strategyId })
    expect(strategyDetail.body.data).toMatchObject({
      id: strategyId,
      userId: ownerId,
      strategyType: 'MA_CROSS_SINGLE',
      strategyConfig: STRATEGY_CONFIG,
    })

    const queued = await post(ownerToken, '/api/strategies/run', {
      strategyId,
      name: '均线反转固定行情',
      startDate: START_DATE,
      endDate: END_DATE,
      initialCapital: INITIAL_CAPITAL,
      commissionRate: 0,
      stampDutyRate: 0,
      minCommission: 0,
      slippageBps: 0,
    })
    runId = queued.body.data.runId as string
    expect(queued.body.data).toMatchObject({ runId, status: 'QUEUED' })

    const detail = await waitForCompletedRun(runId)
    expect(detail).toMatchObject({
      runId,
      status: 'COMPLETED',
      progress: 100,
      strategyType: 'MA_CROSS_SINGLE',
      strategyConfig: STRATEGY_CONFIG,
      startDate: '2026-07-06',
      endDate: '2026-07-15',
      initialCapital: INITIAL_CAPITAL,
    })

    const [equity, trades, positions] = await Promise.all([
      post(ownerToken, '/api/backtests/runs/equity', { runId }),
      post(ownerToken, '/api/backtests/runs/trades', { runId, page: 1, pageSize: 20 }),
      post(ownerToken, '/api/backtests/runs/positions', { runId, tradeDate: '20260714' }),
    ])

    expect(equity.body.data.points).toHaveLength(TRADE_DATES.length)
    expect(trades.body.data.items.map((item: { side: string }) => item.side)).toEqual(
      expect.arrayContaining(['BUY', 'SELL']),
    )
    expect(trades.body.data.items.every((item: { tsCode: string }) => item.tsCode === TS_CODE)).toBe(true)
    expect(positions.body.data).toMatchObject({
      tradeDate: '2026-07-14',
      items: [expect.objectContaining({ tsCode: TS_CODE })],
    })
  })

  it('LEG-SB-DATA-001：固定行情下 NAV、收益、回撤、权益与持仓均满足独立不变量', async () => {
    const [detailResponse, equityResponse, positionsResponse] = await Promise.all([
      post(ownerToken, '/api/backtests/runs/detail', { runId }),
      post(ownerToken, '/api/backtests/runs/equity', { runId }),
      post(ownerToken, '/api/backtests/runs/positions', { runId, tradeDate: '20260714' }),
    ])
    const detail = detailResponse.body.data
    const points = equityResponse.body.data.points as Array<{
      tradeDate: string
      nav: number
      drawdown: number
      exposure: number
      cashRatio: number
    }>

    expect(points[0].nav).toBeCloseTo(1, 8)
    expect(points.every((point) => Number.isFinite(point.nav) && point.nav >= 0)).toBe(true)
    expect(points.every((point) => point.drawdown >= -1 && point.drawdown <= 0)).toBe(true)
    expect(points.every((point) => point.exposure >= 0 && point.cashRatio >= 0)).toBe(true)

    const endNav = points.at(-1)!.nav
    expect(detail.summary.totalReturn).toBeCloseTo(endNav - 1, 8)
    expect(detail.summary.maxDrawdown).toBeGreaterThanOrEqual(-1)
    expect(detail.summary.maxDrawdown).toBeLessThanOrEqual(0)

    const positionItems = positionsResponse.body.data.items as Array<{
      quantity: number
      costPrice: number
      marketValue: number
      weight: number
    }>
    const positionValue = positionItems.reduce((sum, item) => sum + item.marketValue, 0)
    const sameDayNav = points.find((point) => point.tradeDate === '2026-07-14')!.nav * INITIAL_CAPITAL
    expect(positionItems.every((item) => item.quantity >= 0 && item.costPrice >= 0 && item.marketValue >= 0)).toBe(true)
    expect(positionItems.every((item) => item.weight >= 0 && item.weight <= 1)).toBe(true)
    expect(positionValue).toBeLessThanOrEqual(sameDayNav)
  })

  it('LEG-SB-ERR-001：非法日期格式、反向日期、低于最低资金均被拒绝且不创建 Run', async () => {
    const before = await prisma.backtestRun.count({ where: { userId: ownerId } })

    const malformed = await request(app.getHttpServer())
      .post('/api/strategies/run')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        strategyId,
        startDate: '2026-07-06',
        endDate: END_DATE,
        initialCapital: INITIAL_CAPITAL,
      })
      .expect(400)
    expect(malformed.body.code).not.toBe(0)

    const reversed = await request(app.getHttpServer())
      .post('/api/strategies/run')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        strategyId,
        startDate: END_DATE,
        endDate: START_DATE,
        initialCapital: INITIAL_CAPITAL,
      })
      .expect(200)
    expect(reversed.body.code).toBe(9002)

    const insufficient = await request(app.getHttpServer())
      .post('/api/strategies/run')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        strategyId,
        startDate: START_DATE,
        endDate: END_DATE,
        initialCapital: 999,
      })
      .expect(400)
    expect(insufficient.body.code).not.toBe(0)

    expect(await prisma.backtestRun.count({ where: { userId: ownerId } })).toBe(before)
  })

  it('LEG-SB-SEC-001：其他用户不能发起该策略或读取该 Run', async () => {
    const before = await prisma.backtestRun.count()
    const forbiddenRun = await request(app.getHttpServer())
      .post('/api/strategies/run')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        strategyId,
        startDate: START_DATE,
        endDate: END_DATE,
        initialCapital: INITIAL_CAPITAL,
      })
      .expect(200)
    expect(forbiddenRun.body.code).toBe(5001)
    expect(await prisma.backtestRun.count()).toBe(before)

    await request(app.getHttpServer())
      .post('/api/backtests/runs/detail')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ runId })
      .expect(404)
  })

  function post(token: string, path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body).expect(201)
  }

  async function waitForCompletedRun(targetRunId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000
    let lastDetail: Record<string, unknown> | null = null

    while (Date.now() < deadline) {
      const response = await post(ownerToken, '/api/backtests/runs/detail', { runId: targetRunId })
      lastDetail = response.body.data as Record<string, unknown>
      if (lastDetail.status === 'COMPLETED') return lastDetail
      if (lastDetail.status === 'FAILED') {
        throw new Error(`回测失败：${String(lastDetail.failedReason ?? 'unknown')}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`回测 30 秒内未完成，最后状态：${String(lastDetail?.status ?? 'unknown')}`)
  }
})

async function seedBacktestMarketFixture(prisma: PrismaService): Promise<void> {
  const dates = TRADE_DATES.map((date) => new Date(`${date}T00:00:00.000Z`))

  await prisma.stockBasic.create({
    data: { tsCode: TS_CODE, symbol: '000001', name: '平安银行', industry: '银行' },
  })
  await prisma.tradeCal.createMany({
    data: dates.map((calDate) => ({ exchange: StockExchange.SSE, calDate, isOpen: '1' })),
  })
  await prisma.daily.createMany({
    data: dates.map((tradeDate, index) => ({
      tsCode: TS_CODE,
      tradeDate,
      open: CLOSES[index],
      high: CLOSES[index],
      low: CLOSES[index],
      close: CLOSES[index],
      preClose: index === 0 ? CLOSES[index] : CLOSES[index - 1],
      vol: 1_000_000,
    })),
  })
  await prisma.indexDaily.createMany({
    data: dates.map((tradeDate) => ({
      tsCode: BENCHMARK_CODE,
      tradeDate,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      preClose: 100,
    })),
  })
}

async function cleanStrategyBacktestFixture(prisma: PrismaService): Promise<void> {
  await prisma.backtestRebalanceLog.deleteMany()
  await prisma.backtestPositionSnapshot.deleteMany()
  await prisma.backtestTrade.deleteMany()
  await prisma.backtestDailyNav.deleteMany()
  await prisma.backtestRun.deleteMany()
  await prisma.strategyVersion.deleteMany()
  await prisma.strategy.deleteMany()
  await prisma.indexDaily.deleteMany({ where: { tsCode: BENCHMARK_CODE } })
  await prisma.daily.deleteMany({ where: { tsCode: TS_CODE } })
  await prisma.tradeCal.deleteMany({
    where: { calDate: { in: TRADE_DATES.map((date) => new Date(`${date}T00:00:00.000Z`)) } },
  })
  await prisma.stockBasic.deleteMany({ where: { tsCode: TS_CODE } })
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { account: { startsWith: 'legacy_strategy_' } } })
}
