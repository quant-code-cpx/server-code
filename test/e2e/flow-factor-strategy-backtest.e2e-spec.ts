import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { FactorCategory, FactorSourceType, StockExchange, UserRole, UserStatus } from '@prisma/client'
import type { RedisClientType } from 'redis'
import request from 'supertest'

import { AuthModule } from 'src/apps/auth/auth.module'
import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { FactorController } from 'src/apps/factor/factor.controller'
import { FactorService } from 'src/apps/factor/factor.service'
import { FactorBacktestService } from 'src/apps/factor/services/factor-backtest.service'
import { FactorComputeService } from 'src/apps/factor/services/factor-compute.service'
import { FactorExpressionService } from 'src/apps/factor/services/factor-expression.service'
import { FactorScreeningService } from 'src/apps/factor/services/factor-screening.service'
import { StrategyModule } from 'src/apps/strategy/strategy.module'
import { TokenService } from 'src/shared/token.service'
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'
import { LegacyBacktestWorkerModule } from './support/legacy-backtest-worker.module'

const FACTOR_NAME = 'pe_ttm'
const UNIVERSE_CODE = '000300.SH'
const START_DATE = '20260706'
const END_DATE = '20260709'
const INITIAL_CAPITAL = 100_000
const TRADE_DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'] as const
const UNIVERSE_CODES = Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(6, '0')}.SZ`)
const OUTSIDE_CODE = '600999.SH'
const ALL_CODES = [...UNIVERSE_CODES, OUTSIDE_CODE]
const CONDITIONS = [{ factorName: FACTOR_NAME, operator: 'lte', value: 20 }] as const

describe('旧业务 E2E Flow 4 — 因子筛选到策略回测', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType
  let token: string
  let strategyId: string
  let runId: string
  let screenedCodes: string[]

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({
      imports: [AuthModule, BacktestModule, StrategyModule, LegacyBacktestWorkerModule],
      controllers: [FactorController],
      providers: [
        FactorExpressionService,
        FactorComputeService,
        FactorScreeningService,
        FactorBacktestService,
        {
          provide: FactorService,
          useFactory: (screening: FactorScreeningService, backtest: FactorBacktestService) => ({
            screening: (dto: Parameters<FactorScreeningService['screening']>[0]) => screening.screening(dto),
            saveAsStrategy: (dto: Parameters<FactorBacktestService['saveAsStrategy']>[0], userId: number) =>
              backtest.saveAsStrategy(dto, userId),
          }),
          inject: [FactorScreeningService, FactorBacktestService],
        },
      ],
    })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis

    await cleanFactorBacktestFixture(prisma)
    await redis.flushDb()

    const user = await prisma.user.create({
      data: {
        account: 'legacy_factor_owner',
        password: 'unused',
        nickname: 'Factor Owner',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      },
    })
    token = await app.get(TokenService).generateAccessToken({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
      role: user.role,
    })

    await seedFactorBacktestFixture(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanFactorBacktestFixture(prisma)
    if (redis) await redis.flushDb()
    if (app) await app.close()
  })

  it('LEG-FSB-DATA-001：固定因子升序分页不重不漏，池外高排名股票被排除', async () => {
    const firstPage = await post('/api/factor/screening', {
      conditions: CONDITIONS,
      tradeDate: START_DATE,
      universe: UNIVERSE_CODE,
      sortBy: FACTOR_NAME,
      sortOrder: 'asc',
      page: 1,
      pageSize: 10,
    })
    const secondPage = await post('/api/factor/screening', {
      conditions: CONDITIONS,
      tradeDate: START_DATE,
      universe: UNIVERSE_CODE,
      sortBy: FACTOR_NAME,
      sortOrder: 'asc',
      page: 2,
      pageSize: 10,
    })

    const firstCodes = firstPage.body.data.items.map((item: { tsCode: string }) => item.tsCode)
    const secondCodes = secondPage.body.data.items.map((item: { tsCode: string }) => item.tsCode)
    screenedCodes = [...firstCodes, ...secondCodes]

    expect(firstPage.body.data).toMatchObject({
      total: 12,
      page: 1,
      pageSize: 10,
      summary: { universeSize: 12, matchedCount: 12, returnedCount: 10, pageCount: 2 },
    })
    expect(secondPage.body.data).toMatchObject({
      total: 12,
      page: 2,
      summary: { returnedCount: 2 },
    })
    expect(screenedCodes).toEqual(UNIVERSE_CODES)
    expect(new Set(screenedCodes).size).toBe(12)
    expect(screenedCodes).not.toContain(OUTSIDE_CODE)
    expect(
      [...firstPage.body.data.items, ...secondPage.body.data.items].every(
        (item: { factors: Record<string, number | null> }) => item.factors[FACTOR_NAME] != null,
      ),
    ).toBe(true)
  })

  it('LEG-FSB-BIZ-001：筛选条件和 universe 无损保存，真实 Worker 回测持仓严格来自筛选结果', async () => {
    const saved = await post('/api/factor/backtest/save-as-strategy', {
      conditions: CONDITIONS,
      universe: UNIVERSE_CODE,
      weightMethod: 'equal_weight',
      sortBy: FACTOR_NAME,
      sortOrder: 'asc',
      topN: 5,
      initialCapital: INITIAL_CAPITAL,
      rebalanceDays: 1,
      commissionRate: 0,
      slippageBps: 0,
      benchmarkCode: UNIVERSE_CODE,
      name: '因子筛选 E2E',
      tags: ['legacy-e2e'],
    })
    strategyId = saved.body.data.strategyId as string

    const detail = await post('/api/strategies/detail', { id: strategyId })
    expect(detail.body.data).toMatchObject({
      id: strategyId,
      strategyType: 'FACTOR_SCREENING_ROTATION',
      strategyConfig: {
        conditions: CONDITIONS,
        sortBy: FACTOR_NAME,
        sortOrder: 'asc',
        topN: 5,
        weightMethod: 'equal_weight',
      },
      backtestDefaults: {
        universe: 'HS300',
        universeCode: UNIVERSE_CODE,
        rebalanceFrequency: 'DAILY',
      },
    })

    const queued = await post('/api/strategies/run', {
      strategyId,
      startDate: START_DATE,
      endDate: END_DATE,
      initialCapital: INITIAL_CAPITAL,
      commissionRate: 0,
      stampDutyRate: 0,
      minCommission: 0,
      slippageBps: 0,
    })
    runId = queued.body.data.runId as string

    const runDetail = await waitForCompletedRun(runId)
    expect(runDetail).toMatchObject({
      runId,
      status: 'COMPLETED',
      strategyType: 'FACTOR_SCREENING_ROTATION',
      universe: 'HS300',
    })

    const positions = await post('/api/backtests/runs/positions', { runId })
    const holdingCodes = positions.body.data.items.map((item: { tsCode: string }) => item.tsCode).sort()
    expect(holdingCodes).toHaveLength(5)
    expect(holdingCodes).toEqual(UNIVERSE_CODES.slice(0, 5).sort())
    expect(holdingCodes.every((code: string) => screenedCodes.includes(code))).toBe(true)
    expect(holdingCodes).not.toContain(OUTSIDE_CODE)
  })

  it('LEG-FSB-SEC-001：注入字符串与不存在 universe 被拒绝，策略和 Run 数量不变', async () => {
    const before = await Promise.all([prisma.strategy.count(), prisma.backtestRun.count()])

    const injection = await request(app.getHttpServer())
      .post('/api/factor/screening')
      .set('Authorization', `Bearer ${token}`)
      .send({
        conditions: CONDITIONS,
        tradeDate: START_DATE,
        universe: "000300.SH' OR '1'='1",
        sortBy: FACTOR_NAME,
        sortOrder: 'asc',
        page: 1,
        pageSize: 10,
      })
      .expect(400)
    expect(injection.body.code).not.toBe(0)

    const unknown = await request(app.getHttpServer())
      .post('/api/factor/backtest/save-as-strategy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        conditions: CONDITIONS,
        universe: '999999.SH',
        sortBy: FACTOR_NAME,
        sortOrder: 'asc',
        topN: 5,
        name: '非法股票池策略',
      })
      .expect(400)
    expect(unknown.body.code).not.toBe(0)

    expect(await Promise.all([prisma.strategy.count(), prisma.backtestRun.count()])).toEqual(before)
  })

  function post(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).send(body).expect(201)
  }

  async function waitForCompletedRun(targetRunId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000
    let lastDetail: Record<string, unknown> | null = null

    while (Date.now() < deadline) {
      const response = await post('/api/backtests/runs/detail', { runId: targetRunId })
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

async function seedFactorBacktestFixture(prisma: PrismaService): Promise<void> {
  const dates = TRADE_DATES.map((date) => new Date(`${date}T00:00:00.000Z`))

  await prisma.factorDefinition.create({
    data: {
      name: FACTOR_NAME,
      label: '市盈率 TTM',
      description: 'E2E 固定因子',
      category: FactorCategory.VALUATION,
      sourceType: FactorSourceType.FIELD_REF,
      sourceTable: 'daily_basic',
      sourceField: 'pe_ttm',
      isBuiltin: true,
      isEnabled: true,
      sortOrder: 1,
    },
  })
  await prisma.stockBasic.createMany({
    data: ALL_CODES.map((tsCode, index) => ({
      tsCode,
      symbol: tsCode.slice(0, 6),
      name: `固定股票${index + 1}`,
      industry: '测试行业',
    })),
  })
  await prisma.indexWeight.createMany({
    data: UNIVERSE_CODES.map((conCode) => ({
      indexCode: UNIVERSE_CODE,
      conCode,
      tradeDate: '20260701',
      weight: 100 / UNIVERSE_CODES.length,
    })),
  })
  await prisma.factorSnapshotSummary.create({
    data: {
      factorName: FACTOR_NAME,
      tradeDate: START_DATE,
      count: ALL_CODES.length,
      missing: 0,
      mean: 6,
      median: 6,
      stdDev: 3,
      min: 0.1,
      max: 12,
      q25: 3,
      q75: 9,
    },
  })
  await prisma.factorSnapshot.createMany({
    data: [
      ...UNIVERSE_CODES.map((tsCode, index) => ({
        factorName: FACTOR_NAME,
        tradeDate: START_DATE,
        tsCode,
        value: index + 1,
        percentile: (index + 1) / UNIVERSE_CODES.length,
      })),
      {
        factorName: FACTOR_NAME,
        tradeDate: START_DATE,
        tsCode: OUTSIDE_CODE,
        value: 0.1,
        percentile: 0.01,
      },
      ...TRADE_DATES.flatMap((tradeDate) => [
        ...UNIVERSE_CODES.map((tsCode, index) => ({
          factorName: FACTOR_NAME,
          tradeDate,
          tsCode,
          value: index + 1,
          percentile: (index + 1) / UNIVERSE_CODES.length,
        })),
        {
          factorName: FACTOR_NAME,
          tradeDate,
          tsCode: OUTSIDE_CODE,
          value: 0.1,
          percentile: 0.01,
        },
      ]),
    ],
  })
  await prisma.tradeCal.createMany({
    data: dates.map((calDate) => ({ exchange: StockExchange.SSE, calDate, isOpen: '1' })),
  })
  await prisma.daily.createMany({
    data: dates.flatMap((tradeDate) =>
      ALL_CODES.map((tsCode, index) => ({
        tsCode,
        tradeDate,
        open: 10 + index,
        high: 10 + index,
        low: 10 + index,
        close: 10 + index,
        preClose: 10 + index,
        vol: 1_000_000,
      })),
    ),
  })
  await prisma.indexDaily.createMany({
    data: dates.map((tradeDate) => ({
      tsCode: UNIVERSE_CODE,
      tradeDate,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      preClose: 100,
    })),
  })
}

async function cleanFactorBacktestFixture(prisma: PrismaService): Promise<void> {
  await prisma.backtestRebalanceLog.deleteMany()
  await prisma.backtestPositionSnapshot.deleteMany()
  await prisma.backtestTrade.deleteMany()
  await prisma.backtestDailyNav.deleteMany()
  await prisma.backtestRun.deleteMany()
  await prisma.strategyVersion.deleteMany()
  await prisma.strategy.deleteMany()
  await prisma.factorSnapshot.deleteMany({ where: { factorName: FACTOR_NAME } })
  await prisma.factorSnapshotSummary.deleteMany({ where: { factorName: FACTOR_NAME } })
  await prisma.factorDefinition.deleteMany({ where: { name: FACTOR_NAME } })
  await prisma.indexWeight.deleteMany({ where: { indexCode: UNIVERSE_CODE } })
  await prisma.indexDaily.deleteMany({ where: { tsCode: UNIVERSE_CODE } })
  await prisma.daily.deleteMany({ where: { tsCode: { in: ALL_CODES } } })
  await prisma.tradeCal.deleteMany({
    where: { calDate: { in: TRADE_DATES.map((date) => new Date(`${date}T00:00:00.000Z`)) } },
  })
  await prisma.stockBasic.deleteMany({ where: { tsCode: { in: ALL_CODES } } })
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { account: 'legacy_factor_owner' } })
}
