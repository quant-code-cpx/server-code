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
import { ReportController } from '../report.controller'
import { ReportService } from '../report.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockReportService = {
  createBacktestReport: jest.fn(),
  createStockReport: jest.fn(),
  createPortfolioReport: jest.fn(),
  createStrategyResearchReport: jest.fn(),
  queryReports: jest.fn(),
  getReportDetail: jest.fn(),
  deleteReport: jest.fn(),
}

// ── [BIZ] 正常业务路径 ─────────────────────────────────────────────────────────

describe('ReportController', () => {
  let app: INestApplication

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST /report/backtest → 201', async () => {
    mockReportService.createBacktestReport.mockResolvedValueOnce({ reportId: 'r-1' })
    const res = await request(app.getHttpServer()).post('/report/backtest').send({ runId: 'run-1' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockReportService.createBacktestReport).toHaveBeenCalledTimes(1)
  })

  it('[BIZ] POST /report/list → 201', async () => {
    mockReportService.queryReports.mockResolvedValueOnce({ items: [], total: 0 })
    const res = await request(app.getHttpServer()).post('/report/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  // ── [VAL] DTO 校验 ─────────────────────────────────────────────────────────

  it('[VAL] POST /report/backtest 缺 runId → 400', async () => {
    await request(app.getHttpServer()).post('/report/backtest').send({}).expect(400)
  })

  it('[VAL] POST /report/backtest format 非法枚举值 → 400', async () => {
    await request(app.getHttpServer()).post('/report/backtest').send({ runId: 'run-1', format: 'DOCX' }).expect(400)
  })

  // ── [ERR] 异常透传 ──────────────────────────────────────────────────────────

  it('[ERR] POST /report/detail → service 抛 NotFoundException → 404', async () => {
    mockReportService.getReportDetail.mockRejectedValueOnce(new NotFoundException('报告不存在'))
    const res = await request(app.getHttpServer()).post('/report/detail').send({ reportId: 'nonexistent' }).expect(404)
    expect(res.body.code).not.toBe(0)
  })
})

// ── [AUTH] 权限边界 ────────────────────────────────────────────────────────────

describe('ReportController ([AUTH] 权限边界)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [{ provide: ReportService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (_ctx: ExecutionContext) => {
          throw new UnauthorizedException('用户未登录')
        },
      })
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())

  it('[AUTH] 未登录访问 /report/list → 401', async () => {
    await request(app.getHttpServer()).post('/report/list').send({}).expect(401)
  })
})
