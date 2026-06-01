/**
 * Export 模块 API 测试 — 业务优先
 *
 * 覆盖：回测导出/因子导出/持仓导出/股票列表导出/异动导出/筛选导出
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest
 *
 * 注意：Export 控制器使用 @Res({ passthrough: true }) 设置 Content-Type: text/csv，
 *       supertest 不会自动解析 JSON body，需用 JSON.parse(res.text) 获取 ResponseModel。
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ExportController } from '../export.controller'
import { ExportService } from '../export.service'
import { ForbiddenException, NotFoundException } from '@nestjs/common'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

/** 解析 text/csv 响应为 JSON (ResponseModel 格式) */
function parseResponse(res: request.Response) {
  return JSON.parse(res.text)
}

describe('Export API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockExportService: Record<string, jest.Mock>

  const user = buildTestUser()

  const mockCsv = 'col1,col2\r\nval1,val2'
  const mockResult = { filename: 'test_export.csv', csv: mockCsv }

  beforeEach(async () => {
    mockExportService = {
      exportBacktestTrades: jest.fn().mockResolvedValue(mockResult),
      exportFactorValues: jest.fn().mockResolvedValue(mockResult),
      exportPortfolioHoldings: jest.fn().mockResolvedValue(mockResult),
      exportStockList: jest.fn().mockResolvedValue(mockResult),
      exportAlertAnomalies: jest.fn().mockResolvedValue(mockResult),
      exportFactorScreening: jest.fn().mockResolvedValue(mockResult),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [
        { provide: ExportService, useValue: mockExportService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext): boolean {
          ctx.switchToHttp().getRequest().user = user
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 回测交易导出 ──────────────────────────────────────────────────────────

  describe('回测交易导出', () => {
    it('EX-BIZ-001: 导出回测交易明细', async () => {
      const res = await req.post('/export/backtest-trades').send({ runId: 'run-abc-123' }).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportBacktestTrades).toHaveBeenCalledWith('run-abc-123', user.id)
    })

    it('EX-ERR-001: 缺少 runId 应 400', async () => {
      await req.post('/export/backtest-trades').send({}).expect(400)
    })

    it('EX-ERR-002: runId 空字符串应 400', async () => {
      await req.post('/export/backtest-trades').send({ runId: '' }).expect(400)
    })

    it('EX-SEC-001: 非本人回测运行应 403', async () => {
      mockExportService.exportBacktestTrades.mockRejectedValue(new ForbiddenException('无权访问此回测运行'))
      const res = await req.post('/export/backtest-trades').send({ runId: 'other-run' }).expect(403)
      const body = parseResponse(res)
      expect(body.message).toContain('无权')
    })
  })

  // ── 因子快照导出 ──────────────────────────────────────────────────────────

  describe('因子快照导出', () => {
    it('EX-BIZ-002: 导出因子快照数据', async () => {
      const res = await req.post('/export/factor-values').send({ factorId: 'pe_ttm' }).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportFactorValues).toHaveBeenCalledWith({
        factorId: 'pe_ttm',
        userId: user.id,
        startDate: undefined,
        endDate: undefined,
      })
    })

    it('EX-BIZ-003: 带日期范围导出因子', async () => {
      const res = await req
        .post('/export/factor-values')
        .send({ factorId: 'pe_ttm', startDate: '20240101', endDate: '20240131' })
        .expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportFactorValues).toHaveBeenCalledWith({
        factorId: 'pe_ttm',
        userId: user.id,
        startDate: '20240101',
        endDate: '20240131',
      })
    })

    it('EX-ERR-003: 缺少 factorId 应 400', async () => {
      await req.post('/export/factor-values').send({}).expect(400)
    })

    it('EX-ERR-004: factorId 空字符串应 400', async () => {
      await req.post('/export/factor-values').send({ factorId: '' }).expect(400)
    })

    it('EX-ERR-005: startDate 格式错误应 400', async () => {
      await req.post('/export/factor-values').send({ factorId: 'pe_ttm', startDate: '2024-01-01' }).expect(400)
    })

    it('EX-ERR-006: endDate 格式错误应 400', async () => {
      await req.post('/export/factor-values').send({ factorId: 'pe_ttm', endDate: '2024/01/31' }).expect(400)
    })

    it('EX-ERR-007: 因子不存在应 404', async () => {
      mockExportService.exportFactorValues.mockRejectedValue(new NotFoundException('因子 "nonexistent" 不存在'))
      const res = await req.post('/export/factor-values').send({ factorId: 'nonexistent' }).expect(404)
      const body = parseResponse(res)
      expect(body.message).toContain('不存在')
    })

    it('EX-ERR-008: 因子已禁用应 404', async () => {
      mockExportService.exportFactorValues.mockRejectedValue(new NotFoundException('因子 "disabled_factor" 已禁用'))
      const res = await req.post('/export/factor-values').send({ factorId: 'disabled_factor' }).expect(404)
      const body = parseResponse(res)
      expect(body.message).toContain('禁用')
    })
  })

  // ── 持仓导出 ──────────────────────────────────────────────────────────────

  describe('持仓导出', () => {
    it('EX-BIZ-004: 导出持仓数据', async () => {
      const res = await req.post('/export/portfolio-holdings').send({ portfolioId: 'port-abc' }).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportPortfolioHoldings).toHaveBeenCalledWith('port-abc', user.id)
    })

    it('EX-ERR-009: 缺少 portfolioId 应 400', async () => {
      await req.post('/export/portfolio-holdings').send({}).expect(400)
    })

    it('EX-ERR-010: portfolioId 空字符串应 400', async () => {
      await req.post('/export/portfolio-holdings').send({ portfolioId: '' }).expect(400)
    })

    it('EX-SEC-002: 非本人投资组合应 403', async () => {
      mockExportService.exportPortfolioHoldings.mockRejectedValue(new ForbiddenException('无权访问此投资组合'))
      const res = await req.post('/export/portfolio-holdings').send({ portfolioId: 'other-port' }).expect(403)
      const body = parseResponse(res)
      expect(body.message).toContain('无权')
    })
  })

  // ── 股票列表导出 ──────────────────────────────────────────────────────────

  describe('股票列表导出', () => {
    it('EX-BIZ-005: 默认导出股票列表', async () => {
      const res = await req.post('/export/stock-list').send({}).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportStockList).toHaveBeenCalled()
    })

    it('EX-BIZ-006: 指定列导出', async () => {
      const res = await req
        .post('/export/stock-list')
        .send({ columns: ['tsCode', 'name', 'peTtm'] })
        .expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
    })

    it('EX-ERR-011: columns 含非法列名应 400', async () => {
      await req.post('/export/stock-list').send({ columns: ['tsCode', 'hacker_col'] }).expect(400)
    })

    it('EX-ERR-012: columns 超过 25 列应 400', async () => {
      const tooManyCols = Array.from({ length: 26 }, (_, i) => `col${i}`)
      await req.post('/export/stock-list').send({ columns: tooManyCols }).expect(400)
    })

    it('EX-EDGE-001: columns 空数组（使用默认列）应 201', async () => {
      const res = await req.post('/export/stock-list').send({ columns: [] }).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
    })
  })

  // ── 异动监控导出 ──────────────────────────────────────────────────────────

  describe('异动监控导出', () => {
    it('EX-BIZ-007: 指定日期导出异动', async () => {
      const res = await req.post('/export/alert-anomalies').send({ tradeDate: '20240524' }).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportAlertAnomalies).toHaveBeenCalledWith({ tradeDate: '20240524' })
    })

    it('EX-BIZ-008: 不传日期导出异动', async () => {
      const res = await req.post('/export/alert-anomalies').send({}).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
    })

    it('EX-ERR-013: tradeDate 格式错误应 400', async () => {
      await req.post('/export/alert-anomalies').send({ tradeDate: '2024-05-24' }).expect(400)
    })

    it('EX-EDGE-002: 数据库无异动记录', async () => {
      const emptyCsv = 'tradeDate,tsCode,stockName,anomalyType,value,threshold,strength,scannedAt\r\n'
      mockExportService.exportAlertAnomalies.mockResolvedValue({
        filename: 'alert_anomalies_empty.csv',
        csv: emptyCsv,
      })
      const res = await req.post('/export/alert-anomalies').send({}).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(emptyCsv)
    })
  })

  // ── 多因子筛选导出 ────────────────────────────────────────────────────────

  describe('多因子筛选导出', () => {
    const validScreeningBody = {
      conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 15 }],
      tradeDate: '20240524',
    }

    it('EX-BIZ-009: 导出多因子筛选结果', async () => {
      const res = await req.post('/export/factor-screening').send(validScreeningBody).expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
      expect(mockExportService.exportFactorScreening).toHaveBeenCalled()
    })

    it('EX-BIZ-010: 指定自定义列导出', async () => {
      const res = await req
        .post('/export/factor-screening')
        .send({ ...validScreeningBody, columns: ['tsCode', 'name', 'pe_ttm'] })
        .expect(201)
      const body = parseResponse(res)
      expect(body.data).toBe(mockCsv)
    })

    it('EX-ERR-014: 缺少 conditions 应 400', async () => {
      await req.post('/export/factor-screening').send({ tradeDate: '20240524' }).expect(400)
    })

    it('EX-ERR-015: 缺少 tradeDate 应 400', async () => {
      await req
        .post('/export/factor-screening')
        .send({ conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 15 }] })
        .expect(400)
    })

    it('EX-ERR-016: tradeDate 格式错误应 400', async () => {
      await req
        .post('/export/factor-screening')
        .send({ ...validScreeningBody, tradeDate: '2024-05-24' })
        .expect(400)
    })
  })

  // ── 安全 ──────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('EX-SEC-003: 无 Token 访问 backtest-trades 应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [ExportController],
        providers: [
          { provide: ExportService, useValue: mockExportService },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            throw new (require('@nestjs/common').UnauthorizedException)()
          },
        })
        .compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/export/backtest-trades')
        .send({ runId: 'some-run' })
        .expect(401)
      await unauthApp.close()
    })

    it('EX-SEC-004: 无 Token 访问 stock-list 应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [ExportController],
        providers: [
          { provide: ExportService, useValue: mockExportService },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            throw new (require('@nestjs/common').UnauthorizedException)()
          },
        })
        .compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/export/stock-list')
        .send({})
        .expect(401)
      await unauthApp.close()
    })
  })
})
