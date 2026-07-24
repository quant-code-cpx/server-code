import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { PriceAlertRuleStatus, StockExchange, StockListStatus, UserRole, UserStatus } from '@prisma/client'
import type { RedisClientType } from 'redis'
import request from 'supertest'

import { AlertCalendarService } from 'src/apps/alert/alert-calendar.service'
import { AlertController } from 'src/apps/alert/alert.controller'
import { AlertLimitService } from 'src/apps/alert/alert-limit.service'
import { MarketAnomalyService } from 'src/apps/alert/market-anomaly.service'
import { PriceAlertService } from 'src/apps/alert/price-alert.service'
import { AuthModule } from 'src/apps/auth/auth.module'
import { BacktestDataService } from 'src/apps/backtest/services/backtest-data.service'
import { BacktestStrategyRegistryService } from 'src/apps/backtest/services/backtest-strategy-registry.service'
import { NotificationService } from 'src/apps/notification/notification.service'
import { SignalGenerationService } from 'src/apps/signal/signal-generation.service'
import { SignalController } from 'src/apps/signal/signal.controller'
import { SignalService } from 'src/apps/signal/signal.service'
import { TokenService } from 'src/shared/token.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'

const TRADE_DATE = '20260720'
const NEXT_TRADE_DATE = '20260721'
const TS_CODE = '000001.SZ'
const USER_ACCOUNT = 'legacy_alert_signal_user'
const ADMIN_ACCOUNT = 'legacy_alert_signal_admin'

describe('旧业务 E2E Flow 6 — 预警与信号', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType
  let userToken: string
  let adminToken: string
  let strategyId: string
  let activationId: string
  let ruleId: number
  let idempotencyRuleId: number

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({
      imports: [AuthModule],
      controllers: [AlertController, SignalController],
      providers: [
        PriceAlertService,
        SignalService,
        SignalGenerationService,
        BacktestStrategyRegistryService,
        BacktestDataService,
        { provide: EventsGateway, useValue: { emitToUser: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: AlertCalendarService, useValue: {} },
        { provide: MarketAnomalyService, useValue: {} },
        { provide: AlertLimitService, useValue: {} },
      ],
    })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis

    await cleanAlertSignalFixture(prisma)
    await redis.flushDb()

    const [user, admin] = await Promise.all([
      prisma.user.create({
        data: {
          account: USER_ACCOUNT,
          password: 'unused',
          nickname: 'Alert Signal Owner',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
        },
      }),
      prisma.user.create({
        data: {
          account: ADMIN_ACCOUNT,
          password: 'unused',
          nickname: 'Alert Signal Admin',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        },
      }),
    ])

    const tokenService = app.get(TokenService)
    userToken = await tokenService.generateAccessToken({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
      role: user.role,
    })
    adminToken = await tokenService.generateAccessToken({
      id: admin.id,
      account: admin.account,
      nickname: admin.nickname,
      role: admin.role,
    })

    await seedAlertSignalFixture(prisma, user.id)
    strategyId = (await prisma.strategy.findFirstOrThrow({ where: { userId: user.id, name: '预警信号 E2E 固定策略' } }))
      .id
  })

  afterAll(async () => {
    if (prisma) await cleanAlertSignalFixture(prisma)
    if (redis) await redis.flushDb()
    if (app) await app.close()
  })

  it('LEG-AS-BIZ-001：创建价格规则→管理员扫描→历史，固定收盘价越阈值恰好触发一次', async () => {
    const created = await postAsUser('/api/alert/price-rules', {
      tsCode: TS_CODE,
      ruleType: 'PRICE_ABOVE',
      threshold: 10,
    })
    ruleId = created.body.data.id as number
    expect(created.body.data).toMatchObject({
      id: ruleId,
      tsCode: TS_CODE,
      threshold: 10,
      status: PriceAlertRuleStatus.ACTIVE,
    })

    const activated = await postAsUser('/api/signal/strategies/activate', {
      strategyId,
      universe: 'ALL_A',
      lookbackDays: 60,
    })
    activationId = activated.body.data.id as string
    expect(activated.body.data).toMatchObject({
      id: activationId,
      strategyId,
      isActive: true,
      universe: 'ALL_A',
      lookbackDays: 60,
    })

    const scan = await postAsAdmin('/api/alert/price-rules/scan', {})
    expect(scan.body.data).toEqual({ triggered: 1 })

    const history = await postAsUser('/api/alert/price-rules/history/list', { ruleId })
    expect(history.body.data).toMatchObject({
      total: 1,
      items: [
        {
          ruleId,
          tsCode: TS_CODE,
          ruleType: 'PRICE_ABOVE',
          threshold: 10,
          actualValue: 11,
          closePrice: 11,
          tradeDate: TRADE_DATE,
        },
      ],
    })
    expect(await prisma.priceAlertRule.findUniqueOrThrow({ where: { id: ruleId } })).toMatchObject({
      triggerCount: 1,
    })
  })

  it('LEG-AS-REG-001：信号业务日期按 Asia/Shanghai 日历日保存和查询，不落到 UTC 前一日', async () => {
    await app.get(SignalGenerationService).generateAllSignals(TRADE_DATE)

    const signals = await prisma.tradingSignal.findMany({ where: { activationId } })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      strategyId,
      userId: expect.any(Number),
      tsCode: TS_CODE,
      action: 'BUY',
      targetWeight: 1,
    })
    expect(signals[0].tradeDate.toISOString()).toBe('2026-07-20T00:00:00.000Z')

    const activation = await prisma.signalActivation.findUniqueOrThrow({ where: { id: activationId } })
    expect(activation.lastSignalDate?.toISOString()).toBe('2026-07-20T00:00:00.000Z')

    const latest = await postAsUser('/api/signal/latest', { strategyId, tradeDate: TRADE_DATE })
    expect(latest.body.data).toHaveLength(1)
    expect(latest.body.data[0]).toMatchObject({
      strategyId,
      tradeDate: TRADE_DATE,
      signals: [{ tsCode: TS_CODE, action: 'BUY', targetWeight: 1, tradeDate: TRADE_DATE }],
      aggregateStats: { total: 1, buyCount: 1, sellCount: 0, holdCount: 0 },
    })
  })

  it('LEG-AS-DATA-001：同规则/股票/交易日并发重复扫描与重复信号生成保持幂等', async () => {
    const created = await postAsUser('/api/alert/price-rules', {
      tsCode: TS_CODE,
      ruleType: 'PRICE_ABOVE',
      threshold: 10,
      memo: '并发幂等规则',
    })
    idempotencyRuleId = created.body.data.id as number

    const scans = await Promise.all([
      postAsAdmin('/api/alert/price-rules/scan', {}),
      postAsAdmin('/api/alert/price-rules/scan', {}),
    ])
    expect(scans.reduce((sum, response) => sum + response.body.data.triggered, 0)).toBe(1)

    await Promise.all([
      app.get(SignalGenerationService).generateAllSignals(TRADE_DATE),
      app.get(SignalGenerationService).generateAllSignals(TRADE_DATE),
    ])

    expect(await prisma.priceAlertTriggerHistory.count({ where: { ruleId: idempotencyRuleId } })).toBe(1)
    expect(await prisma.priceAlertRule.findUniqueOrThrow({ where: { id: idempotencyRuleId } })).toMatchObject({
      triggerCount: 1,
    })
    expect(await prisma.priceAlertTriggerHistory.count({ where: { ruleId } })).toBe(1)
    expect(await prisma.priceAlertRule.findUniqueOrThrow({ where: { id: ruleId } })).toMatchObject({
      triggerCount: 1,
    })
    expect(await prisma.tradingSignal.count({ where: { activationId, tradeDate: utcDate(TRADE_DATE) } })).toBe(1)
  })

  it('LEG-AS-SEC-001：普通用户调用管理员扫描返回 403，预警与信号事实不变', async () => {
    await seedNextTradeDate(prisma)
    const before = await factCounts(prisma)

    await request(app.getHttpServer())
      .post('/api/alert/price-rules/scan')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(403)

    expect(await factCounts(prisma)).toEqual(before)
  })

  it('LEG-AS-BIZ-002：禁用规则和信号策略后，新交易日扫描不新增事实', async () => {
    await Promise.all(
      [ruleId, idempotencyRuleId].map((id) =>
        postAsUser('/api/alert/price-rules/update', { id, status: PriceAlertRuleStatus.PAUSED }),
      ),
    )
    const deactivated = await postAsUser('/api/signal/strategies/deactivate', { strategyId })
    expect(deactivated.body.data).toMatchObject({ strategyId, isActive: false })

    const before = await factCounts(prisma)
    const scan = await postAsAdmin('/api/alert/price-rules/scan', {})
    expect(scan.body.data).toEqual({ triggered: 0 })
    await app.get(SignalGenerationService).generateAllSignals(NEXT_TRADE_DATE)

    expect(await factCounts(prisma)).toEqual(before)
    expect(await prisma.tradingSignal.count({ where: { tradeDate: utcDate(NEXT_TRADE_DATE) } })).toBe(0)
  })

  function postAsUser(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${userToken}`).send(body).expect(201)
  }

  function postAsAdmin(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${adminToken}`).send(body).expect(201)
  }
})

async function seedAlertSignalFixture(prisma: PrismaService, userId: number): Promise<void> {
  await prisma.stockBasic.create({
    data: {
      tsCode: TS_CODE,
      symbol: '000001',
      name: '平安银行',
      exchange: StockExchange.SZSE,
      listStatus: StockListStatus.L,
      listDate: new Date('1991-04-03T00:00:00.000Z'),
    },
  })
  await prisma.tradeCal.create({
    data: { exchange: StockExchange.SSE, calDate: utcDate(TRADE_DATE), isOpen: '1' },
  })
  await prisma.daily.create({
    data: {
      tsCode: TS_CODE,
      tradeDate: utcDate(TRADE_DATE),
      open: 10.5,
      high: 11.2,
      low: 10.4,
      close: 11,
      preClose: 10,
      pctChg: 10,
      vol: 1_000_000,
    },
  })
  await prisma.strategy.create({
    data: {
      userId,
      name: '预警信号 E2E 固定策略',
      strategyType: 'CUSTOM_POOL_REBALANCE',
      strategyConfig: { tsCodes: [TS_CODE], weightMode: 'EQUAL' },
      backtestDefaults: { minDaysListed: 60 },
      tags: ['legacy-e2e'],
    },
  })
}

async function seedNextTradeDate(prisma: PrismaService): Promise<void> {
  await prisma.tradeCal.create({
    data: { exchange: StockExchange.SSE, calDate: utcDate(NEXT_TRADE_DATE), isOpen: '1' },
  })
  await prisma.daily.create({
    data: {
      tsCode: TS_CODE,
      tradeDate: utcDate(NEXT_TRADE_DATE),
      open: 11,
      high: 12,
      low: 10.8,
      close: 11.5,
      preClose: 11,
      pctChg: 4.55,
      vol: 1_100_000,
    },
  })
}

async function factCounts(prisma: PrismaService): Promise<number[]> {
  return Promise.all([
    prisma.priceAlertTriggerHistory.count(),
    prisma.priceAlertRule.aggregate({ _sum: { triggerCount: true } }).then((result) => result._sum.triggerCount ?? 0),
    prisma.tradingSignal.count(),
  ])
}

async function cleanAlertSignalFixture(prisma: PrismaService): Promise<void> {
  await prisma.tradingSignal.deleteMany()
  await prisma.signalActivation.deleteMany()
  await prisma.priceAlertTriggerHistory.deleteMany()
  await prisma.priceAlertRule.deleteMany()
  await prisma.strategy.deleteMany({ where: { name: '预警信号 E2E 固定策略' } })
  await prisma.daily.deleteMany({ where: { tsCode: TS_CODE } })
  await prisma.tradeCal.deleteMany({
    where: { calDate: { in: [utcDate(TRADE_DATE), utcDate(NEXT_TRADE_DATE)] } },
  })
  await prisma.stockBasic.deleteMany({ where: { tsCode: TS_CODE } })
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { account: { in: [USER_ACCOUNT, ADMIN_ACCOUNT] } } })
}

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`)
}
