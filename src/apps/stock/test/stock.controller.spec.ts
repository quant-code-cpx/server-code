import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
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
    const res = await request(app.getHttpServer())
      .post('/stock/search')
      .send({ keyword: '平安' })
      .expect(201)
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
    const res = await request(app.getHttpServer())
      .post('/stock/screener/strategies/list')
      .send({})
      .expect(201)
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
})


