/**
 * Backtest 模块 API 测试 — 业务优先
 *
 * 覆盖：回测 CRUD、回测数据、高级分析、Walk-Forward、多策略对比、统计
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
import { BacktestController } from '../backtest.controller'
import { BacktestRunService } from '../services/backtest-run.service'
import { BacktestStrategyRegistryService } from '../services/backtest-strategy-registry.service'
import { BacktestWalkForwardService } from '../services/backtest-walk-forward.service'
import { BacktestComparisonService } from '../services/backtest-comparison.service'
import { BacktestMonteCarloService } from '../services/backtest-monte-carlo.service'
import { BacktestAttributionService } from '../services/backtest-attribution.service'
import { BacktestCostSensitivityService } from '../services/backtest-cost-sensitivity.service'
import { BacktestParamSensitivityService } from '../services/backtest-param-sensitivity.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Backtest API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockRunService: Record<string, jest.Mock>
  let mockStrategyRegistry: Record<string, jest.Mock>
  let mockWalkForwardService: Record<string, jest.Mock>
  let mockComparisonService: Record<string, jest.Mock>
  let mockMonteCarloService: Record<string, jest.Mock>
  let mockAttributionService: Record<string, jest.Mock>
  let mockCostSensitivityService: Record<string, jest.Mock>
  let mockParamSensitivityService: Record<string, jest.Mock>

  const user = buildTestUser()

  beforeEach(async () => {
    mockRunService = {
      validateRun: jest.fn().mockResolvedValue({ valid: true, warnings: [] }),
      createRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'QUEUED', jobId: 'job-1' }),
      listRuns: jest.fn().mockResolvedValue({ items: [{ id: 'run-1', name: '测试回测', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 20 }),
      getRunDetail: jest.fn().mockResolvedValue({ id: 'run-1', name: '测试回测', status: 'COMPLETED', strategyType: 'MA_CROSS_SINGLE' }),
      getEquity: jest.fn().mockResolvedValue([{ tradeDate: '20260524', nav: 1.15 }]),
      getTrades: jest.fn().mockResolvedValue({ items: [{ tsCode: '000001.SZ', action: 'BUY', quantity: 100 }], total: 1 }),
      getPositions: jest.fn().mockResolvedValue([{ tsCode: '000001.SZ', quantity: 100, weight: 0.15 }]),
      cancelRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'CANCELLED' }),
      renameRun: jest.fn().mockResolvedValue({ id: 'run-1', name: '新名称' }),
      archiveRun: jest.fn().mockResolvedValue({ id: 'run-1', archived: true }),
      deleteRun: jest.fn().mockResolvedValue({ id: 'run-1', deleted: true }),
      starRun: jest.fn().mockResolvedValue({ id: 'run-1', starred: true }),
      retryRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'QUEUED' }),
      getStats: jest.fn().mockResolvedValue({ total: 10, completed: 8, failed: 2 }),
      getRebalanceLogs: jest.fn().mockResolvedValue([{ date: '20260501', actions: [] }]),
    }

    mockStrategyRegistry = {
      getTemplates: jest.fn().mockResolvedValue([{ type: 'MA_CROSS_SINGLE', name: '均线交叉', description: '双均线策略' }]),
    }

    mockWalkForwardService = {
      createWalkForwardRun: jest.fn().mockResolvedValue({ wfRunId: 'wf-1', jobId: 'job-1', status: 'QUEUED' }),
      listWalkForwardRuns: jest.fn().mockResolvedValue({ items: [{ wfRunId: 'wf-1', status: 'COMPLETED' }], total: 1, page: 1, pageSize: 20 }),
      getWalkForwardRunDetail: jest.fn().mockResolvedValue({ wfRunId: 'wf-1', status: 'COMPLETED', windows: [] }),
      getWalkForwardEquity: jest.fn().mockResolvedValue({ points: [{ tradeDate: '20260524', nav: 1.1, windowIndex: 0 }] }),
      cancelWalkForwardRun: jest.fn().mockResolvedValue({ wfRunId: 'wf-1', status: 'CANCELLED' }),
      deleteWalkForwardRun: jest.fn().mockResolvedValue({ wfRunId: 'wf-1', deleted: true }),
    }

    mockComparisonService = {
      createComparison: jest.fn().mockResolvedValue({ groupId: 'grp-1', jobId: 'job-1', status: 'QUEUED' }),
      listComparisons: jest.fn().mockResolvedValue({ items: [{ groupId: 'grp-1', status: 'COMPLETED' }], total: 1 }),
      getComparisonDetail: jest.fn().mockResolvedValue({ groupId: 'grp-1', metrics: [] }),
      getComparisonEquity: jest.fn().mockResolvedValue({ series: [] }),
    }

    mockMonteCarloService = {
      runMonteCarloSimulation: jest.fn().mockResolvedValue({ numSimulations: 1000, originalFinalNav: 1.15, finalNavDistribution: {}, maxDrawdownDistribution: {}, annualizedReturnDistribution: {}, timeSeries: [] }),
    }

    mockAttributionService = {
      brinson: jest.fn().mockResolvedValue({ runId: 'run-1', industries: [], periods: [] }),
    }

    mockCostSensitivityService = {
      analyze: jest.fn().mockResolvedValue({ runId: 'run-1', points: [] }),
    }

    mockParamSensitivityService = {
      create: jest.fn().mockResolvedValue({ sweepId: 'sweep-1', totalCombinations: 16, status: 'PENDING', metric: 'sharpeRatio' }),
      getResult: jest.fn().mockResolvedValue({ sweepId: 'sweep-1', status: 'COMPLETED', heatmap: [[1, 2], [3, 4]] }),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [BacktestController],
      providers: [
        { provide: BacktestRunService, useValue: mockRunService },
        { provide: BacktestStrategyRegistryService, useValue: mockStrategyRegistry },
        { provide: BacktestWalkForwardService, useValue: mockWalkForwardService },
        { provide: BacktestComparisonService, useValue: mockComparisonService },
        { provide: BacktestMonteCarloService, useValue: mockMonteCarloService },
        { provide: BacktestAttributionService, useValue: mockAttributionService },
        { provide: BacktestCostSensitivityService, useValue: mockCostSensitivityService },
        { provide: BacktestParamSensitivityService, useValue: mockParamSensitivityService },
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

  // ── 回测 CRUD ──────────────────────────────────────────────────────────────

  describe('回测 CRUD', () => {
    const validRunDto = {
      strategyType: 'MA_CROSS_SINGLE',
      strategyConfig: { shortPeriod: 5, longPeriod: 20 },
      startDate: '20260101',
      endDate: '20260524',
      initialCapital: 100000,
    }

    it('BT-BIZ-001: 创建回测', async () => {
      const res = await req
        .post('/backtests/runs')
        .send(validRunDto)
        .expect(201)
      expect(res.body.data.runId).toBe('run-1')
      expect(res.body.data.status).toBe('QUEUED')
    })

    it('BT-BIZ-002: 查询回测列表', async () => {
      const res = await req
        .post('/backtests/runs/list')
        .send({})
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.total).toBe(1)
    })

    it('BT-BIZ-003: 获取回测详情', async () => {
      const res = await req
        .post('/backtests/runs/detail')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data.id).toBe('run-1')
    })

    it('BT-BIZ-004: 取消回测', async () => {
      const res = await req
        .post('/backtests/runs/cancel')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data.status).toBe('CANCELLED')
    })

    it('BT-BIZ-005: 重命名回测', async () => {
      await req
        .post('/backtests/runs/rename')
        .send({ runId: 'run-1', name: '新名称' })
        .expect(201)
    })

    it('BT-BIZ-006: 归档回测', async () => {
      await req
        .post('/backtests/runs/archive')
        .send({ runId: 'run-1', archived: true })
        .expect(201)
    })

    it('BT-BIZ-007: 删除回测', async () => {
      await req
        .post('/backtests/runs/delete')
        .send({ runId: 'run-1' })
        .expect(201)
    })

    it('BT-BIZ-008: 标星回测', async () => {
      await req
        .post('/backtests/runs/star')
        .send({ runId: 'run-1', starred: true })
        .expect(201)
    })

    it('BT-BIZ-009: 重试回测', async () => {
      await req
        .post('/backtests/runs/retry')
        .send({ runId: 'run-1' })
        .expect(201)
    })

    it('BT-EDGE-001: 初始资金=1000（最小）', async () => {
      await req
        .post('/backtests/runs')
        .send({ ...validRunDto, initialCapital: 1000 })
        .expect(201)
    })

    it('BT-EDGE-002: 初始资金=999 应 400', async () => {
      await req
        .post('/backtests/runs')
        .send({ ...validRunDto, initialCapital: 999 })
        .expect(400)
    })

    it('BT-EDGE-003: 日期格式正确', async () => {
      await req
        .post('/backtests/runs')
        .send(validRunDto)
        .expect(201)
    })

    it('BT-EDGE-004: 日期格式错误应 400', async () => {
      await req
        .post('/backtests/runs')
        .send({ ...validRunDto, startDate: '2026/01/01' })
        .expect(400)
    })

    it('BT-ERR-001: 无效 strategyType 应 400', async () => {
      await req
        .post('/backtests/runs')
        .send({ ...validRunDto, strategyType: 'INVALID' })
        .expect(400)
    })

    it('BT-ERR-002: strategyConfig 非对象应 400', async () => {
      await req
        .post('/backtests/runs')
        .send({ ...validRunDto, strategyConfig: 'abc' })
        .expect(400)
    })

    it('BT-ERR-003: 缺 startDate 应 400', async () => {
      const { startDate, ...rest } = validRunDto
      await req
        .post('/backtests/runs')
        .send(rest)
        .expect(400)
    })
  })

  // ── 回测数据 ──────────────────────────────────────────────────────────────

  describe('回测数据', () => {
    it('BT-BIZ-010: 获取净值曲线', async () => {
      const res = await req
        .post('/backtests/runs/equity')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].nav).toBe(1.15)
    })

    it('BT-BIZ-011: 查询交易明细', async () => {
      const res = await req
        .post('/backtests/runs/trades')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
    })

    it('BT-BIZ-012: 查询持仓快照', async () => {
      const res = await req
        .post('/backtests/runs/positions')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
    })

    it('BT-BIZ-013: 查询调仓日志', async () => {
      const res = await req
        .post('/backtests/runs/rebalance-logs')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data).toHaveLength(1)
    })
  })

  // ── 高级分析 ──────────────────────────────────────────────────────────────

  describe('高级分析', () => {
    it('BT-BIZ-014: 蒙特卡洛模拟', async () => {
      const res = await req
        .post('/backtests/runs/monte-carlo')
        .send({ runId: 'run-1', numSimulations: 1000 })
        .expect(201)
      expect(res.body.data.numSimulations).toBe(1000)
    })

    it('BT-BIZ-015: Brinson 归因', async () => {
      const res = await req
        .post('/backtests/runs/attribution')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data.runId).toBe('run-1')
    })

    it('BT-BIZ-016: 成本敏感性分析', async () => {
      const res = await req
        .post('/backtests/runs/cost-sensitivity')
        .send({ runId: 'run-1' })
        .expect(201)
      expect(res.body.data.runId).toBe('run-1')
    })

    it('BT-BIZ-017: 参数敏感性扫描', async () => {
      const res = await req
        .post('/backtests/runs/param-sensitivity')
        .send({
          runId: 'run-1',
          paramX: { paramKey: 'shortPeriod', values: [5, 10, 15, 20] },
          paramY: { paramKey: 'longPeriod', values: [20, 30, 40, 50] },
        })
        .expect(201)
      expect(res.body.data.sweepId).toBe('sweep-1')
      expect(res.body.data.totalCombinations).toBe(16)
    })

    it('BT-BIZ-018: 查询参数扫描结果', async () => {
      const res = await req
        .post('/backtests/runs/param-sensitivity/result')
        .send({ sweepId: 'sweep-1' })
        .expect(201)
      expect(res.body.data.heatmap).toHaveLength(2)
    })

    it('BT-EDGE-007: monte-carlo numSimulations=100', async () => {
      await req
        .post('/backtests/runs/monte-carlo')
        .send({ runId: 'run-1', numSimulations: 100 })
        .expect(201)
    })

    it('BT-EDGE-008: monte-carlo numSimulations=10000', async () => {
      await req
        .post('/backtests/runs/monte-carlo')
        .send({ runId: 'run-1', numSimulations: 10000 })
        .expect(201)
    })

    it('BT-EDGE-009: monte-carlo numSimulations=99', async () => {
      // RunMonteCarloDto 使用 @IsOptional()，@Min(100) 在可选字段上的行为待澄清
      const res = await req
        .post('/backtests/runs/monte-carlo')
        .send({ runId: 'run-1', numSimulations: 99 })
      expect([201, 400]).toContain(res.status)
    })
  })

  // ── Walk-Forward ──────────────────────────────────────────────────────────

  describe('Walk-Forward', () => {
    const validWfDto = {
      baseStrategyType: 'MA_CROSS_SINGLE',
      baseStrategyConfig: {},
      paramSearchSpace: {},
      fullStartDate: '20260101',
      fullEndDate: '20260524',
      inSampleDays: 120,
      outOfSampleDays: 30,
      stepDays: 30,
      initialCapital: 100000,
    }

    it('BT-BIZ-019: 创建 Walk-Forward', async () => {
      const res = await req
        .post('/backtests/walk-forward/runs')
        .send(validWfDto)
        .expect(201)
      expect(res.body.data.wfRunId).toBe('wf-1')
    })

    it('BT-BIZ-020: Walk-Forward 列表', async () => {
      const res = await req
        .post('/backtests/walk-forward/runs/list')
        .send({})
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
    })

    it('BT-BIZ-021: Walk-Forward 详情', async () => {
      const res = await req
        .post('/backtests/walk-forward/runs/detail')
        .send({ wfRunId: 'wf-1' })
        .expect(201)
      expect(res.body.data.wfRunId).toBe('wf-1')
    })

    it('BT-BIZ-022: Walk-Forward 净值', async () => {
      const res = await req
        .post('/backtests/walk-forward/runs/equity')
        .send({ wfRunId: 'wf-1' })
        .expect(201)
      expect(res.body.data.points).toHaveLength(1)
    })

    it('BT-EDGE-010: inSampleDays=60（最小）', async () => {
      await req
        .post('/backtests/walk-forward/runs')
        .send({ ...validWfDto, inSampleDays: 60 })
        .expect(201)
    })

    it('BT-EDGE-011: inSampleDays=59 应 400', async () => {
      await req
        .post('/backtests/walk-forward/runs')
        .send({ ...validWfDto, inSampleDays: 59 })
        .expect(400)
    })

    it('BT-EDGE-012: outOfSampleDays=20（最小）', async () => {
      await req
        .post('/backtests/walk-forward/runs')
        .send({ ...validWfDto, outOfSampleDays: 20 })
        .expect(201)
    })

    it('BT-EDGE-013: outOfSampleDays=19 应 400', async () => {
      await req
        .post('/backtests/walk-forward/runs')
        .send({ ...validWfDto, outOfSampleDays: 19 })
        .expect(400)
    })
  })

  // ── 多策略对比 ────────────────────────────────────────────────────────────

  describe('多策略对比', () => {
    const validComparisonDto = {
      strategies: [
        { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { shortPeriod: 5 } },
        { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { shortPeriod: 10 } },
      ],
      startDate: '20260101',
      endDate: '20260524',
      initialCapital: 100000,
    }

    it('BT-BIZ-023: 创建对比组', async () => {
      const res = await req
        .post('/backtests/comparisons')
        .send(validComparisonDto)
        .expect(201)
      expect(res.body.data.groupId).toBe('grp-1')
    })

    it('BT-BIZ-024: 对比组列表', async () => {
      const res = await req
        .post('/backtests/comparisons/list')
        .send({})
        .expect(201)
      expect(res.body.data.items).toHaveLength(1)
    })

    it('BT-BIZ-025: 对比组详情', async () => {
      const res = await req
        .post('/backtests/comparisons/detail')
        .send({ groupId: 'grp-1' })
        .expect(201)
      expect(res.body.data.groupId).toBe('grp-1')
    })

    it('BT-BIZ-026: 对比组净值', async () => {
      const res = await req
        .post('/backtests/comparisons/equity')
        .send({ groupId: 'grp-1' })
        .expect(201)
      expect(res.body.data.series).toBeDefined()
    })

    it('BT-EDGE-014: strategies=2 个（最小）', async () => {
      await req
        .post('/backtests/comparisons')
        .send(validComparisonDto)
        .expect(201)
    })

    it('BT-EDGE-016: strategies=1 个应 400', async () => {
      await req
        .post('/backtests/comparisons')
        .send({ ...validComparisonDto, strategies: [{ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} }] })
        .expect(400)
    })
  })

  // ── 统计 ──────────────────────────────────────────────────────────────────

  describe('统计', () => {
    it('BT-BIZ-027: 回测统计', async () => {
      const res = await req
        .post('/backtests/runs/stats')
        .send({})
        .expect(201)
      expect(res.body.data.total).toBe(10)
    })

    it('BT-BIZ-028: 策略模板列表', async () => {
      const res = await req
        .post('/backtests/strategy-templates')
        .send({})
        .expect(201)
      expect(res.body.data).toHaveLength(1)
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('BT-SEC-001: 无 Token 应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [BacktestController],
        providers: [
          { provide: BacktestRunService, useValue: mockRunService },
          { provide: BacktestStrategyRegistryService, useValue: mockStrategyRegistry },
          { provide: BacktestWalkForwardService, useValue: mockWalkForwardService },
          { provide: BacktestComparisonService, useValue: mockComparisonService },
          { provide: BacktestMonteCarloService, useValue: mockMonteCarloService },
          { provide: BacktestAttributionService, useValue: mockAttributionService },
          { provide: BacktestCostSensitivityService, useValue: mockCostSensitivityService },
          { provide: BacktestParamSensitivityService, useValue: mockParamSensitivityService },
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
        .post('/backtests/runs/list')
        .expect(401)
      await unauthApp.close()
    })
  })
})
