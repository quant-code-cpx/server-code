import { INestApplication, UnauthorizedException, NotFoundException, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import request from 'supertest'
import { WatchlistController } from '../watchlist.controller'
import { WatchlistService } from '../watchlist.service'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { TokenPayload } from 'src/shared/token.interface'

const testUser: TokenPayload = {
  id: 1,
  account: 'test',
  nickname: 'Test',
  role: UserRole.USER,
  jti: 'jti-1',
}

// Inject testUser so @CurrentUser() reads it; also acts as the @UseGuards(JwtAuthGuard) override
const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockWatchlistService = {
  getWatchlists: jest.fn(async () => []),
  getOverview: jest.fn(async () => ({ watchlists: [] })),
  createWatchlist: jest.fn(async () => ({ id: 1, name: '自选1', userId: 1 })),
  reorderWatchlists: jest.fn(async () => ({ message: '排序已更新' })),
  updateWatchlist: jest.fn(async () => ({ id: 1, name: 'Updated' })),
  deleteWatchlist: jest.fn(async () => ({ message: '删除成功' })),
  getStocks: jest.fn(async () => ({ stocks: [] })),
  addStock: jest.fn(async () => ({ id: 1, watchlistId: 1, tsCode: '000001.SZ' })),
  batchAddStocks: jest.fn(async () => ({ added: 1, skipped: 0 })),
  reorderStocks: jest.fn(async () => ({ message: '排序已更新' })),
  updateStock: jest.fn(async () => ({})),
  batchRemoveStocks: jest.fn(async () => ({ removed: 1 })),
  removeStock: jest.fn(async () => ({ message: '移除成功' })),
  getWatchlistSummary: jest.fn(async () => ({
    stockCount: 0,
    upCount: 0,
    downCount: 0,
    flatCount: 0,
    avgPctChg: 0,
    totalMv: 0,
  })),
}

describe('WatchlistController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    // overrideGuard() is the correct NestJS testing API for replacing a guard
    // referenced via @UseGuards(JwtAuthGuard) at the controller class level.
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WatchlistController],
      providers: [{ provide: WatchlistService, useValue: mockWatchlistService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

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
  it('POST /watchlist/list → 201, data is array', async () => {
    const res = await request(app.getHttpServer()).post('/watchlist/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(mockWatchlistService.getWatchlists).toHaveBeenCalledWith(testUser.id)
  })

  it('POST /watchlist/create with valid name → 201, data.id present', async () => {
    const res = await request(app.getHttpServer())
      .post('/watchlist/create')
      .send({ name: '自选1' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.id).toBe(1)
    expect(mockWatchlistService.createWatchlist).toHaveBeenCalledWith(
      testUser.id,
      expect.objectContaining({ name: '自选1' }),
    )
  })

  // CreateWatchlistDto.name has @IsString() + @MinLength(1); missing name → 400
  it('POST /watchlist/create with missing name → 400 (DTO validation)', async () => {
    await request(app.getHttpServer()).post('/watchlist/create').send({}).expect(400)
    expect(mockWatchlistService.createWatchlist).not.toHaveBeenCalled()
  })

  it('POST /watchlist/delete with id → 201', async () => {
    const res = await request(app.getHttpServer()).post('/watchlist/delete').send({ id: 1 }).expect(201)
    expect(res.body.code).toBe(0)
    expect(mockWatchlistService.deleteWatchlist).toHaveBeenCalledWith(testUser.id, 1)
  })

  it('POST /watchlist/overview → 201', async () => {
    const res = await request(app.getHttpServer()).post('/watchlist/overview').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('watchlists')
    expect(mockWatchlistService.getOverview).toHaveBeenCalledWith(testUser.id)
  })

  // When the guard throws UnauthorizedException → 401
  it('POST /watchlist/list with rejected guard → 401', async () => {
    mockJwtGuard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException()
    })
    await request(app.getHttpServer()).post('/watchlist/list').send({}).expect(401)
  })

  it('[ERR] POST /watchlist/overview NotFoundException → 404', async () => {
    mockWatchlistService.getOverview.mockRejectedValueOnce(new NotFoundException('watchlist not found'))
    await request(app.getHttpServer()).post('/watchlist/overview').send({}).expect(404)
  })
})


