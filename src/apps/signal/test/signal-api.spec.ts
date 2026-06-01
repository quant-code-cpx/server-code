/**
 * Signal 模块 API 测试 — 业务优先
 *
 * 覆盖：策略激活（activate/deactivate/list）、信号查询（latest/history/compare）
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { SignalController } from '../signal.controller'
import { SignalService } from '../signal.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Signal API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockSignalService: Record<string, jest.Mock>

  const user = buildTestUser()

  const sampleActivation = {
    id: 'act-1',
    strategyId: 'strat-1',
    strategyName: '均线交叉策略',
    portfolioId: null,
    isActive: true,
    universe: 'ALL_A',
    benchmarkTsCode: '000300.SH',
    lookbackDays: 250,
    alertThreshold: 0.3,
    lastSignalDate: '20260523',
    createdAt: '2026-05-20T00:00:00Z',
    updatedAt: '2026-05-24T00:00:00Z',
  }

  const sampleLatestResponse = {
    strategyId: 'strat-1',
    strategyName: '均线交叉策略',
    tradeDate: '20260523',
    signals: [
      { tsCode: '000001.SZ', stockName: '平安银行', action: 'BUY', targetWeight: 0.05, confidence: 0.8, tradeDate: '20260523', strategyId: 'strat-1', forwardReturn: null, excessReturn: null, isFirstOccurrence: true },
    ],
    aggregateStats: { total: 1, buyCount: 1, sellCount: 0, holdCount: 0, avgConfidence: 0.8, avgForwardReturn: null, avgExcessReturn: null },
    generatedAt: '2026-05-23T15:00:00Z',
    status: 'OK',
    lastRunAt: '2026-05-23T15:00:00Z',
  }

  const sampleHistoryResponse = {
    strategyId: 'strat-1',
    total: 2,
    page: 1,
    pageSize: 20,
    groups: [
      {
        tradeDate: '20260523',
        signalCount: 1,
        signals: [{ tsCode: '000001.SZ', stockName: '平安银行', action: 'BUY', targetWeight: 0.05, confidence: 0.8 }],
        aggregateStats: { total: 1, buyCount: 1, sellCount: 0, holdCount: 0, avgConfidence: 0.8, avgForwardReturn: null, avgExcessReturn: null },
      },
    ],
    aggregateStats: { total: 1, buyCount: 1, sellCount: 0, holdCount: 0, avgConfidence: 0.8, avgForwardReturn: null, avgExcessReturn: null },
  }

  beforeEach(async () => {
    mockSignalService = {
      activate: jest.fn().mockResolvedValue(sampleActivation),
      deactivate: jest.fn().mockResolvedValue({ ...sampleActivation, isActive: false }),
      listActivations: jest.fn().mockResolvedValue([sampleActivation]),
      getLatestSignals: jest.fn().mockResolvedValue([sampleLatestResponse]),
      getSignalHistory: jest.fn().mockResolvedValue(sampleHistoryResponse),
      compareHistories: jest.fn().mockResolvedValue([
        { strategyId: 'strat-1', strategyName: '策略A', summary: { total: 10, buyCount: 4, sellCount: 3, holdCount: 3, avgConfidence: 0.7 } },
        { strategyId: 'strat-2', strategyName: '策略B', summary: { total: 8, buyCount: 3, sellCount: 2, holdCount: 3, avgConfidence: 0.6 } },
      ]),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SignalController],
      providers: [{ provide: SignalService, useValue: mockSignalService }],
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

  // ── 策略激活 ──────────────────────────────────────────────────────────────

  describe('策略激活', () => {
    it('SG-BIZ-001: 激活策略', async () => {
      const res = await req
        .post('/signal/strategies/activate')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(res.body.data.id).toBe('act-1')
      expect(res.body.data.isActive).toBe(true)
      expect(res.body.data.strategyId).toBe('strat-1')
    })

    it('SG-BIZ-002: 停用策略', async () => {
      const res = await req
        .post('/signal/strategies/deactivate')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(res.body.data.isActive).toBe(false)
    })

    it('SG-BIZ-003: 查询激活列表', async () => {
      const res = await req
        .post('/signal/strategies/list')
        .send({})
        .expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].strategyId).toBe('strat-1')
    })

    it('SG-ERR-001: activate 缺 strategyId 应 400', async () => {
      await req
        .post('/signal/strategies/activate')
        .send({})
        .expect(400)
    })

    it('SG-ERR-002: deactivate 缺 strategyId 应 400', async () => {
      await req
        .post('/signal/strategies/deactivate')
        .send({})
        .expect(400)
    })
  })

  // ── 信号查询 ──────────────────────────────────────────────────────────────

  describe('信号查询', () => {
    it('SG-BIZ-004: 查询最新信号', async () => {
      const res = await req
        .post('/signal/latest')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data[0]).toHaveProperty('signals')
      expect(res.body.data[0]).toHaveProperty('aggregateStats')
      expect(res.body.data[0].strategyId).toBe('strat-1')
    })

    it('SG-BIZ-005: 查询信号历史', async () => {
      const res = await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(res.body.data).toHaveProperty('groups')
      expect(res.body.data).toHaveProperty('total')
      expect(res.body.data.strategyId).toBe('strat-1')
    })

    it('SG-BIZ-006: 多策略信号对比', async () => {
      const res = await req
        .post('/signal/history/compare')
        .send({ strategyIds: ['strat-1', 'strat-2'] })
        .expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(2)
    })

    it('SG-EDGE-001: tradeDate 格式正确', async () => {
      await req
        .post('/signal/latest')
        .send({ tradeDate: '20260523' })
        .expect(201)
    })

    it('SG-EDGE-002: tradeDate 格式错误应 400', async () => {
      await req
        .post('/signal/latest')
        .send({ tradeDate: '2026-05-23' })
        .expect(400)
    })

    it('SG-EDGE-003: alertThreshold=0（最小）应 201', async () => {
      await req
        .post('/signal/strategies/activate')
        .send({ strategyId: 'strat-1', alertThreshold: 0 })
        .expect(201)
    })

    it('SG-EDGE-004: alertThreshold=1（最大）应 201', async () => {
      await req
        .post('/signal/strategies/activate')
        .send({ strategyId: 'strat-1', alertThreshold: 1 })
        .expect(201)
    })

    it('SG-EDGE-005: alertThreshold=-0.1 应 400', async () => {
      await req
        .post('/signal/strategies/activate')
        .send({ strategyId: 'strat-1', alertThreshold: -0.1 })
        .expect(400)
    })

    it('SG-EDGE-006: alertThreshold=1.1 应 400', async () => {
      await req
        .post('/signal/strategies/activate')
        .send({ strategyId: 'strat-1', alertThreshold: 1.1 })
        .expect(400)
    })

    it('SG-EDGE-007: forwardWindow=1（最小）应 201', async () => {
      await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1', forwardWindow: 1 })
        .expect(201)
    })

    it('SG-EDGE-008: forwardWindow=60（最大）应 201', async () => {
      await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1', forwardWindow: 60 })
        .expect(201)
    })

    it('SG-EDGE-009: forwardWindow=0 应 400', async () => {
      await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1', forwardWindow: 0 })
        .expect(400)
    })

    it('SG-EDGE-010: forwardWindow=61 应 400', async () => {
      await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1', forwardWindow: 61 })
        .expect(400)
    })

    it('SG-ERR-003: history 缺 strategyId 应 400', async () => {
      await req
        .post('/signal/history')
        .send({})
        .expect(400)
    })

    it('SG-ERR-004: 无效 action 应 400', async () => {
      await req
        .post('/signal/history')
        .send({ strategyId: 'strat-1', actions: ['INVALID'] })
        .expect(400)
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('SG-SEC-001: 无 Token 应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [SignalController],
        providers: [{ provide: SignalService, useValue: mockSignalService }],
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
        .post('/signal/latest')
        .expect(401)
      await unauthApp.close()
    })
  })
})
