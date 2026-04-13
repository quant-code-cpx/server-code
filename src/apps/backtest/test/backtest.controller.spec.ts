import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
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

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
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
}

const mockRegistryService = { getTemplates: jest.fn() }
const mockWalkForwardService = {
  createWalkForwardRun: jest.fn(),
  listWalkForwardRuns: jest.fn(),
  getWalkForwardRunDetail: jest.fn(),
  getWalkForwardEquity: jest.fn(),
}
const mockComparisonService = {
  createComparison: jest.fn(),
  getComparisonDetail: jest.fn(),
  getComparisonEquity: jest.fn(),
}
const mockMonteCarloService = { runMonteCarloSimulation: jest.fn() }
const mockAttributionService = {
  analyze: jest.fn(),
}
const mockCostSensitivityService = {
  analyze: jest.fn(),
}
const mockParamSensitivityService = {
  analyze: jest.fn(),
}

const SUCCESS_CODE = 0

describe('BacktestController', () => {
  let app: INestApplication

  beforeAll(async () => {
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
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /backtests/runs → 201 with code 200000', async () => {
    const mockRun = { runId: 'run-1', status: 'PENDING' }
    mockRunService.createRun.mockResolvedValueOnce(mockRun)

    await request(app.getHttpServer())
      .post('/backtests/runs')
      .send({
        strategyType: 'MA_CROSS_SINGLE',
        strategyConfig: { fast: 5, slow: 20 },
        startDate: '20230101',
        endDate: '20231231',
        initialCapital: 100000,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toMatchObject(mockRun)
      })
  })

  it('POST /backtests/runs/list → 201, data exists', async () => {
    const mockList = { items: [], total: 0, page: 1, pageSize: 20 }
    mockRunService.listRuns.mockResolvedValueOnce(mockList)

    await request(app.getHttpServer())
      .post('/backtests/runs/list')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /backtests/runs/detail → 201', async () => {
    const mockDetail = { runId: 'run-1', status: 'COMPLETED' }
    mockRunService.getRunDetail.mockResolvedValueOnce(mockDetail)

    await request(app.getHttpServer())
      .post('/backtests/runs/detail')
      .send({ runId: 'run-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toMatchObject(mockDetail)
      })
  })

  it('POST /backtests/runs/validate → 201', async () => {
    const mockValidation = { valid: true, warnings: [] }
    mockRunService.validateRun.mockResolvedValueOnce(mockValidation)

    await request(app.getHttpServer())
      .post('/backtests/runs/validate')
      .send({
        strategyType: 'MA_CROSS_SINGLE',
        strategyConfig: { fast: 5, slow: 20 },
        startDate: '20230101',
        endDate: '20231231',
        initialCapital: 100000,
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toMatchObject(mockValidation)
      })
  })

  it('POST /backtests/strategy-templates → 201', async () => {
    const mockTemplates = [{ id: 'tmpl-1', name: 'MA Cross' }]
    mockRegistryService.getTemplates.mockResolvedValueOnce(mockTemplates)

    await request(app.getHttpServer())
      .post('/backtests/strategy-templates')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })
})
