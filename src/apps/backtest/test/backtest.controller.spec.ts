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
import { LoggerService } from 'src/shared/logger/logger.service'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { BacktestController } from '../backtest.controller'
import { BacktestRunService } from '../services/backtest-run.service'
import { BacktestStrategyRegistryService } from '../services/backtest-strategy-registry.service'
import { BacktestWalkForwardService } from '../services/backtest-walk-forward.service'
import { BacktestComparisonService } from '../services/backtest-comparison.service'
import { BacktestMonteCarloService } from '../services/backtest-monte-carlo.service'
import { BacktestAttributionService } from '../services/backtest-attribution.service'
import { BacktestCostSensitivityService } from '../services/backtest-cost-sensitivity.service'
import { BacktestParamSensitivityService } from '../services/backtest-param-sensitivity.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

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

const mockRunService = {
  createRun: jest.fn(),
  listRuns: jest.fn(),
  getRunDetail: jest.fn(),
  validateRun: jest.fn(),
  getEquity: jest.fn(),
  getTrades: jest.fn(),
  getPositions: jest.fn(),
  cancelRun: jest.fn(),
  renameRun: jest.fn(),
  archiveRun: jest.fn(),
  deleteRun: jest.fn(),
  starRun: jest.fn(),
  retryRun: jest.fn(),
  getStats: jest.fn(),
  getRebalanceLogs: jest.fn(),
}

const mockRegistryService = { getTemplates: jest.fn() }
const mockWalkForwardService = {
  createWalkForwardRun: jest.fn(),
  listWalkForwardRuns: jest.fn(),
  getWalkForwardRunDetail: jest.fn(),
  getWalkForwardEquity: jest.fn(),
  cancelWalkForwardRun: jest.fn(),
  deleteWalkForwardRun: jest.fn(),
}
const mockComparisonService = {
  createComparison: jest.fn(),
  getComparisonDetail: jest.fn(),
  getComparisonEquity: jest.fn(),
  listComparisons: jest.fn(),
}
const mockMonteCarloService = { runMonteCarloSimulation: jest.fn() }
const mockAttributionService = { brinson: jest.fn() }
const mockCostSensitivityService = { analyze: jest.fn() }
const mockParamSensitivityService = {
  create: jest.fn(),
  getResult: jest.fn(),
}

const SUCCESS_CODE = 0
const baseBacktestBody = {
  strategyType: 'MA_CROSS_SINGLE',
  strategyConfig: { fast: 5, slow: 20 },
  startDate: '20230101',
  endDate: '20231231',
  initialCapital: 100000,
}

describe('BacktestController', () => {
  let app: INestApplication
  let mockJwtGuard: { canActivate: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockJwtGuard = {
      canActivate: jest.fn((context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest()
        req.user = testUser
        return true
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BacktestController],
      providers: [
        { provide: BacktestRunService, useValue: mockRunService },
        { provide: BacktestStrategyRegistryService, useValue: mockRegistryService },
        { provide: BacktestWalkForwardService, useValue: mockWalkForwardService },
        { provide: BacktestComparisonService, useValue: mockComparisonService },
        { provide: BacktestMonteCarloService, useValue: mockMonteCarloService },
        { provide: BacktestAttributionService, useValue: mockAttributionService },
        { provide: BacktestCostSensitivityService, useValue: mockCostSensitivityService },
        { provide: BacktestParamSensitivityService, useValue: mockParamSensitivityService },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
  })

  afterEach(async () => app.close())

  // ── 原有核心冒烟 ──────────────────────────────────────────────────────────

  it('POST /backtests/runs → 201 with code 200000', async () => {
    mockRunService.createRun.mockResolvedValueOnce({ runId: 'run-1', status: 'PENDING' })
    await request(app.getHttpServer()).post('/backtests/runs').send(baseBacktestBody).expect(201).expect((res) => {
      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data).toMatchObject({ runId: 'run-1', status: 'PENDING' })
    })
  })

  it('POST /backtests/runs/list → 201', async () => {
    mockRunService.listRuns.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
    await request(app.getHttpServer()).post('/backtests/runs/list').send({}).expect(201)
  })

  it('POST /backtests/runs/detail → 201', async () => {
    mockRunService.getRunDetail.mockResolvedValueOnce({ runId: 'run-1', status: 'COMPLETED' })
    await request(app.getHttpServer()).post('/backtests/runs/detail').send({ runId: 'run-1' }).expect(201)
  })

  it('POST /backtests/runs/validate → 201', async () => {
    mockRunService.validateRun.mockResolvedValueOnce({ valid: true, warnings: [] })
    await request(app.getHttpServer()).post('/backtests/runs/validate').send(baseBacktestBody).expect(201)
  })

  it('POST /backtests/strategy-templates → 201', async () => {
    mockRegistryService.getTemplates.mockResolvedValueOnce([{ id: 'tmpl-1', name: 'MA Cross' }])
    await request(app.getHttpServer()).post('/backtests/strategy-templates').send({}).expect(201)
  })

  // ── 原有 VAL/ERR/AUTH ────────────────────────────────────────────────────

  it('[VAL] POST /backtests/runs 缺 strategyType → 400', async () => {
    await request(app.getHttpServer())
      .post('/backtests/runs')
      .send({ strategyConfig: {}, startDate: '20230101', endDate: '20231231', initialCapital: 100000 })
      .expect(400)
  })

  it('[VAL] POST /backtests/runs 缺 startDate → 400', async () => {
    await request(app.getHttpServer())
      .post('/backtests/runs')
      .send({ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {}, endDate: '20231231', initialCapital: 100000 })
      .expect(400)
  })

  it("[VAL] POST /backtests/runs startDate='2024-01-01' → 400", async () => {
    await request(app.getHttpServer()).post('/backtests/runs').send({
      strategyType: 'MA_CROSS_SINGLE', strategyConfig: {}, startDate: '2024-01-01', endDate: '20231231', initialCapital: 100000,
    }).expect(400)
  })

  it('[VAL] POST /backtests/runs initialCapital=500 → 400', async () => {
    await request(app.getHttpServer())
      .post('/backtests/runs')
      .send({ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {}, startDate: '20230101', endDate: '20231231', initialCapital: 500 })
      .expect(400)
  })

  it("[VAL] POST /backtests/runs strategyType='INVALID' → 400", async () => {
    await request(app.getHttpServer())
      .post('/backtests/runs')
      .send({ strategyType: 'INVALID', strategyConfig: {}, startDate: '20230101', endDate: '20231231', initialCapital: 100000 })
      .expect(400)
  })

  it('[ERR] POST /backtests/runs/detail NotFoundException → 404', async () => {
    mockRunService.getRunDetail.mockRejectedValueOnce(new NotFoundException('RunId 不存在'))
    await request(app.getHttpServer()).post('/backtests/runs/detail').send({ runId: 'nonexistent' }).expect(404)
  })

  it('[AUTH] 未登录 → 401', async () => {
    mockJwtGuard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException()
    })
    await request(app.getHttpServer()).post('/backtests/runs').send(baseBacktestBody).expect(401)
  })

  // ── 新增 DTO 校验 ────────────────────────────────────────────────────────

  describe('[DTO 校验] CreateBacktestRunDto', () => {
    it('maxPositions=0 (<1) → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, maxPositions: 0 }).expect(400)
    })
    it('maxPositions=501 (>500) → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, maxPositions: 501 }).expect(400)
    })
    it('maxWeightPerStock=0.005 (<0.01) → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, maxWeightPerStock: 0.005 }).expect(400)
    })
    it('maxWeightPerStock=1.1 (>1) → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, maxWeightPerStock: 1.1 }).expect(400)
    })
    it('rebalanceFrequency="INVALID" → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, rebalanceFrequency: 'INVALID' }).expect(400)
    })
    it('priceMode="INVALID" → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, priceMode: 'INVALID' }).expect(400)
    })
    it('universe="INVALID" → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, universe: 'INVALID' }).expect(400)
    })
    it('customUniverseTsCodes 超过500 → 400', async () => {
      const codes = Array.from({ length: 501 }, (_, i) => `${String(i).padStart(6, '0')}.SZ`)
      await request(app.getHttpServer()).post('/backtests/runs').send({ ...baseBacktestBody, universe: 'CUSTOM', customUniverseTsCodes: codes }).expect(400)
    })
  })

  // ── 新增冒烟：全端点覆盖 ─────────────────────────────────────────────────

  describe('[BIZ] 全端点冒烟', () => {
    it('/backtests/runs/equity → 201', async () => {
      mockRunService.getEquity.mockResolvedValueOnce({ equityCurve: [] })
      await request(app.getHttpServer()).post('/backtests/runs/equity').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/trades → 201', async () => {
      mockRunService.getTrades.mockResolvedValueOnce({ items: [], total: 0 })
      await request(app.getHttpServer()).post('/backtests/runs/trades').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/positions → 201', async () => {
      mockRunService.getPositions.mockResolvedValueOnce({ items: [] })
      await request(app.getHttpServer()).post('/backtests/runs/positions').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/cancel → 201', async () => {
      mockRunService.cancelRun.mockResolvedValueOnce({ cancelled: true })
      await request(app.getHttpServer()).post('/backtests/runs/cancel').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/rename → 201', async () => {
      mockRunService.renameRun.mockResolvedValueOnce({ runId: 'run-1', name: 'newName' })
      await request(app.getHttpServer()).post('/backtests/runs/rename').send({ runId: 'run-1', name: 'newName' }).expect(201)
    })
    it('/backtests/runs/archive → 201', async () => {
      mockRunService.archiveRun.mockResolvedValueOnce({ archived: true })
      await request(app.getHttpServer()).post('/backtests/runs/archive').send({ runId: 'run-1', archived: true }).expect(201)
    })
    it('/backtests/runs/delete → 201', async () => {
      mockRunService.deleteRun.mockResolvedValueOnce({ deleted: true })
      await request(app.getHttpServer()).post('/backtests/runs/delete').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/star → 201', async () => {
      mockRunService.starRun.mockResolvedValueOnce({ starred: true })
      await request(app.getHttpServer()).post('/backtests/runs/star').send({ runId: 'run-1', starred: true }).expect(201)
    })
    it('/backtests/runs/retry → 201', async () => {
      mockRunService.retryRun.mockResolvedValueOnce({ retried: true })
      await request(app.getHttpServer()).post('/backtests/runs/retry').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/stats → 201', async () => {
      mockRunService.getStats.mockResolvedValueOnce({ total: 5, completed: 3 })
      await request(app.getHttpServer()).post('/backtests/runs/stats').send({}).expect(201)
    })
    it('/backtests/runs/rebalance-logs → 201', async () => {
      mockRunService.getRebalanceLogs.mockResolvedValueOnce({ items: [] })
      await request(app.getHttpServer()).post('/backtests/runs/rebalance-logs').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/monte-carlo → 201', async () => {
      mockMonteCarloService.runMonteCarloSimulation.mockResolvedValueOnce({ simulations: [] })
      await request(app.getHttpServer()).post('/backtests/runs/monte-carlo').send({ runId: 'run-1', numSimulations: 100 }).expect(201)
    })
    it('/backtests/runs/attribution → 201', async () => {
      mockAttributionService.brinson.mockResolvedValueOnce({ period: [], summary: {} })
      await request(app.getHttpServer()).post('/backtests/runs/attribution').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/cost-sensitivity → 201', async () => {
      mockCostSensitivityService.analyze.mockResolvedValueOnce({ sensitivities: [] })
      await request(app.getHttpServer()).post('/backtests/runs/cost-sensitivity').send({ runId: 'run-1' }).expect(201)
    })
    it('/backtests/runs/param-sensitivity → 201', async () => {
      mockParamSensitivityService.create.mockResolvedValueOnce({ sweepId: 'sw-1' })
      await request(app.getHttpServer()).post('/backtests/runs/param-sensitivity').send({
        runId: 'run-1', paramX: { paramKey: 'fast', values: [5, 10] }, paramY: { paramKey: 'slow', values: [20, 30] },
      }).expect(201)
    })
    it('/backtests/runs/param-sensitivity/result → 201', async () => {
      mockParamSensitivityService.getResult.mockResolvedValueOnce({ sweepId: 'sw-1', grid: [] })
      await request(app.getHttpServer()).post('/backtests/runs/param-sensitivity/result').send({ sweepId: 'sw-1' }).expect(201)
    })

    // Walk-Forward
    it('/backtests/walk-forward/runs → 201', async () => {
      mockWalkForwardService.createWalkForwardRun.mockResolvedValueOnce({ wfRunId: 'wf-1' })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs').send({
        name: 'WF Test', baseStrategyType: 'MA_CROSS_SINGLE', baseStrategyConfig: {},
        paramSearchSpace: {}, fullStartDate: '20230101', fullEndDate: '20231231',
        inSampleDays: 60, outOfSampleDays: 20, stepDays: 20, initialCapital: 100000,
      }).expect(201)
    })
    it('/backtests/walk-forward/runs/list → 201', async () => {
      mockWalkForwardService.listWalkForwardRuns.mockResolvedValueOnce({ items: [], total: 0 })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs/list').send({}).expect(201)
    })
    it('/backtests/walk-forward/runs/detail → 201', async () => {
      mockWalkForwardService.getWalkForwardRunDetail.mockResolvedValueOnce({ wfRunId: 'wf-1', windows: [] })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs/detail').send({ wfRunId: 'wf-1' }).expect(201)
    })
    it('/backtests/walk-forward/runs/equity → 201', async () => {
      mockWalkForwardService.getWalkForwardEquity.mockResolvedValueOnce({ equityCurve: [] })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs/equity').send({ wfRunId: 'wf-1' }).expect(201)
    })
    it('/backtests/walk-forward/runs/cancel → 201', async () => {
      mockWalkForwardService.cancelWalkForwardRun.mockResolvedValueOnce({ cancelled: true })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs/cancel').send({ wfRunId: 'wf-1' }).expect(201)
    })
    it('/backtests/walk-forward/runs/delete → 201', async () => {
      mockWalkForwardService.deleteWalkForwardRun.mockResolvedValueOnce({ deleted: true })
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs/delete').send({ wfRunId: 'wf-1' }).expect(201)
    })

    // Rolling
    it('/backtests/rolling/runs → 201', async () => {
      mockWalkForwardService.createWalkForwardRun.mockResolvedValueOnce({ wfRunId: 'wf-rolling' })
      await request(app.getHttpServer()).post('/backtests/rolling/runs').send({
        name: 'Rolling', strategyType: 'MA_CROSS_SINGLE', strategyConfig: {},
        rollingParamSpace: {}, startDate: '20230101', endDate: '20231231',
        lookbackDays: 60, holdingPeriodDays: 20, initialCapital: 100000,
      }).expect(201)
    })

    // Comparison
    it('/backtests/comparisons → 201', async () => {
      mockComparisonService.createComparison.mockResolvedValueOnce({ groupId: 'grp-1' })
      await request(app.getHttpServer()).post('/backtests/comparisons').send({
        name: 'comp', strategies: [
          { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { fast: 5, slow: 20 }, label: 'S1' },
          { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { fast: 10, slow: 30 }, label: 'S2' },
        ],
        startDate: '20230101', endDate: '20231231', initialCapital: 100000,
      }).expect(201)
    })
    it('/backtests/comparisons/detail → 201', async () => {
      mockComparisonService.getComparisonDetail.mockResolvedValueOnce({ groupId: 'grp-1', results: [] })
      await request(app.getHttpServer()).post('/backtests/comparisons/detail').send({ groupId: 'grp-1' }).expect(201)
    })
    it('/backtests/comparisons/equity → 201', async () => {
      mockComparisonService.getComparisonEquity.mockResolvedValueOnce({ curves: [] })
      await request(app.getHttpServer()).post('/backtests/comparisons/equity').send({ groupId: 'grp-1' }).expect(201)
    })
    it('/backtests/comparisons/list → 201', async () => {
      mockComparisonService.listComparisons.mockResolvedValueOnce({ items: [], total: 0 })
      await request(app.getHttpServer()).post('/backtests/comparisons/list').send({}).expect(201)
    })
  })

  // ── Walk-Forward DTO 校验 ──────────────────────────────────────────────

  describe('[DTO 校验] Walk-Forward', () => {
    it('缺 baseStrategyType → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs').send({
        name: 'WF', baseStrategyConfig: {}, paramSearchSpace: {},
        fullStartDate: '20230101', fullEndDate: '20231231',
        inSampleDays: 60, outOfSampleDays: 20, stepDays: 20, initialCapital: 100000,
      }).expect(400)
    })
    it('缺 fullStartDate → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs').send({
        name: 'WF', baseStrategyType: 'MA_CROSS_SINGLE', baseStrategyConfig: {},
        paramSearchSpace: {}, fullEndDate: '20231231',
        inSampleDays: 60, outOfSampleDays: 20, stepDays: 20, initialCapital: 100000,
      }).expect(400)
    })
    it('inSampleDays=0 → 400', async () => {
      await request(app.getHttpServer()).post('/backtests/walk-forward/runs').send({
        name: 'WF', baseStrategyType: 'MA_CROSS_SINGLE', baseStrategyConfig: {},
        paramSearchSpace: {}, fullStartDate: '20230101', fullEndDate: '20231231',
        inSampleDays: 0, outOfSampleDays: 20, stepDays: 20, initialCapital: 100000,
      }).expect(400)
    })
  })
})
