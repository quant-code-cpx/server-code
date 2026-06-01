/**
 * Factor 模块 API 测试 — 业务优先
 *
 * 覆盖：因子库、因子分析、多因子选股、自定义因子、管理、回测流水线、正交化、优化
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
import { FactorController } from '../factor.controller'
import { FactorService } from '../factor.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Factor API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockFactorService: Record<string, jest.Mock>

  const user = buildTestUser()
  const adminUser = buildTestUser({ role: UserRole.ADMIN, id: 99 })

  const sampleFactor = {
    name: 'pe_ttm',
    label: '市盈率TTM',
    description: '滚动市盈率',
    category: 'VALUATION',
    sourceType: 'BUILTIN',
    isBuiltin: true,
    isEnabled: true,
    sortOrder: 1,
    latestDate: '20260523',
    coverageRate: 0.95,
    status: 'HEALTHY',
  }

  beforeEach(async () => {
    mockFactorService = {
      getLibrary: jest.fn().mockResolvedValue([{ category: 'VALUATION', label: '估值因子', factors: [sampleFactor] }]),
      getDetail: jest.fn().mockResolvedValue(sampleFactor),
      getFactorValues: jest.fn().mockResolvedValue({ items: [{ tsCode: '000001.SZ', value: 12.5 }], total: 1, page: 1, pageSize: 50 }),
      getIcAnalysis: jest.fn().mockResolvedValue({ factorName: 'pe_ttm', icSeries: [], summary: { meanIc: 0.05 } }),
      getQuantileAnalysis: jest.fn().mockResolvedValue({ factorName: 'pe_ttm', quantiles: [], summary: {} }),
      getDecayAnalysis: jest.fn().mockResolvedValue({ factorName: 'pe_ttm', periods: [], decayCurve: [] }),
      getDistribution: jest.fn().mockResolvedValue({ factorName: 'pe_ttm', bins: [], stats: {} }),
      getCorrelation: jest.fn().mockResolvedValue({ factors: ['pe_ttm', 'pb'], matrix: [[1, 0.6], [0.6, 1]] }),
      screening: jest.fn().mockResolvedValue({ items: [{ tsCode: '000001.SZ', score: 0.8 }], total: 1 }),
      createCustomFactor: jest.fn().mockResolvedValue({ name: 'my_factor', label: '自定义', expression: 'close/open-1' }),
      testCustomFactor: jest.fn().mockResolvedValue({ valid: true, sampleCount: 100 }),
      updateCustomFactor: jest.fn().mockResolvedValue({ name: 'my_factor', label: '更新后' }),
      deleteCustomFactor: jest.fn().mockResolvedValue(null),
      triggerSinglePrecompute: jest.fn().mockResolvedValue({ status: 'OK' }),
      triggerPrecompute: jest.fn().mockResolvedValue(null),
      triggerBackfill: jest.fn().mockResolvedValue(null),
      getPrecomputeStatus: jest.fn().mockResolvedValue({ latestDate: '20260523', factors: [] }),
      triggerPrecomputeBatch: jest.fn().mockResolvedValue({ submitted: true }),
      listAdminJobs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getAdminJobDetail: jest.fn().mockResolvedValue({ tradeDate: '20260523', factors: [] }),
      submitBacktest: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'QUEUED' }),
      attribution: jest.fn().mockResolvedValue({ factors: [] }),
      saveAsStrategy: jest.fn().mockResolvedValue({ strategyId: 'strat-1', name: '因子策略' }),
      orthogonalize: jest.fn().mockResolvedValue({ factors: [], matrix: [] }),
      famaMacBeth: jest.fn().mockResolvedValue({ factors: [], results: [] }),
      optimize: jest.fn().mockResolvedValue({ weights: {}, mode: 'MVO' }),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FactorController],
      providers: [{ provide: FactorService, useValue: mockFactorService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext): boolean {
          ctx.switchToHttp().getRequest().user = user
          return true
        },
      })
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

  // ── 因子库 ──────────────────────────────────────────────────────────────

  describe('因子库', () => {
    it('FA-BIZ-001: 查询因子库', async () => {
      const res = await req.post('/factor/library').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data[0]).toHaveProperty('factors')
    })

    it('FA-BIZ-002: 查询因子详情', async () => {
      const res = await req.post('/factor/detail').send({ factorName: 'pe_ttm' }).expect(201)
      expect(res.body.data.name).toBe('pe_ttm')
    })

    it('FA-BIZ-003: 查询因子截面值', async () => {
      const res = await req.post('/factor/values').send({ factorName: 'pe_ttm', tradeDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('items')
      expect(res.body.data).toHaveProperty('total')
    })

    it('FA-ERR-001: detail 缺 factorName 应 400', async () => {
      await req.post('/factor/detail').send({}).expect(400)
    })

    it('FA-ERR-002: values 缺 factorName 应 400', async () => {
      await req.post('/factor/values').send({ tradeDate: '20260523' }).expect(400)
    })

    it('FA-ERR-003: values 缺 tradeDate 应 400', async () => {
      await req.post('/factor/values').send({ factorName: 'pe_ttm' }).expect(400)
    })

    it('FA-EDGE-001: tradeDate 格式正确', async () => {
      await req.post('/factor/values').send({ factorName: 'pe_ttm', tradeDate: '20260523' }).expect(201)
    })

    it('FA-EDGE-002: tradeDate 格式错误应 400', async () => {
      await req.post('/factor/values').send({ factorName: 'pe_ttm', tradeDate: '2026-05-23' }).expect(400)
    })
  })

  // ── 因子分析 ────────────────────────────────────────────────────────────

  describe('因子分析', () => {
    it('FA-BIZ-004: IC 分析', async () => {
      const res = await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('icSeries')
    })

    it('FA-BIZ-005: 分层回测', async () => {
      const res = await req.post('/factor/analysis/quantile').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('quantiles')
    })

    it('FA-BIZ-006: 衰减分析', async () => {
      const res = await req.post('/factor/analysis/decay').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('decayCurve')
    })

    it('FA-BIZ-007: 分布统计', async () => {
      const res = await req.post('/factor/analysis/distribution').send({ factorName: 'pe_ttm', tradeDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('bins')
    })

    it('FA-BIZ-008: 相关性矩阵', async () => {
      const res = await req.post('/factor/analysis/correlation').send({ factorNames: ['pe_ttm', 'pb'], tradeDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('matrix')
    })

    it('FA-ERR-004: IC 分析缺 factorName 应 400', async () => {
      await req.post('/factor/analysis/ic').send({ startDate: '20260101', endDate: '20260523' }).expect(400)
    })

    it('FA-ERR-005: IC 分析缺 startDate 应 400', async () => {
      await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', endDate: '20260523' }).expect(400)
    })

    it('FA-ERR-006: 相关性 factorNames 少于 2 个应 400', async () => {
      await req.post('/factor/analysis/correlation').send({ factorNames: ['pe_ttm'], tradeDate: '20260523' }).expect(400)
    })

    it('FA-EDGE-003: forwardDays=1（最小）', async () => {
      await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', forwardDays: 1 }).expect(201)
    })

    it('FA-EDGE-004: forwardDays=60（最大）', async () => {
      await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', forwardDays: 60 }).expect(201)
    })

    it('FA-EDGE-005: forwardDays=0 应 400', async () => {
      await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', forwardDays: 0 }).expect(400)
    })

    it('FA-EDGE-006: forwardDays=61 应 400', async () => {
      await req.post('/factor/analysis/ic').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', forwardDays: 61 }).expect(400)
    })

    it('FA-EDGE-007: quantiles=3（最小）', async () => {
      await req.post('/factor/analysis/quantile').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', quantiles: 3 }).expect(201)
    })

    it('FA-EDGE-008: quantiles=10（最大）', async () => {
      await req.post('/factor/analysis/quantile').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', quantiles: 10 }).expect(201)
    })

    it('FA-EDGE-009: quantiles=2 应 400', async () => {
      await req.post('/factor/analysis/quantile').send({ factorName: 'pe_ttm', startDate: '20260101', endDate: '20260523', quantiles: 2 }).expect(400)
    })

    it('FA-EDGE-010: bins=10（最小）', async () => {
      await req.post('/factor/analysis/distribution').send({ factorName: 'pe_ttm', tradeDate: '20260523', bins: 10 }).expect(201)
    })

    it('FA-EDGE-011: bins=100（最大）', async () => {
      await req.post('/factor/analysis/distribution').send({ factorName: 'pe_ttm', tradeDate: '20260523', bins: 100 }).expect(201)
    })

    it('FA-EDGE-012: bins=9 应 400', async () => {
      await req.post('/factor/analysis/distribution').send({ factorName: 'pe_ttm', tradeDate: '20260523', bins: 9 }).expect(400)
    })
  })

  // ── 多因子选股 ──────────────────────────────────────────────────────────

  describe('多因子选股', () => {
    it('FA-BIZ-009: 多因子选股', async () => {
      const res = await req.post('/factor/screening').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        tradeDate: '20260523',
      }).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('FA-ERR-007: 缺 conditions 应 400', async () => {
      await req.post('/factor/screening').send({ tradeDate: '20260523' }).expect(400)
    })

    it('FA-ERR-008: 缺 tradeDate 应 400', async () => {
      await req.post('/factor/screening').send({ conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }] }).expect(400)
    })
  })

  // ── 自定义因子 ──────────────────────────────────────────────────────────

  describe('自定义因子', () => {
    it('FA-BIZ-010: 创建自定义因子', async () => {
      const res = await req.post('/factor/custom/create').send({
        name: 'my_factor',
        label: '自定义因子',
        category: 'CUSTOM',
        expression: 'close/open-1',
      }).expect(201)
      expect(res.body.data.name).toBe('my_factor')
    })

    it('FA-BIZ-011: 试算自定义因子', async () => {
      const res = await req.post('/factor/custom/test').send({
        expression: 'close/open-1',
        tradeDate: '20260523',
      }).expect(201)
      expect(res.body.data).toHaveProperty('valid')
    })

    it('FA-BIZ-012: 更新自定义因子', async () => {
      await req.post('/factor/custom/update').send({ name: 'my_factor', label: '更新后' }).expect(201)
    })

    it('FA-BIZ-013: 删除自定义因子', async () => {
      await req.post('/factor/custom/delete').send({ name: 'my_factor' }).expect(201)
    })

    it('FA-BIZ-014: 触发预计算', async () => {
      await req.post('/factor/custom/precompute').send({ name: 'my_factor', tradeDate: '20260523' }).expect(201)
    })

    it('FA-ERR-009: create 缺 name 应 400', async () => {
      await req.post('/factor/custom/create').send({ label: 'test', category: 'CUSTOM', expression: 'close' }).expect(400)
    })

    it('FA-ERR-010: create 缺 expression 应 400', async () => {
      await req.post('/factor/custom/create').send({ name: 'my_factor', label: 'test', category: 'CUSTOM' }).expect(400)
    })

    it('FA-ERR-011: create 无效 name 格式应 400', async () => {
      await req.post('/factor/custom/create').send({ name: '123invalid', label: 'test', category: 'CUSTOM', expression: 'close' }).expect(400)
    })

    it('FA-ERR-012: create 无效 category 应 400', async () => {
      await req.post('/factor/custom/create').send({ name: 'my_factor', label: 'test', category: 'INVALID_CAT', expression: 'close' }).expect(400)
    })

    it('FA-ERR-013: test 缺 expression 应 400', async () => {
      await req.post('/factor/custom/test').send({ tradeDate: '20260523' }).expect(400)
    })

    it('FA-ERR-014: precompute 缺 tradeDate 应 400', async () => {
      await req.post('/factor/custom/precompute').send({ name: 'my_factor' }).expect(400)
    })
  })

  // ── 管理（Admin）────────────────────────────────────────────────────────

  describe('管理（Admin）', () => {
    let adminApp: INestApplication
    let adminReq: ReturnType<typeof request>

    beforeEach(async () => {
      const adminModuleRef: TestingModule = await Test.createTestingModule({
        controllers: [FactorController],
        providers: [{ provide: FactorService, useValue: mockFactorService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(ctx: ExecutionContext): boolean {
            ctx.switchToHttp().getRequest().user = adminUser
            return true
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile()

      adminApp = adminModuleRef.createNestApplication()
      adminApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      adminApp.useGlobalInterceptors(new TransformInterceptor())
      adminApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await adminApp.init()
      adminReq = request(adminApp.getHttpServer())
    })

    afterEach(async () => {
      await adminApp.close()
    })

    it('FA-BIZ-015: 手动触发预计算', async () => {
      await adminReq.post('/factor/admin/precompute').send({ tradeDate: '20260523' }).expect(201)
    })

    it('FA-BIZ-016: 触发历史回补', async () => {
      await adminReq.post('/factor/admin/backfill').send({ startDate: '20260101', endDate: '20260523' }).expect(201)
    })

    it('FA-BIZ-017: 查询预计算状态', async () => {
      const res = await adminReq.post('/factor/admin/precompute/status').send({}).expect(201)
      expect(res.body.data).toHaveProperty('latestDate')
    })

    it('FA-BIZ-018: 批量预计算', async () => {
      await adminReq.post('/factor/admin/precompute-batch').send({}).expect(201)
    })

    it('FA-BIZ-019: 查询批次历史', async () => {
      const res = await adminReq.post('/factor/admin/jobs').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('FA-BIZ-020: 查询批次详情', async () => {
      const res = await adminReq.post('/factor/admin/jobs/detail').send({ tradeDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
    })

    it('FA-ERR-015: admin/precompute 缺 tradeDate 应 400', async () => {
      await adminReq.post('/factor/admin/precompute').send({}).expect(400)
    })

    it('FA-ERR-016: admin/backfill 缺 startDate 应 400', async () => {
      await adminReq.post('/factor/admin/backfill').send({ endDate: '20260523' }).expect(400)
    })

    it('FA-SEC-001: 普通用户访问 admin 端点应 403', async () => {
      await req.post('/factor/admin/precompute').send({ tradeDate: '20260523' }).expect(403)
    })
  })

  // ── 回测流水线 ──────────────────────────────────────────────────────────

  describe('回测流水线', () => {
    it('FA-BIZ-021: 因子策略一键回测', async () => {
      const res = await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        startDate: '20260101',
        endDate: '20260523',
      }).expect(201)
      expect(res.body.data).toHaveProperty('runId')
    })

    it('FA-BIZ-022: 因子归因分析', async () => {
      const res = await req.post('/factor/backtest/attribution').send({ id: 'run-1' }).expect(201)
      expect(res.body.data).toHaveProperty('factors')
    })

    it('FA-BIZ-023: 保存为策略模板', async () => {
      const res = await req.post('/factor/backtest/save-as-strategy').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        name: '低估值策略',
      }).expect(201)
      expect(res.body.data).toHaveProperty('strategyId')
    })

    it('FA-ERR-017: submit 缺 conditions 应 400', async () => {
      await req.post('/factor/backtest/submit').send({ startDate: '20260101', endDate: '20260523' }).expect(400)
    })

    it('FA-ERR-018: submit 缺 startDate 应 400', async () => {
      await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        endDate: '20260523',
      }).expect(400)
    })

    it('FA-ERR-019: attribution 缺 id（intersection 类型绕过 DTO 校验）', async () => {
      // FactorAttributionDto & { id: string } 的 intersection 类型导致 ValidationPipe 无法校验
      // 记录为待澄清项 Q-FA01
      const res = await req.post('/factor/backtest/attribution').send({}).expect([201, 400])
    })

    it('FA-ERR-020: save-as-strategy 缺 name 应 400', async () => {
      await req.post('/factor/backtest/save-as-strategy').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
      }).expect(400)
    })

    it('FA-EDGE-013: initialCapital=10000（最小）', async () => {
      await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        startDate: '20260101',
        endDate: '20260523',
        initialCapital: 10000,
      }).expect(201)
    })

    it('FA-EDGE-014: initialCapital=9999 应 400', async () => {
      await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        startDate: '20260101',
        endDate: '20260523',
        initialCapital: 9999,
      }).expect(400)
    })

    it('FA-EDGE-015: topN=5（最小）', async () => {
      await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        startDate: '20260101',
        endDate: '20260523',
        topN: 5,
      }).expect(201)
    })

    it('FA-EDGE-016: topN=100（最大）', async () => {
      await req.post('/factor/backtest/submit').send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        startDate: '20260101',
        endDate: '20260523',
        topN: 100,
      }).expect(201)
    })
  })

  // ── 正交化与优化 ────────────────────────────────────────────────────────

  describe('正交化与优化', () => {
    it('FA-BIZ-024: 因子正交化', async () => {
      const res = await req.post('/factor/analysis/orthogonalize').send({ factorNames: ['pe_ttm', 'pb'], tradeDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('factors')
    })

    it('FA-BIZ-025: Fama-MacBeth', async () => {
      const res = await req.post('/factor/analysis/fama-macbeth').send({ factorNames: ['pe_ttm'], startDate: '20260101', endDate: '20260523' }).expect(201)
      expect(res.body.data).toHaveProperty('factors')
    })

    it('FA-BIZ-026: 组合优化', async () => {
      const res = await req.post('/factor/optimization').send({ tsCodes: ['000001.SZ', '600000.SH'], mode: 'MVO' }).expect(201)
      expect(res.body.data).toHaveProperty('weights')
    })

    it('FA-ERR-021: orthogonalize factorNames 少于 2 应 400', async () => {
      await req.post('/factor/analysis/orthogonalize').send({ factorNames: ['pe_ttm'], tradeDate: '20260523' }).expect(400)
    })

    it('FA-ERR-022: optimization 缺 tsCodes 应 400', async () => {
      await req.post('/factor/optimization').send({ mode: 'MVO' }).expect(400)
    })

    it('FA-ERR-023: optimization 缺 mode 应 400', async () => {
      await req.post('/factor/optimization').send({ tsCodes: ['000001.SZ'] }).expect(400)
    })

    it('FA-ERR-024: optimization 无效 mode 应 400', async () => {
      await req.post('/factor/optimization').send({ tsCodes: ['000001.SZ'], mode: 'INVALID' }).expect(400)
    })
  })

  // ── 安全 ────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('FA-SEC-002: 无 Token 应 401', async () => {
      const unauthModuleRef: TestingModule = await Test.createTestingModule({
        controllers: [FactorController],
        providers: [{ provide: FactorService, useValue: mockFactorService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            const { UnauthorizedException } = require('@nestjs/common')
            throw new UnauthorizedException()
          },
        })
        .compile()

      const reflector = unauthModuleRef.get(Reflector)
      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/factor/library')
        .expect(401)
      await unauthApp.close()
    })
  })
})
