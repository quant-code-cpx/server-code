/**
 * Report 模块 API 测试 — 业务优先
 *
 * 覆盖：回测报告、个股研报、组合报告、策略研究报告、列表查询、详情、删除、定时任务
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ReportController } from '../report.controller'
import { ReportService } from '../report.service'

// ── helpers ──────────────────────────────────────────────────────────────────

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

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

// ── mock services ────────────────────────────────────────────────────────────

const user = buildTestUser()

const mockReportService = {
  createBacktestReport: jest.fn().mockResolvedValue({ id: 'rpt-1', type: 'BACKTEST', title: '回测报告', status: 'COMPLETED' }),
  createStockReport: jest.fn().mockResolvedValue({ id: 'rpt-2', type: 'STOCK', title: '个股报告', status: 'COMPLETED' }),
  createPortfolioReport: jest.fn().mockResolvedValue({ id: 'rpt-3', type: 'PORTFOLIO', title: '组合报告', status: 'COMPLETED' }),
  createStrategyResearchReport: jest.fn().mockResolvedValue({ id: 'rpt-4', type: 'STRATEGY_RESEARCH', title: '策略研究报告', status: 'COMPLETED' }),
  queryReports: jest.fn().mockResolvedValue({ items: [{ id: 'rpt-1', type: 'BACKTEST', title: '回测报告' }], total: 1, page: 1, pageSize: 20 }),
  getReportDetail: jest.fn().mockResolvedValue({ id: 'rpt-1', type: 'BACKTEST', title: '回测报告', status: 'COMPLETED', data: {} }),
  deleteReport: jest.fn().mockResolvedValue({ deleted: true }),
}

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = user
    return true
  }),
}

// ── [BIZ] 正常业务路径 ──────────────────────────────────────────────────────

describe('Report API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [{ provide: ReportService, useValue: mockReportService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  // ── 生成报告 ────────────────────────────────────────────────────────────────

  it('[BIZ] POST /report/backtest → 201, 生成回测报告', async () => {
    const res = await req.post('/report/backtest').send({ runId: 'run-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toBeDefined()
    expect(mockReportService.createBacktestReport).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/stock → 201, 生成个股研报', async () => {
    const res = await req.post('/report/stock').send({ tsCode: '000001.SZ' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createStockReport).toHaveBeenCalledWith(
      expect.objectContaining({ tsCode: '000001.SZ' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/portfolio → 201, 生成组合报告', async () => {
    const res = await req.post('/report/portfolio').send({ portfolioId: 'port-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createPortfolioReport).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: 'port-1' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/strategy-research → 201, 生成策略研究报告', async () => {
    const res = await req
      .post('/report/strategy-research')
      .send({ backtestRunId: 'run-1' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createStrategyResearchReport).toHaveBeenCalledWith(
      expect.objectContaining({ backtestRunId: 'run-1' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/backtest format=HTML → 201', async () => {
    const res = await req
      .post('/report/backtest')
      .send({ runId: 'run-1', format: 'HTML' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createBacktestReport).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'HTML' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/backtest format=PDF → 201', async () => {
    const res = await req
      .post('/report/backtest')
      .send({ runId: 'run-1', format: 'PDF' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  // ── 查询 ────────────────────────────────────────────────────────────────────

  it('[BIZ] POST /report/list → 201, 查询报告列表', async () => {
    const res = await req.post('/report/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toBeDefined()
  })

  it('[BIZ] POST /report/list type=BACKTEST → 201, 按类型过滤', async () => {
    const res = await req.post('/report/list').send({ type: 'BACKTEST' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.queryReports).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BACKTEST' }),
      user.id,
    )
  })

  it('[BIZ] POST /report/detail → 201, 获取报告详情', async () => {
    const res = await req.post('/report/detail').send({ reportId: 'rpt-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.getReportDetail).toHaveBeenCalledWith('rpt-1', user.id)
  })

  it('[BIZ] POST /report/delete → 201, 删除报告', async () => {
    const res = await req.post('/report/delete').send({ reportId: 'rpt-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.deleteReport).toHaveBeenCalledWith('rpt-1', user.id)
  })

  it('[BIZ] POST /report/schedules/list → 201, 查询定时任务列表', async () => {
    const res = await req.post('/report/schedules/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toEqual({ items: [], total: 0 })
  })

  // ── [ERR] DTO 校验 ─────────────────────────────────────────────────────────

  it('[ERR] POST /report/backtest 缺 runId → 400', async () => {
    const res = await req.post('/report/backtest').send({}).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/stock 缺 tsCode → 400', async () => {
    const res = await req.post('/report/stock').send({}).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/portfolio 缺 portfolioId → 400', async () => {
    const res = await req.post('/report/portfolio').send({}).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/strategy-research 缺 backtestRunId → 400', async () => {
    const res = await req.post('/report/strategy-research').send({}).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/backtest format=DOCX（非法枚举）→ 400', async () => {
    const res = await req
      .post('/report/backtest')
      .send({ runId: 'run-1', format: 'DOCX' })
      .expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/list page=0 → 400', async () => {
    const res = await req.post('/report/list').send({ page: 0 }).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/list pageSize=0 → 400', async () => {
    const res = await req.post('/report/list').send({ pageSize: 0 }).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/list pageSize=101 → 400', async () => {
    const res = await req.post('/report/list').send({ pageSize: 101 }).expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/strategy-research sections=字符串 → 400', async () => {
    const res = await req
      .post('/report/strategy-research')
      .send({ backtestRunId: 'run-1', sections: 'invalid' })
      .expect(400)
    expect(res.body.code).not.toBe(0)
  })

  // ── [ERR] 业务异常透传 ─────────────────────────────────────────────────────

  it('[ERR] POST /report/detail 报告不存在 → 200 code=0 (BusinessException)', async () => {
    mockReportService.getReportDetail.mockRejectedValueOnce(new Error('报告不存在或无权访问'))
    const res = await req.post('/report/detail').send({ reportId: 'nonexistent' }).expect(500)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/delete 报告不存在 → 500 (service error)', async () => {
    mockReportService.deleteReport.mockRejectedValueOnce(new Error('报告不存在或无权访问'))
    const res = await req.post('/report/delete').send({ reportId: 'nonexistent' }).expect(500)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/backtest 回测记录不存在 → service error', async () => {
    mockReportService.createBacktestReport.mockRejectedValueOnce(
      new Error('回测记录不存在或无权访问'),
    )
    const res = await req.post('/report/backtest').send({ runId: 'bad-run' }).expect(500)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/stock 股票代码不存在 → service error', async () => {
    mockReportService.createStockReport.mockRejectedValueOnce(new Error('股票代码不存在'))
    const res = await req.post('/report/stock').send({ tsCode: '999999.SZ' }).expect(500)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /report/portfolio 组合不存在 → service error', async () => {
    mockReportService.createPortfolioReport.mockRejectedValueOnce(
      new Error('组合不存在或无权访问'),
    )
    const res = await req.post('/report/portfolio').send({ portfolioId: 'bad-port' }).expect(500)
    expect(res.body.code).not.toBe(0)
  })

  // ── [EDGE] 边界值 ──────────────────────────────────────────────────────────

  it('[EDGE] POST /report/list page=1（最小） → 201', async () => {
    const res = await req.post('/report/list').send({ page: 1 }).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[EDGE] POST /report/list pageSize=1（最小） → 201', async () => {
    const res = await req.post('/report/list').send({ pageSize: 1 }).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[EDGE] POST /report/list pageSize=100（最大） → 201', async () => {
    const res = await req.post('/report/list').send({ pageSize: 100 }).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[EDGE] POST /report/strategy-research sections 全部 false → 201', async () => {
    const res = await req
      .post('/report/strategy-research')
      .send({
        backtestRunId: 'run-1',
        sections: { performance: false, holdings: false, riskAssessment: false, tradeLog: false },
      })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[EDGE] POST /report/strategy-research 带所有可选字段 → 201', async () => {
    const res = await req
      .post('/report/strategy-research')
      .send({
        backtestRunId: 'run-1',
        strategyId: 'strat-1',
        portfolioId: 'port-1',
        title: '自定义标题',
        format: 'HTML',
        sections: { performance: true, holdings: true, riskAssessment: true, tradeLog: true },
      })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createStrategyResearchReport).toHaveBeenCalledWith(
      expect.objectContaining({
        backtestRunId: 'run-1',
        strategyId: 'strat-1',
        portfolioId: 'port-1',
        title: '自定义标题',
        format: 'HTML',
      }),
      user.id,
    )
  })

  it('[EDGE] POST /report/backtest 带 title → 201', async () => {
    const res = await req
      .post('/report/backtest')
      .send({ runId: 'run-1', title: '自定义回测报告' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createBacktestReport).toHaveBeenCalledWith(
      expect.objectContaining({ title: '自定义回测报告' }),
      user.id,
    )
  })
})

// ── [SEC] 安全 — 未认证 ─────────────────────────────────────────────────────

describe('Report API [SEC] 安全', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [{ provide: ReportService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (_ctx: ExecutionContext) => {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException('用户未登录')
        },
      })
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())

  it('[SEC] 无 Token 访问 /report/detail → 401', async () => {
    await request(app.getHttpServer()).post('/report/detail').send({ reportId: 'rpt-1' }).expect(401)
  })

  it('[SEC] 无 Token 访问 /report/backtest → 401', async () => {
    await request(app.getHttpServer()).post('/report/backtest').send({ runId: 'run-1' }).expect(401)
  })

  it('[SEC] 无 Token 访问 /report/delete → 401', async () => {
    await request(app.getHttpServer()).post('/report/delete').send({ reportId: 'rpt-1' }).expect(401)
  })
})
