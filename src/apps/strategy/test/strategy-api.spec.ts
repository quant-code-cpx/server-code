/**
 * Strategy 模块 API 测试 — 业务优先
 *
 * 覆盖：策略 CRUD、策略执行、Schema、版本管理、统计
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
import { StrategyController } from '../strategy.controller'
import { StrategyService } from '../strategy.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Strategy API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockStrategyService: Record<string, jest.Mock>

  const user = buildTestUser()
  const sampleStrategy = {
    id: 'strat-1',
    userId: 1,
    name: '均线交叉策略',
    description: '双均线金叉死叉',
    strategyType: 'MA_CROSS_SINGLE',
    strategyConfig: { shortPeriod: 5, longPeriod: 20 },
    backtestDefaults: { initialCapital: 100000 },
    tags: ['趋势', '均线'],
    version: 1,
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(async () => {
    mockStrategyService = {
      create: jest.fn().mockResolvedValue(sampleStrategy),
      list: jest.fn().mockResolvedValue({ strategies: [sampleStrategy], total: 1, page: 1, pageSize: 20 }),
      detail: jest.fn().mockResolvedValue(sampleStrategy),
      update: jest.fn().mockResolvedValue({ ...sampleStrategy, name: '更新后策略', version: 2 }),
      delete: jest.fn().mockResolvedValue(null),
      clone: jest.fn().mockResolvedValue({ ...sampleStrategy, id: 'strat-2', name: '克隆策略' }),
      run: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'QUEUED', strategyId: 'strat-1' }),
      getSchemas: jest.fn().mockResolvedValue({ MA_CROSS_SINGLE: { type: 'object', properties: {} } }),
      listVersions: jest.fn().mockResolvedValue([
        { version: 1, strategyConfig: {}, backtestDefaults: null, changelog: null, createdAt: new Date(), isCurrent: false },
        { version: 2, strategyConfig: {}, backtestDefaults: null, changelog: null, createdAt: new Date(), isCurrent: true },
      ]),
      compareVersions: jest.fn().mockResolvedValue({
        strategyId: 'strat-1',
        versionA: 1,
        versionB: 2,
        configA: { shortPeriod: 5 },
        configB: { shortPeriod: 10 },
        diff: [{ path: 'shortPeriod', oldValue: 5, newValue: 10, changeType: 'CHANGED' }],
        metricsA: null,
        metricsB: null,
      }),
      summary: jest.fn().mockResolvedValue({ byType: { MA_CROSS_SINGLE: 3 }, total: 3, lastBacktest: {} }),
      performance: jest.fn().mockResolvedValue({ items: [{ runId: 'run-1', totalReturn: 0.15 }], total: 1 }),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StrategyController],
      providers: [{ provide: StrategyService, useValue: mockStrategyService }],
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

  // ── 策略 CRUD ──────────────────────────────────────────────────────────────

  describe('策略 CRUD', () => {
    it('S-BIZ-001: 创建策略', async () => {
      const res = await req
        .post('/strategies/create')
        .send({ name: '均线交叉策略', strategyType: 'MA_CROSS_SINGLE', strategyConfig: { shortPeriod: 5, longPeriod: 20 } })
        .expect(201)
      expect(res.body.data.id).toBe('strat-1')
      expect(res.body.data.name).toBe('均线交叉策略')
      expect(res.body.data.strategyType).toBe('MA_CROSS_SINGLE')
    })

    it('S-BIZ-002: 查询策略列表', async () => {
      const res = await req
        .post('/strategies/list')
        .send({})
        .expect(201)
      expect(res.body.data.strategies).toHaveLength(1)
      expect(res.body.data.total).toBe(1)
    })

    it('S-BIZ-003: 查询策略详情', async () => {
      const res = await req
        .post('/strategies/detail')
        .send({ id: 'strat-1' })
        .expect(201)
      expect(res.body.data.id).toBe('strat-1')
      expect(res.body.data.strategyConfig).toHaveProperty('shortPeriod')
    })

    it('S-BIZ-004: 更新策略', async () => {
      await req
        .post('/strategies/update')
        .send({ id: 'strat-1', name: '更新后策略' })
        .expect(201)
      expect(mockStrategyService.update).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'strat-1', name: '更新后策略' }))
    })

    it('S-BIZ-005: 删除策略', async () => {
      await req
        .post('/strategies/delete')
        .send({ id: 'strat-1' })
        .expect(201)
      expect(mockStrategyService.delete).toHaveBeenCalledWith(1, 'strat-1', undefined)
    })

    it('S-BIZ-006: 克隆策略', async () => {
      const res = await req
        .post('/strategies/clone')
        .send({ id: 'strat-1', name: '克隆策略' })
        .expect(201)
      expect(res.body.data.id).toBe('strat-2')
      expect(res.body.data.name).toBe('克隆策略')
    })

    it('S-EDGE-001: 策略名称 1 字符', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'a', strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
        .expect(201)
    })

    it('S-EDGE-002: 策略名称 100 字符', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'a'.repeat(100), strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
        .expect(201)
    })

    it('S-EDGE-003: 策略名称 101 字符应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'a'.repeat(101), strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
        .expect(400)
    })

    it('S-EDGE-004: 策略名称空应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: '', strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
        .expect(400)
    })

    it('S-ERR-001: 创建缺 name 应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} })
        .expect(400)
    })

    it('S-ERR-002: 创建缺 strategyType 应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'test', strategyConfig: {} })
        .expect(400)
    })

    it('S-ERR-003: 创建缺 strategyConfig 应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'test', strategyType: 'MA_CROSS_SINGLE' })
        .expect(400)
    })

    it('S-ERR-004: 无效 strategyType 应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'test', strategyType: 'INVALID_TYPE', strategyConfig: {} })
        .expect(400)
    })

    it('S-ERR-005: strategyConfig 非对象应 400', async () => {
      await req
        .post('/strategies/create')
        .send({ name: 'test', strategyType: 'MA_CROSS_SINGLE', strategyConfig: 'abc' })
        .expect(400)
    })

    it('S-ERR-006: detail 不存在的策略', async () => {
      mockStrategyService.detail.mockResolvedValue(null)
      const res = await req
        .post('/strategies/detail')
        .send({ id: '999999' })
        .expect(201)
      expect(res.body.data).toBeNull()
    })

    it('S-ERR-007: update 不存在的策略', async () => {
      mockStrategyService.update.mockRejectedValue(new Error('策略不存在'))
      await req
        .post('/strategies/update')
        .send({ id: '999999', name: '不存在' })
        .expect(500)
    })

    it('S-ERR-008: delete 不存在的策略', async () => {
      mockStrategyService.delete.mockRejectedValue(new Error('策略不存在'))
      await req
        .post('/strategies/delete')
        .send({ id: '999999' })
        .expect(500)
    })

    it('S-ERR-009: clone 不存在的策略', async () => {
      mockStrategyService.clone.mockRejectedValue(new Error('策略不存在'))
      await req
        .post('/strategies/clone')
        .send({ id: '999999' })
        .expect(500)
    })
  })

  // ── 策略执行 ──────────────────────────────────────────────────────────────

  describe('策略执行', () => {
    it('S-BIZ-007: 发起回测', async () => {
      const res = await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '20260101', endDate: '20260524', initialCapital: 100000 })
        .expect(201)
      expect(res.body.data.runId).toBe('run-1')
      expect(res.body.data.status).toBe('QUEUED')
    })

    it('S-EDGE-007: 初始资金=1000（最小）', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '20260101', endDate: '20260524', initialCapital: 1000 })
        .expect(201)
    })

    it('S-EDGE-008: 初始资金=999 应 400', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '20260101', endDate: '20260524', initialCapital: 999 })
        .expect(400)
    })

    it('S-EDGE-009: 日期格式正确', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '20260101', endDate: '20260524', initialCapital: 10000 })
        .expect(201)
    })

    it('S-EDGE-010: 日期格式错误应 400', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '2026/01/01', endDate: '20260524', initialCapital: 10000 })
        .expect(400)
    })

    it('S-ERR-010: 缺 strategyId 应 400', async () => {
      await req
        .post('/strategies/run')
        .send({ startDate: '20260101', endDate: '20260524', initialCapital: 10000 })
        .expect(400)
    })

    it('S-ERR-011: 缺 startDate 应 400', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', endDate: '20260524', initialCapital: 10000 })
        .expect(400)
    })

    it('S-ERR-012: 缺 initialCapital 应 400', async () => {
      await req
        .post('/strategies/run')
        .send({ strategyId: 'strat-1', startDate: '20260101', endDate: '20260524' })
        .expect(400)
    })
  })

  // ── Schema ─────────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('S-BIZ-008: 获取 schemas', async () => {
      const res = await req
        .post('/strategies/schemas')
        .send({})
        .expect(201)
      expect(res.body.data).toHaveProperty('MA_CROSS_SINGLE')
    })
  })

  // ── 版本管理 ──────────────────────────────────────────────────────────────

  describe('版本管理', () => {
    it('S-BIZ-009: 查询版本列表', async () => {
      const res = await req
        .post('/strategies/versions')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.data[0].version).toBe(1)
      expect(res.body.data[1].version).toBe(2)
    })

    it('S-BIZ-010: 对比版本', async () => {
      const res = await req
        .post('/strategies/compare-versions')
        .send({ strategyId: 'strat-1', versionA: 1, versionB: 2 })
        .expect(201)
      expect(res.body.data.diff).toHaveLength(1)
      expect(res.body.data.diff[0].changeType).toBe('CHANGED')
    })

    it('S-ERR-013: versions 缺 strategyId 应 400', async () => {
      await req
        .post('/strategies/versions')
        .send({})
        .expect(400)
    })

    it('S-ERR-014: compare 缺 versionA 应 400', async () => {
      await req
        .post('/strategies/compare-versions')
        .send({ strategyId: 'strat-1', versionB: 2 })
        .expect(400)
    })
  })

  // ── 统计 ──────────────────────────────────────────────────────────────────

  describe('统计', () => {
    it('S-BIZ-011: 策略汇总', async () => {
      const res = await req
        .post('/strategies/summary')
        .send({})
        .expect(201)
      expect(res.body.data.total).toBe(3)
      expect(res.body.data.byType).toHaveProperty('MA_CROSS_SINGLE')
    })

    it('S-BIZ-012: 查询业绩', async () => {
      const res = await req
        .post('/strategies/performance')
        .send({})
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.items[0].totalReturn).toBe(0.15)
    })

    it('S-BIZ-013: 按策略 ID 过滤业绩', async () => {
      await req
        .post('/strategies/performance')
        .send({ strategyId: 'strat-1' })
        .expect(201)
      expect(mockStrategyService.performance).toHaveBeenCalledWith(1, expect.objectContaining({ strategyId: 'strat-1' }))
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('S-SEC-001: 无 Token 应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [StrategyController],
        providers: [{ provide: StrategyService, useValue: mockStrategyService }],
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
        .post('/strategies/list')
        .expect(401)
      await unauthApp.close()
    })
  })
})
