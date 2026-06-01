/**
 * Watchlist 模块 API 测试 — 业务优先
 *
 * 覆盖：自选组 CRUD / 成员管理 / 批量操作 / 汇总 / 安全
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { WatchlistController } from '../watchlist.controller'
import { WatchlistService } from '../watchlist.service'

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

describe('Watchlist API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockService: Record<string, jest.Mock>

  const user = buildTestUser()

  const mockWatchlist = {
    id: 1,
    userId: 1,
    name: '我的自选',
    description: '测试描述',
    isDefault: true,
    sortOrder: 0,
    stockCount: 2,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }

  const mockStock = {
    id: 1,
    watchlistId: 1,
    tsCode: '000001.SZ',
    stockName: '平安银行',
    industry: '银行',
    area: '深圳',
    notes: null,
    tags: [],
    targetPrice: null,
    sortOrder: 0,
    addedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    quote: null,
  }

  beforeEach(async () => {
    mockService = {
      getWatchlists: jest.fn().mockResolvedValue([mockWatchlist]),
      getOverview: jest.fn().mockResolvedValue({
        watchlists: [
          {
            id: 1,
            name: '我的自选',
            description: null,
            isDefault: true,
            sortOrder: 0,
            stockCount: 1,
            summary: { stockCount: 1, upCount: 1, downCount: 0, flatCount: 0, avgPctChg: 1.5, totalMv: 100000, latestTradeDate: '20260523', staleCount: 0 },
          },
        ],
      }),
      createWatchlist: jest.fn().mockResolvedValue(mockWatchlist),
      reorderWatchlists: jest.fn().mockResolvedValue({ message: '排序已更新' }),
      updateWatchlist: jest.fn().mockResolvedValue({ ...mockWatchlist, name: '更新后' }),
      deleteWatchlist: jest.fn().mockResolvedValue({ message: '删除成功' }),
      getStocks: jest.fn().mockResolvedValue({ stocks: [mockStock] }),
      addStock: jest.fn().mockResolvedValue(mockStock),
      batchAddStocks: jest.fn().mockResolvedValue({ added: 2, skipped: 0, skippedCodes: [] }),
      reorderStocks: jest.fn().mockResolvedValue({ message: '排序已更新' }),
      updateStock: jest.fn().mockResolvedValue({ ...mockStock, notes: '备注' }),
      batchRemoveStocks: jest.fn().mockResolvedValue({ removed: 2 }),
      removeStock: jest.fn().mockResolvedValue({ message: '移除成功' }),
      getWatchlistSummary: jest.fn().mockResolvedValue({
        stockCount: 1,
        upCount: 1,
        downCount: 0,
        flatCount: 0,
        avgPctChg: 1.5,
        totalMv: 100000,
      }),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WatchlistController],
      providers: [{ provide: WatchlistService, useValue: mockService }],
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

  // ── 自选组 CRUD ──────────────────────────────────────────────────────────

  describe('自选组 CRUD', () => {
    it('WL-BIZ-001: 获取自选组列表', async () => {
      const res = await req.post('/watchlist/list').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data[0]).toHaveProperty('name')
    })

    it('WL-BIZ-002: 获取概览', async () => {
      const res = await req.post('/watchlist/overview').send({}).expect(201)
      expect(res.body.data).toHaveProperty('watchlists')
      expect(Array.isArray(res.body.data.watchlists)).toBe(true)
    })

    it('WL-BIZ-003: 创建自选组', async () => {
      const res = await req.post('/watchlist/create').send({ name: '新自选组' }).expect(201)
      expect(res.body.data).toHaveProperty('id')
      expect(res.body.data).toHaveProperty('name')
    })

    it('WL-BIZ-004: 更新自选组', async () => {
      const res = await req
        .post('/watchlist/update')
        .send({ id: 1, name: '更新后' })
        .expect(201)
      expect(res.body.data).toHaveProperty('name')
    })

    it('WL-BIZ-005: 删除自选组', async () => {
      const res = await req.post('/watchlist/delete').send({ id: 1 }).expect(201)
      expect(res.body.data).toHaveProperty('message')
    })

    it('WL-BIZ-006: 重排自选组', async () => {
      const res = await req
        .post('/watchlist/reorder')
        .send({ items: [{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 1 }] })
        .expect(201)
      expect(res.body.data).toHaveProperty('message')
    })

    it('WL-ERR-001: create 缺 name 应 400', async () => {
      await req.post('/watchlist/create').send({}).expect(400)
    })

    it('WL-ERR-002: create name 空应 400', async () => {
      await req.post('/watchlist/create').send({ name: '' }).expect(400)
    })

    it('WL-ERR-003: create name 超 50 字符应 400', async () => {
      await req.post('/watchlist/create').send({ name: 'a'.repeat(51) }).expect(400)
    })

    it('WL-ERR-004: create description 超 200 字符应 400', async () => {
      await req
        .post('/watchlist/create')
        .send({ name: 'test', description: 'a'.repeat(201) })
        .expect(400)
    })

    it('WL-ERR-005: update name 空字符串应 400', async () => {
      await req.post('/watchlist/update').send({ id: 1, name: '' }).expect(400)
    })

    it('WL-EDGE-001: create name 恰好 50 字符', async () => {
      await req.post('/watchlist/create').send({ name: 'a'.repeat(50) }).expect(201)
    })

    it('WL-EDGE-002: create description 恰好 200 字符', async () => {
      await req
        .post('/watchlist/create')
        .send({ name: 'test', description: 'a'.repeat(200) })
        .expect(201)
    })
  })

  // ── 股票成员管理 ────────────────────────────────────────────────────────

  describe('股票成员管理', () => {
    it('WL-BIZ-007: 获取组内股票列表', async () => {
      const res = await req.post('/watchlist/stocks/list').send({ id: 1 }).expect(201)
      expect(res.body.data).toHaveProperty('stocks')
      expect(Array.isArray(res.body.data.stocks)).toBe(true)
    })

    it('WL-BIZ-008: 添加单只股票', async () => {
      const res = await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ' })
        .expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
    })

    it('WL-BIZ-009: 批量添加股票', async () => {
      const res = await req
        .post('/watchlist/stocks/batch')
        .send({
          id: 1,
          stocks: [
            { tsCode: '000001.SZ' },
            { tsCode: '000002.SZ' },
          ],
        })
        .expect(201)
      expect(res.body.data).toHaveProperty('added')
      expect(res.body.data).toHaveProperty('skipped')
    })

    it('WL-BIZ-010: 更新股票备注', async () => {
      const res = await req
        .post('/watchlist/stocks/update')
        .send({ id: 1, stockId: 1, notes: '备注' })
        .expect(201)
      expect(res.body.data).toHaveProperty('notes')
    })

    it('WL-BIZ-011: 移除股票', async () => {
      const res = await req
        .post('/watchlist/stocks/delete')
        .send({ id: 1, stockId: 1 })
        .expect(201)
      expect(res.body.data).toHaveProperty('message')
    })

    it('WL-BIZ-012: 批量移除股票', async () => {
      const res = await req
        .post('/watchlist/stocks/batch/delete')
        .send({ id: 1, stockIds: [1, 2] })
        .expect(201)
      expect(res.body.data).toHaveProperty('removed')
    })

    it('WL-BIZ-013: 重排股票', async () => {
      const res = await req
        .post('/watchlist/stocks/reorder')
        .send({ id: 1, items: [{ id: 1, sortOrder: 0 }] })
        .expect(201)
      expect(res.body.data).toHaveProperty('message')
    })

    it('WL-ERR-006: addStock 缺 tsCode 应 400', async () => {
      await req.post('/watchlist/stocks').send({ id: 1 }).expect(400)
    })

    it('WL-ERR-007: addStock tsCode 格式错误应 400', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: 'INVALID' })
        .expect(400)
    })

    it('WL-ERR-008: addStock targetPrice 负数应 400', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', targetPrice: -1 })
        .expect(400)
    })

    it('WL-ERR-009: addStock notes 超 500 字符应 400', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', notes: 'a'.repeat(501) })
        .expect(400)
    })

    it('WL-ERR-010: batchAdd stocks 空数组应 400', async () => {
      await req
        .post('/watchlist/stocks/batch')
        .send({ id: 1, stocks: [] })
        .expect(400)
    })

    it('WL-ERR-011: batchAdd stocks 超 50 个应 400', async () => {
      const stocks = Array.from({ length: 51 }, (_, i) => ({
        tsCode: `${String(i).padStart(6, '0')}.SZ`,
      }))
      await req
        .post('/watchlist/stocks/batch')
        .send({ id: 1, stocks })
        .expect(400)
    })

    it('WL-ERR-012: batchRemove stockIds 空数组应 400', async () => {
      await req
        .post('/watchlist/stocks/batch/delete')
        .send({ id: 1, stockIds: [] })
        .expect(400)
    })

    it('WL-ERR-013: batchRemove stockIds 超 50 个应 400', async () => {
      const stockIds = Array.from({ length: 51 }, (_, i) => i + 1)
      await req
        .post('/watchlist/stocks/batch/delete')
        .send({ id: 1, stockIds })
        .expect(400)
    })

    it('WL-ERR-014: addStock tags 超 10 个应 400', async () => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`)
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', tags })
        .expect(400)
    })

    it('WL-ERR-015: addStock tag 超 30 字符应 400', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', tags: ['a'.repeat(31)] })
        .expect(400)
    })

    it('WL-EDGE-003: addStock tsCode 北交所格式', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '830799.BJ' })
        .expect(201)
    })

    it('WL-EDGE-004: batchAdd 恰好 50 个', async () => {
      const stocks = Array.from({ length: 50 }, (_, i) => ({
        tsCode: `${String(i).padStart(6, '0')}.SZ`,
      }))
      await req
        .post('/watchlist/stocks/batch')
        .send({ id: 1, stocks })
        .expect(201)
    })

    it('WL-EDGE-005: batchRemove 恰好 50 个', async () => {
      const stockIds = Array.from({ length: 50 }, (_, i) => i + 1)
      await req
        .post('/watchlist/stocks/batch/delete')
        .send({ id: 1, stockIds })
        .expect(201)
    })

    it('WL-EDGE-006: addStock tags 恰好 10 个', async () => {
      const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`)
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', tags })
        .expect(201)
    })

    it('WL-EDGE-007: addStock tag 恰好 30 字符', async () => {
      await req
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ', tags: ['a'.repeat(30)] })
        .expect(201)
    })
  })

  // ── 汇总 ────────────────────────────────────────────────────────────────

  describe('汇总', () => {
    it('WL-BIZ-014: 获取行情汇总', async () => {
      const res = await req.post('/watchlist/summary').send({ id: 1 }).expect(201)
      expect(res.body.data).toHaveProperty('stockCount')
      expect(res.body.data).toHaveProperty('upCount')
      expect(res.body.data).toHaveProperty('downCount')
    })
  })

  // ── 安全 ────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('WL-SEC-001: 无 Token 访问 list 应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [WatchlistController],
        providers: [{ provide: WatchlistService, useValue: mockService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            const { UnauthorizedException } = require('@nestjs/common')
            throw new UnauthorizedException()
          },
        })
        .compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer()).post('/watchlist/list').expect(401)
      await unauthApp.close()
    })

    it('WL-SEC-002: 无 Token 创建自选组应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [WatchlistController],
        providers: [{ provide: WatchlistService, useValue: mockService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            const { UnauthorizedException } = require('@nestjs/common')
            throw new UnauthorizedException()
          },
        })
        .compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/watchlist/create')
        .send({ name: 'test' })
        .expect(401)
      await unauthApp.close()
    })

    it('WL-SEC-003: 无 Token 添加股票应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [WatchlistController],
        providers: [{ provide: WatchlistService, useValue: mockService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(): boolean {
            const { UnauthorizedException } = require('@nestjs/common')
            throw new UnauthorizedException()
          },
        })
        .compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/watchlist/stocks')
        .send({ id: 1, tsCode: '000001.SZ' })
        .expect(401)
      await unauthApp.close()
    })
  })
})
