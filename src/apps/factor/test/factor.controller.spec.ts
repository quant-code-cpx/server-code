import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { Reflector } from '@nestjs/core'
import { FactorController } from '../factor.controller'
import { FactorService } from '../factor.service'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { LoggerService } from 'src/shared/logger/logger.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
const adminUser = { id: 2, account: 'admin', nickname: 'Admin', role: UserRole.ADMIN, jti: 'jti-2' }

const SUCCESS_CODE = 0

/** Default mock RolesGuard: allows all requests */
const mockRolesGuard = { canActivate: jest.fn(() => true) }

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
}

const mockFactorService = {
  getLibrary: jest.fn(),
  getDetail: jest.fn(),
  getFactorValues: jest.fn(),
  getIcAnalysis: jest.fn(),
  getQuantileAnalysis: jest.fn(),
  getDecayAnalysis: jest.fn(),
  getDistribution: jest.fn(),
  getCorrelation: jest.fn(),
  screening: jest.fn(),
  createCustomFactor: jest.fn(),
  testCustomFactor: jest.fn(),
  updateCustomFactor: jest.fn(),
  deleteCustomFactor: jest.fn(),
  triggerSinglePrecompute: jest.fn(),
  triggerPrecompute: jest.fn(),
  triggerBackfill: jest.fn(),
  getPrecomputeStatus: jest.fn(),
  submitBacktest: jest.fn(),
  attribution: jest.fn(),
  orthogonalize: jest.fn(),
  famaMacBeth: jest.fn(),
  triggerPrecomputeBatch: jest.fn(),
  listAdminJobs: jest.fn(),
  getAdminJobDetail: jest.fn(),
  saveAsStrategy: jest.fn(),
  optimize: jest.fn(),
}

// ── 基础 Controller 测试（保留原有测试结构）─────────────────────────────────

describe('FactorController', () => {
  let app: INestApplication
  let mockJwtGuard: { canActivate: jest.Mock }

  beforeEach(async () => {
    // 每个测试重新创建 app 以避免状态泄漏
    jest.clearAllMocks()

    mockJwtGuard = {
      canActivate: jest.fn((context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest()
        req.user = testUser
        return true
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FactorController],
      providers: [
        { provide: FactorService, useValue: mockFactorService },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
  })

  afterEach(async () => app.close())

  // ── 原有 BIZ 冒烟测试 ─────────────────────────────────────────────────────

  it('POST /factor/library → 201, data is array', async () => {
    const mockLibrary = [{ category: 'MOMENTUM', factors: [] }]
    mockFactorService.getLibrary.mockResolvedValueOnce(mockLibrary)

    await request(app.getHttpServer())
      .post('/factor/library')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(Array.isArray(res.body.data)).toBe(true)
      })
  })

  it('POST /factor/values → 201', async () => {
    const mockValues = { tradeDate: '20231201', factors: [] }
    mockFactorService.getFactorValues.mockResolvedValueOnce(mockValues)

    await request(app.getHttpServer())
      .post('/factor/values')
      .send({ factorName: 'pe_ttm', tradeDate: '20231201' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/analysis/ic → 201', async () => {
    const mockIc = { series: [], icMean: 0.05 }
    mockFactorService.getIcAnalysis.mockResolvedValueOnce(mockIc)

    await request(app.getHttpServer())
      .post('/factor/analysis/ic')
      .send({ factorName: 'pe_ttm', startDate: '20230101', endDate: '20231231' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/screening → 201', async () => {
    const mockResult = { stocks: [], total: 0 }
    mockFactorService.screening.mockResolvedValueOnce(mockResult)

    await request(app.getHttpServer())
      .post('/factor/screening')
      .send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        tradeDate: '20231201',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/detail → 201', async () => {
    const mockDetail = { factorName: 'pe_ttm', description: 'PE TTM' }
    mockFactorService.getDetail.mockResolvedValueOnce(mockDetail)

    await request(app.getHttpServer())
      .post('/factor/detail')
      .send({ factorName: 'pe_ttm' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  // ── 原有 VAL/ERR/AUTH 测试 ────────────────────────────────────────────────

  it('[VAL] POST /factor/values 缺 factorName → 400', async () => {
    await request(app.getHttpServer()).post('/factor/values').send({ tradeDate: '20231201' }).expect(400)
    expect(mockFactorService.getFactorValues).not.toHaveBeenCalled()
  })

  it('[VAL] POST /factor/values tradeDate 含横线格式 → 400', async () => {
    await request(app.getHttpServer())
      .post('/factor/values')
      .send({ factorName: 'pe_ttm', tradeDate: '2023-12-01' })
      .expect(400)
    expect(mockFactorService.getFactorValues).not.toHaveBeenCalled()
  })

  it('[VAL] POST /factor/screening 缺 conditions → 400', async () => {
    await request(app.getHttpServer()).post('/factor/screening').send({ tradeDate: '20231201' }).expect(400)
    expect(mockFactorService.screening).not.toHaveBeenCalled()
  })

  it('[ERR] POST /factor/detail NotFoundException → 404', async () => {
    mockFactorService.getDetail.mockRejectedValueOnce(new NotFoundException('factor not found'))
    await request(app.getHttpServer()).post('/factor/detail').send({ factorName: 'unknown_factor' }).expect(404)
    expect(mockFactorService.getDetail).toHaveBeenCalledTimes(1)
  })

  it('[AUTH] 未认证请求 → 401', async () => {
    mockJwtGuard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException()
    })
    await request(app.getHttpServer()).post('/factor/library').send({}).expect(401)
    expect(mockFactorService.getLibrary).not.toHaveBeenCalled()
  })

  // ── FAC-ERR: DTO 校验 — 必填字段 ────────────────────────────────────────

  describe('[DTO 校验] 必填字段', () => {
    it('fac-err-001: /factor/detail 缺 factorName → 400', async () => {
      await request(app.getHttpServer()).post('/factor/detail').send({}).expect(400)
      expect(mockFactorService.getDetail).not.toHaveBeenCalled()
    })

    it('fac-err-002: /factor/detail factorName 为空字符串 → 400', async () => {
      await request(app.getHttpServer()).post('/factor/detail').send({ factorName: '' }).expect(400)
      expect(mockFactorService.getDetail).not.toHaveBeenCalled()
    })

    it('fac-err-003: /factor/analysis/ic 缺 endDate → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/ic')
        .send({ factorName: 'pe_ttm', startDate: '20240101' })
        .expect(400)
    })

    it('fac-err-004: /factor/analysis/correlation 缺 factorNames → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/correlation')
        .send({ tradeDate: '20240101' })
        .expect(400)
    })

    it('fac-err-005: /factor/custom/create 缺 name → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ label: 'test', category: 'TECHNICAL', expression: 'close' })
        .expect(400)
    })

    it('fac-err-006: /factor/custom/create 缺 expression → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ name: 'my_factor', label: 'test', category: 'TECHNICAL' })
        .expect(400)
    })

    it('fac-err-007: /factor/custom/create label 为空 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ name: 'my_factor', label: '', category: 'TECHNICAL', expression: 'close' })
        .expect(400)
    })

    it('fac-err-008: /factor/backtest/submit 缺 endDate → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({ conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }], startDate: '20240101' })
        .expect(400)
    })

    it('fac-err-009: /factor/backtest/save-as-strategy 缺 name → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/save-as-strategy')
        .send({ conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }] })
        .expect(400)
    })

    it('fac-err-010: /factor/optimization 缺 mode → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/optimization')
        .send({ tsCodes: ['000001.SZ'] })
        .expect(400)
    })
  })

  // ── FAC-ERR: DTO 校验 — 范围/边界约束 ──────────────────────────────────

  describe('[DTO 校验] 范围与边界约束', () => {
    it('fac-err-011: IC 分析 forwardDays=0（<1）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/ic')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', forwardDays: 0 })
        .expect(400)
    })

    it('fac-err-012: IC 分析 forwardDays=61（>60）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/ic')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', forwardDays: 61 })
        .expect(400)
    })

    it('fac-err-013: 分层回测 quantiles=2（<3）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/quantile')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', quantiles: 2 })
        .expect(400)
    })

    it('fac-err-014: 分层回测 quantiles=11（>10）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/quantile')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', quantiles: 11 })
        .expect(400)
    })

    it('fac-err-015: 分层回测 rebalanceDays=0（<1）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/quantile')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', rebalanceDays: 0 })
        .expect(400)
    })

    it('fac-err-016: 分层回测 rebalanceDays=21（>20）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/quantile')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', rebalanceDays: 21 })
        .expect(400)
    })

    it('fac-err-017: 截面分布 bins=9（<10）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/distribution')
        .send({ factorName: 'pe_ttm', tradeDate: '20240101', bins: 9 })
        .expect(400)
    })

    it('fac-err-018: 截面分布 bins=101（>100）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/distribution')
        .send({ factorName: 'pe_ttm', tradeDate: '20240101', bins: 101 })
        .expect(400)
    })

    it('fac-err-019: 相关性 factorNames 数组 1 个（<2）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/correlation')
        .send({ factorNames: ['pe_ttm'], tradeDate: '20240101' })
        .expect(400)
    })

    it('fac-err-020: 相关性 factorNames 数组 21 个（>20）→ 400', async () => {
      const names = Array.from({ length: 21 }, (_, i) => `factor_${i}`)
      await request(app.getHttpServer())
        .post('/factor/analysis/correlation')
        .send({ factorNames: names, tradeDate: '20240101' })
        .expect(400)
    })

    it('fac-err-021: 正交化 factorNames 数组 1 个（<2）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/orthogonalize')
        .send({ factorNames: ['pe_ttm'], tradeDate: '20240101' })
        .expect(400)
    })

    it('fac-err-022: FamaMacBeth factorNames 数组 21 个（>20）→ 400', async () => {
      const names = Array.from({ length: 21 }, (_, i) => `factor_${i}`)
      await request(app.getHttpServer())
        .post('/factor/analysis/fama-macbeth')
        .send({ factorNames: names, startDate: '20240101', endDate: '20241231' })
        .expect(400)
    })

    it('fac-err-023: 选股 pageSize=5（<10）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/screening')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          tradeDate: '20240101',
          pageSize: 5,
        })
        .expect(400)
    })

    it('fac-err-024: 选股 pageSize=201（>200）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/screening')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          tradeDate: '20240101',
          pageSize: 201,
        })
        .expect(400)
    })

    it('fac-err-025: 回测 topN=4（<5）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          topN: 4,
        })
        .expect(400)
    })

    it('fac-err-026: 回测 topN=101（>100）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          topN: 101,
        })
        .expect(400)
    })

    it('fac-err-027: 回测 commissionRate=0.011（>0.01）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          commissionRate: 0.011,
        })
        .expect(400)
    })

    it('fac-err-028: 回测 commissionRate 为负数 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          commissionRate: -0.001,
        })
        .expect(400)
    })

    it('fac-err-029: 回测滑点 bps=51（>50）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          slippageBps: 51,
        })
        .expect(400)
    })

    it('fac-err-030: 回测初始资金=9999（<10000）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          initialCapital: 9999,
        })
        .expect(400)
    })

    it('fac-err-031: 优化 lookbackDays=29（<30）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/optimization')
        .send({ tsCodes: ['000001.SZ'], mode: 'MVO', lookbackDays: 29 })
        .expect(400)
    })

    it('fac-err-032: 优化 maxWeight=1.1（>1）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/optimization')
        .send({ tsCodes: ['000001.SZ'], mode: 'MVO', maxWeight: 1.1 })
        .expect(400)
    })
  })

  // ── FAC-ERR: DTO 校验 — 日期格式 ────────────────────────────────────────

  describe('[DTO 校验] 日期格式 YYYYMMDD', () => {
    const dateEndpoints = [
      { path: '/factor/values', body: { factorName: 'pe_ttm', tradeDate: '2024-01-01' } },
      { path: '/factor/analysis/ic', body: { factorName: 'pe_ttm', startDate: '2024-01-01', endDate: '20241231' } },
      {
        path: '/factor/analysis/quantile',
        body: { factorName: 'pe_ttm', startDate: '2024-01-01', endDate: '20241231' },
      },
      {
        path: '/factor/analysis/decay',
        body: { factorName: 'pe_ttm', startDate: '2024-01-01', endDate: '20241231' },
      },
      { path: '/factor/analysis/distribution', body: { factorName: 'pe_ttm', tradeDate: '2024-01-01' } },
      { path: '/factor/analysis/correlation', body: { factorNames: ['pe_ttm', 'pb'], tradeDate: '2024-01-01' } },
      {
        path: '/factor/custom/test',
        body: { expression: 'close', tradeDate: '2024-01-01' },
      },
      {
        path: '/factor/screening',
        body: { conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }], tradeDate: '2024-01-01' },
      },
      {
        path: '/factor/analysis/orthogonalize',
        body: { factorNames: ['pe_ttm', 'pb'], tradeDate: '2024-01-01' },
      },
      {
        path: '/factor/backtest/submit',
        body: {
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '2024-01-01',
          endDate: '20241231',
        },
      },
    ]

    dateEndpoints.forEach(({ path, body }) => {
      it(`fac-err-date: POST ${path} 含横线日期格式 → 400`, async () => {
        await request(app.getHttpServer()).post(path).send(body).expect(400)
      })
    })

    it('[FIXED] fac-err-033: /factor/custom/precompute tradeDate 长度不足 8 位 → 400 (FactorCustomPrecomputeDto 已修复)', async () => {
      // FAC-GAP-002 已修复：专用 FactorCustomPrecomputeDto 替代 intersection type，@Matches 生效
      await request(app.getHttpServer())
        .post('/factor/custom/precompute')
        .send({ name: 'my_factor', tradeDate: '2024010' })
        .expect(400)
    })
  })

  // ── FAC-ERR: DTO 校验 — 自定义因子名正则 ────────────────────────────────

  describe('[DTO 校验] 自定义因子名格式 (FAC-SEC-002, FAC-ERR-011~013)', () => {
    const baseBody = { label: 'test', category: 'TECHNICAL', expression: 'close' }

    it('fac-sec-002: SQL 注入变体 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: "a';DROP TABLE--" })
        .expect(400)
    })

    it('fac-err-011: 含大写字母 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'MyFactor' })
        .expect(400)
    })

    it('fac-err-012: 含横线（特殊字符）→ 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'my-factor' })
        .expect(400)
    })

    it('fac-err-013: 以数字开头 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: '1factor' })
        .expect(400)
    })

    it('fac-err-034: 以下划线开头 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: '_factor' })
        .expect(400)
    })

    it('fac-err-035: 含中文 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: '因子' })
        .expect(400)
    })

    it('fac-err-036: 名称长度只有1字符 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'a' })
        .expect(400)
    })

    it('fac-err-037: 名称超过50字符 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'a'.repeat(51) })
        .expect(400)
    })

    it('fac-err-038: 表达式超过500字符 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'my_factor', expression: 'x'.repeat(501) })
        .expect(400)
    })

    it('fac-err-039: 标签超过50字符 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ ...baseBody, name: 'my_factor', label: '中'.repeat(51) })
        .expect(400)
    })
  })

  // ── FAC-ERR: 无效枚举值 ─────────────────────────────────────────────────

  describe('[DTO 校验] 无效枚举值', () => {
    it('fac-err-040: IC 分析 icMethod 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/ic')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231', icMethod: 'invalid' })
        .expect(400)
    })

    it('fac-err-041: 正交化 method 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/analysis/orthogonalize')
        .send({ factorNames: ['pe_ttm', 'pb'], tradeDate: '20240101', method: 'invalid' })
        .expect(400)
    })

    it('fac-err-042: 筛选 operator 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/screening')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'eq', value: 0 }],
          tradeDate: '20240101',
        })
        .expect(400)
    })

    it('fac-err-043: 优化 mode 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/optimization')
        .send({ tsCodes: ['000001.SZ'], mode: 'INVALID_MODE' })
        .expect(400)
    })

    it('fac-err-044: 回测 weightMethod 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
          weightMethod: 'invalid',
        })
        .expect(400)
    })
  })

  // ── FAC-ERR: 跨字段校验（startDate > endDate）─────────────────────────

  describe('[DTO 校验] 跨字段逻辑', () => {
    it('fac-err-045: 回测 startDate > endDate → 接受（DTO无此校验）', async () => {
      // DTO 的 @Matches 只检查格式，不检查大小关系 → 依赖业务层的校验
      mockFactorService.submitBacktest.mockRejectedValueOnce(new Error('startDate must be before endDate'))
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20241231',
          endDate: '20240101',
        })
        .expect(500) // DTO 通过，业务层抛错
    })
  })

  // ── FAC-SEC: 安全测试 ──────────────────────────────────────────────────

  describe('[安全] 鉴权与权限', () => {
    it('fac-sec-001: 无 token → 401', async () => {
      mockJwtGuard.canActivate.mockImplementationOnce(() => {
        throw new UnauthorizedException()
      })
      await request(app.getHttpServer()).post('/factor/library').send({}).expect(401)
    })

    it('fac-sec-005: 无 token 访问 /factor/values → 401', async () => {
      mockJwtGuard.canActivate.mockImplementationOnce(() => {
        throw new UnauthorizedException()
      })
      await request(app.getHttpServer())
        .post('/factor/values')
        .send({ factorName: 'pe_ttm', tradeDate: '20240101' })
        .expect(401)
    })

    it('fac-sec-006: 无 token 访问 /factor/screening → 401', async () => {
      mockJwtGuard.canActivate.mockImplementationOnce(() => {
        throw new UnauthorizedException()
      })
      await request(app.getHttpServer())
        .post('/factor/screening')
        .send({ conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }], tradeDate: '20240101' })
        .expect(401)
    })
  })

  // ── FAC-SEC: 管理员权限（@Roles(ADMIN) 保护） ──────────────────────────

  describe('[安全] 管理员权限', () => {
    beforeEach(() => {
      // 模拟普通用户被 RolesGuard 拒绝
      mockRolesGuard.canActivate.mockImplementation(() => false)
    })

    const adminPaths = [
      '/factor/admin/precompute',
      '/factor/admin/backfill',
      '/factor/admin/precompute/status',
      '/factor/admin/precompute-batch',
      '/factor/admin/jobs',
      '/factor/admin/jobs/detail',
      '/factor/admin/schedule',
      '/factor/admin/audit',
    ]

    adminPaths.forEach((path) => {
      it(`fac-sec-admin: POST ${path} → 403 (非 ADMIN 拒绝访问)`, async () => {
        const body = path.includes('backfill')
          ? { startDate: '20240101', endDate: '20240131' }
          : path.includes('detail') || path.includes('precompute')
            ? { tradeDate: '20240101' }
            : {}
        await request(app.getHttpServer()).post(path).send(body).expect(403)
      })
    })
  })

  // ── FAC-BIZ: 管理存根端点 ──────────────────────────────────────────────

  describe('[业务] 管理存根端点', () => {
    beforeEach(() => {
      mockJwtGuard.canActivate.mockImplementation((context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = adminUser
        return true
      })
      mockRolesGuard.canActivate.mockReturnValue(true)
    })

    it('fac-biz-026: POST /factor/admin/schedule → 返回空列表', async () => {
      await request(app.getHttpServer())
        .post('/factor/admin/schedule')
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body.code).toBe(SUCCESS_CODE)
          expect(res.body.data).toEqual({ items: [], total: 0 })
        })
    })

    it('fac-biz-027: POST /factor/admin/audit → 返回空列表', async () => {
      await request(app.getHttpServer())
        .post('/factor/admin/audit')
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body.code).toBe(SUCCESS_CODE)
          expect(res.body.data).toEqual({ items: [], total: 0 })
        })
    })
  })

  // ── FAC-BIZ: 管理接口冒烟测试 ──────────────────────────────────────────

  describe('[业务] 管理接口冒烟', () => {
    beforeEach(() => {
      mockJwtGuard.canActivate.mockImplementation((context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = adminUser
        return true
      })
      mockRolesGuard.canActivate.mockReturnValue(true)
    })

    it('fac-biz-025: POST /factor/admin/precompute/status → 201', async () => {
      const mockStatus = { latestDate: '20240101', factors: [] }
      mockFactorService.getPrecomputeStatus.mockResolvedValueOnce(mockStatus)
      await request(app.getHttpServer())
        .post('/factor/admin/precompute/status')
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body.code).toBe(SUCCESS_CODE)
        })
    })

    it('fac-biz-028: POST /factor/admin/precompute → 201', async () => {
      mockFactorService.triggerPrecompute.mockResolvedValueOnce(null)
      await request(app.getHttpServer())
        .post('/factor/admin/precompute')
        .send({ tradeDate: '20240101' })
        .expect(201)
    })

    it('fac-biz-029: POST /factor/admin/backfill → 201', async () => {
      mockFactorService.triggerBackfill.mockResolvedValueOnce(null)
      await request(app.getHttpServer())
        .post('/factor/admin/backfill')
        .send({ startDate: '20240101', endDate: '20240131' })
        .expect(201)
    })

    it('fac-biz-030: POST /factor/admin/precompute-batch → 201', async () => {
      mockFactorService.triggerPrecomputeBatch.mockResolvedValueOnce({ jobCount: 2 })
      await request(app.getHttpServer())
        .post('/factor/admin/precompute-batch')
        .send({ factorNames: ['pe_ttm', 'pb'] })
        .expect(201)
    })

    it('fac-biz-031: POST /factor/admin/jobs → 201', async () => {
      mockFactorService.listAdminJobs.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      await request(app.getHttpServer())
        .post('/factor/admin/jobs')
        .send({})
        .expect(201)
    })

    it('fac-biz-032: POST /factor/admin/jobs/detail → 201', async () => {
      mockFactorService.getAdminJobDetail.mockResolvedValueOnce({ tradeDate: '20240101', items: [] })
      await request(app.getHttpServer())
        .post('/factor/admin/jobs/detail')
        .send({ tradeDate: '20240101' })
        .expect(201)
    })
  })

  // ── FAC-BIZ: 其他端点冒烟 ──────────────────────────────────────────────

  describe('[业务] 其他端点冒烟', () => {
    it('fac-biz-033: POST /factor/analysis/decay → 201', async () => {
      mockFactorService.getDecayAnalysis.mockResolvedValueOnce({ series: [] })
      await request(app.getHttpServer())
        .post('/factor/analysis/decay')
        .send({ factorName: 'pe_ttm', startDate: '20240101', endDate: '20241231' })
        .expect(201)
    })

    it('fac-biz-034: POST /factor/analysis/distribution → 201', async () => {
      mockFactorService.getDistribution.mockResolvedValueOnce({ histogram: [], stats: {} })
      await request(app.getHttpServer())
        .post('/factor/analysis/distribution')
        .send({ factorName: 'pe_ttm', tradeDate: '20240101' })
        .expect(201)
    })

    it('fac-biz-035: POST /factor/analysis/correlation → 201', async () => {
      mockFactorService.getCorrelation.mockResolvedValueOnce({ matrix: [[1, 0.5], [0.5, 1]] })
      await request(app.getHttpServer())
        .post('/factor/analysis/correlation')
        .send({ factorNames: ['pe_ttm', 'pb'], tradeDate: '20240101' })
        .expect(201)
    })

    it('fac-biz-036: POST /factor/custom/create → 201', async () => {
      mockFactorService.createCustomFactor.mockResolvedValueOnce({ name: 'my_factor', label: 'test' })
      await request(app.getHttpServer())
        .post('/factor/custom/create')
        .send({ name: 'my_factor', label: 'test', category: 'TECHNICAL', expression: 'close' })
        .expect(201)
    })

    it('fac-biz-037: POST /factor/custom/test → 201', async () => {
      mockFactorService.testCustomFactor.mockResolvedValueOnce({ values: [] })
      await request(app.getHttpServer())
        .post('/factor/custom/test')
        .send({ expression: 'close', tradeDate: '20240101' })
        .expect(201)
    })

    it('fac-biz-038: POST /factor/analysis/orthogonalize → 201', async () => {
      mockFactorService.orthogonalize.mockResolvedValueOnce({ matrix: [] })
      await request(app.getHttpServer())
        .post('/factor/analysis/orthogonalize')
        .send({ factorNames: ['pe_ttm', 'pb'], tradeDate: '20240101' })
        .expect(201)
    })

    it('fac-biz-039: POST /factor/analysis/fama-macbeth → 201', async () => {
      mockFactorService.famaMacBeth.mockResolvedValueOnce({ premiums: [] })
      await request(app.getHttpServer())
        .post('/factor/analysis/fama-macbeth')
        .send({ factorNames: ['pe_ttm'], startDate: '20240101', endDate: '20241231' })
        .expect(201)
    })

    it('fac-biz-040: POST /factor/backtest/submit → 201', async () => {
      mockFactorService.submitBacktest.mockResolvedValueOnce({ backtestId: 'bt-123' })
      await request(app.getHttpServer())
        .post('/factor/backtest/submit')
        .send({
          conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }],
          startDate: '20240101',
          endDate: '20241231',
        })
        .expect(201)
    })

    it('fac-biz-041: POST /factor/backtest/attribution → 201', async () => {
      mockFactorService.attribution.mockResolvedValueOnce({ contributions: [] })
      await request(app.getHttpServer())
        .post('/factor/backtest/attribution')
        .send({ id: 'bt-123' })
        .expect(201)
    })

    it('fac-biz-042: POST /factor/backtest/save-as-strategy → 201', async () => {
      mockFactorService.saveAsStrategy.mockResolvedValueOnce({ strategyId: 'st-456' })
      await request(app.getHttpServer())
        .post('/factor/backtest/save-as-strategy')
        .send({ conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }], name: 'my_strategy' })
        .expect(201)
    })

    it('fac-biz-043: POST /factor/optimization → 201', async () => {
      mockFactorService.optimize.mockResolvedValueOnce({ weights: [] })
      await request(app.getHttpServer())
        .post('/factor/optimization')
        .send({ tsCodes: ['000001.SZ', '000002.SZ'], mode: 'MVO' })
        .expect(201)
    })

    it('fac-biz-044: POST /factor/custom/update → 201', async () => {
      mockFactorService.updateCustomFactor.mockResolvedValueOnce({ name: 'my_factor', label: 'updated' })
      await request(app.getHttpServer())
        .post('/factor/custom/update')
        .send({ name: 'my_factor', label: 'updated' })
        .expect(201)
    })

    it('fac-biz-045: POST /factor/custom/delete → 201', async () => {
      mockFactorService.deleteCustomFactor.mockResolvedValueOnce(null)
      await request(app.getHttpServer())
        .post('/factor/custom/delete')
        .send({ name: 'my_factor' })
        .expect(201)
    })
  })
})
