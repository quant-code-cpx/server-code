import { INestApplication, UnauthorizedException, NotFoundException, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import request from 'supertest'
import { StockController } from '../stock.controller'
import { StockService } from '../stock.service'
import { StockAnalysisService } from '../stock-analysis.service'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { TokenPayload } from 'src/shared/token.interface'

const testUser: TokenPayload = {
  id: 1,
  account: 'test',
  nickname: 'Test',
  role: UserRole.USER,
  jti: 'jti-1',
}

// Registered as APP_GUARD so it runs for all routes (stock controller has no
// class-level @UseGuards). Injecting req.user makes @CurrentUser() work on
// the screener strategy endpoints.
const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockStockService = {
  findAll: jest.fn(async () => ({ items: [], total: 0 })),
  search: jest.fn(async () => []),
  findOne: jest.fn(async () => ({})),
  getDetailOverview: jest.fn(async () => ({})),
  getDetailChart: jest.fn(async () => ({ klines: [] })),
  getDetailMoneyFlow: jest.fn(async () => ({ items: [] })),
  getDetailFinancials: jest.fn(async () => ({ items: [] })),
  getDetailShareholders: jest.fn(async () => ({})),
  getDetailMainMoneyFlow: jest.fn(async () => ({ items: [] })),
  getDetailShareCapital: jest.fn(async () => ({})),
  getDetailFinancing: jest.fn(async () => ({ items: [] })),
  getDetailTodayFlow: jest.fn(async () => ({})),
  getDetailFinancialStatements: jest.fn(async () => ({})),
  getStockConcepts: jest.fn(async () => []),
  screener: jest.fn(async () => ({ items: [], total: 0 })),
  getScreenerPresets: jest.fn(async () => []),
  getScreenerConcepts: jest.fn(async () => []),
  getListSummary: jest.fn(async () => ({})),
  getStrategies: jest.fn(async () => []),
  createStrategy: jest.fn(async () => ({ id: 1 })),
  updateStrategy: jest.fn(async () => ({ id: 1 })),
  deleteStrategy: jest.fn(async () => ({ id: 1 })),
  getIndustries: jest.fn(async () => []),
  getAreas: jest.fn(async () => []),
}

const mockStockAnalysisService = {
  getTechnicalIndicators: jest.fn(async () => ({})),
  getTimingSignals: jest.fn(async () => ({})),
  getChipDistribution: jest.fn(async () => ({})),
  getMarginData: jest.fn(async () => ({})),
  getRelativeStrength: jest.fn(async () => ({})),
  getTechnicalFactors: jest.fn(async () => ({ tsCode: '000001.SZ', count: 0, items: [] })),
  getLatestFactors: jest.fn(async () => ({ tsCode: '000001.SZ', tradeDate: null, close: null, macdSignal: null, kdjSignal: null, rsiSignal: null, bollPosition: null, raw: null })),
}

describe('StockController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StockController],
      providers: [
        { provide: StockService, useValue: mockStockService },
        { provide: StockAnalysisService, useValue: mockStockAnalysisService },
        // APP_GUARD applies globally; stock controller has no @UseGuards(), so
        // this is the only way to inject req.user for @CurrentUser() endpoints.
        { provide: APP_GUARD, useValue: mockJwtGuard },
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockJwtGuard.canActivate.mockImplementation((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest()
      req.user = testUser
      return true
    })
  })

  // NestJS defaults @Post handlers to HTTP 201 Created.
  it('POST /stock/list → 201, data has items and total', async () => {
    const res = await request(app.getHttpServer()).post('/stock/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('items')
    expect(res.body.data).toHaveProperty('total')
    expect(mockStockService.findAll).toHaveBeenCalledTimes(1)
  })

  it('POST /stock/search → 201, data is array', async () => {
    const res = await request(app.getHttpServer()).post('/stock/search').send({ keyword: '平安' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(mockStockService.search).toHaveBeenCalledWith(expect.objectContaining({ keyword: '平安' }))
  })

  // StockSearchDto requires keyword (@IsString @IsNotEmpty), so empty body → 400
  it('POST /stock/search with missing keyword → 400 (DTO validation)', async () => {
    await request(app.getHttpServer()).post('/stock/search').send({}).expect(400)
    expect(mockStockService.search).not.toHaveBeenCalled()
  })

  it('POST /stock/screener → 201, data has items and total', async () => {
    const res = await request(app.getHttpServer()).post('/stock/screener').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('items')
    expect(mockStockService.screener).toHaveBeenCalledTimes(1)
  })

  it('POST /stock/industries → 201, data is array', async () => {
    const res = await request(app.getHttpServer()).post('/stock/industries').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(mockStockService.getIndustries).toHaveBeenCalledTimes(1)
  })

  // @CurrentUser() reads req.user injected by the APP_GUARD mock
  it('POST /stock/screener/strategies/list → 201, calls getStrategies with user id', async () => {
    const res = await request(app.getHttpServer()).post('/stock/screener/strategies/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockStockService.getStrategies).toHaveBeenCalledWith(testUser.id)
  })

  // When the APP_GUARD throws UnauthorizedException → 401
  it('POST /stock/screener/strategies/list with rejected guard → 401', async () => {
    mockJwtGuard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException()
    })
    await request(app.getHttpServer()).post('/stock/screener/strategies/list').send({}).expect(401)
  })

  // StockDetailDto requires code (@IsString @IsNotEmpty)
  it('[VAL] POST /stock/detail 缺 code → 400', async () => {
    await request(app.getHttpServer()).post('/stock/detail').send({}).expect(400)
    expect(mockStockService.findOne).not.toHaveBeenCalled()
  })

  // StockDetailFinancialsDto requires tsCode (@IsString @IsNotEmpty)
  it('[VAL] POST /stock/detail/financials 缺 tsCode → 400', async () => {
    await request(app.getHttpServer()).post('/stock/detail/financials').send({}).expect(400)
    expect(mockStockService.getDetailFinancials).not.toHaveBeenCalled()
  })

  it('[ERR] POST /stock/detail NotFoundException → 404', async () => {
    mockStockService.findOne.mockRejectedValueOnce(new NotFoundException('stock not found'))
    await request(app.getHttpServer()).post('/stock/detail').send({ code: '000001.SZ' }).expect(404)
    expect(mockStockService.findOne).toHaveBeenCalledTimes(1)
  })

  it('POST /stock/detail/analysis/factors → 201, data 含 count/items', async () => {
    const res = await request(app.getHttpServer())
      .post('/stock/detail/analysis/factors')
      .send({ tsCode: '000001.SZ' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('count')
    expect(res.body.data).toHaveProperty('items')
    expect(mockStockAnalysisService.getTechnicalFactors).toHaveBeenCalledTimes(1)
  })

  it('[VAL] POST /stock/detail/analysis/factors 缺 tsCode → 400', async () => {
    await request(app.getHttpServer()).post('/stock/detail/analysis/factors').send({}).expect(400)
    expect(mockStockAnalysisService.getTechnicalFactors).not.toHaveBeenCalled()
  })

  it('POST /stock/detail/analysis/factors/latest → 201, data 含 tsCode/tradeDate', async () => {
    const res = await request(app.getHttpServer())
      .post('/stock/detail/analysis/factors/latest')
      .send({ tsCode: '000001.SZ' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('tsCode')
    expect(mockStockAnalysisService.getLatestFactors).toHaveBeenCalledTimes(1)
  })

  it('[VAL] POST /stock/detail/analysis/factors/latest 缺 tsCode → 400', async () => {
    await request(app.getHttpServer()).post('/stock/detail/analysis/factors/latest').send({}).expect(400)
    expect(mockStockAnalysisService.getLatestFactors).not.toHaveBeenCalled()
  })

  // ── 补充剩余端点冒烟 ───────────────────────────────────────────────────
  const detailEndpoints: Array<[string, jest.Mock, Record<string, unknown>]> = [
    ['/stock/list/summary', mockStockService.getListSummary as jest.Mock, {}],
    ['/stock/detail/overview', mockStockService.getDetailOverview as jest.Mock, { code: '000001.SZ' }],
    ['/stock/detail/chart', mockStockService.getDetailChart as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/money-flow', mockStockService.getDetailMoneyFlow as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/shareholders', mockStockService.getDetailShareholders as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/main-money-flow', mockStockService.getDetailMainMoneyFlow as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/share-capital', mockStockService.getDetailShareCapital as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/financing', mockStockService.getDetailFinancing as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/today-flow', mockStockService.getDetailTodayFlow as jest.Mock, { code: '000001.SZ' }],
    ['/stock/detail/financial-statements', mockStockService.getDetailFinancialStatements as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/concepts', mockStockService.getStockConcepts as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/analysis/technical', mockStockAnalysisService.getTechnicalIndicators as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/analysis/timing-signals', mockStockAnalysisService.getTimingSignals as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/analysis/chip-distribution', mockStockAnalysisService.getChipDistribution as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/analysis/margin', mockStockAnalysisService.getMarginData as jest.Mock, { tsCode: '000001.SZ' }],
    ['/stock/detail/analysis/relative-strength', mockStockAnalysisService.getRelativeStrength as jest.Mock, { tsCode: '000001.SZ', benchmarkCode: '000300.SH' }],
    ['/stock/screener/presets', mockStockService.getScreenerPresets as jest.Mock, {}],
    ['/stock/screener/concepts', mockStockService.getScreenerConcepts as jest.Mock, {}],
    ['/stock/areas', mockStockService.getAreas as jest.Mock, {}],
  ]

  detailEndpoints.forEach(([path, svcMock, body]) => {
    it(`[BIZ] POST ${path} → 201`, async () => {
      svcMock.mockResolvedValueOnce(svcMock === mockStockService.getAreas ? [] : {})
      await request(app.getHttpServer()).post(path).send(body).expect(201).expect((res: any) => {
        expect(res.body.code).toBe(0)
      })
    })
  })
})
