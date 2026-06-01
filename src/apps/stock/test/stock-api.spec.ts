/**
 * Stock 模块 API 测试 — 业务优先
 *
 * 覆盖：列表/搜索/详情/图表/资金流/财务/股东/融资/分析/选股/策略/字典
 * 方法：Test.createTestingModule + mock services + supertest
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
import { StockController } from '../stock.controller'
import { StockService } from '../stock.service'
import { StockAnalysisService } from '../stock-analysis.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Stock API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockStockService: Record<string, jest.Mock>
  let mockStockAnalysisService: Record<string, jest.Mock>

  const user = buildTestUser()

  beforeEach(async () => {
    mockStockService = {
      findAll: jest.fn().mockResolvedValue({ items: [{ tsCode: '000001.SZ', name: '平安银行' }], total: 1 }),
      getListSummary: jest.fn().mockResolvedValue({ total: 5000, exchanges: { SSE: 2000, SZSE: 3000 } }),
      search: jest.fn().mockResolvedValue([{ tsCode: '000001.SZ', name: '平安银行' }]),
      findOne: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', name: '平安银行', industry: '银行' }),
      getDetailOverview: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', pe: 12.5, pb: 0.8 }),
      getDetailChart: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', klines: [] }),
      getDetailMoneyFlow: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', flows: [] }),
      getDetailMainMoneyFlow: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', mainFlows: [] }),
      getDetailTodayFlow: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', todayFlow: {} }),
      getDetailFinancials: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', indicators: [] }),
      getDetailFinancialStatements: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', statements: [] }),
      getDetailShareholders: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', top10: [] }),
      getDetailShareCapital: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', capital: {} }),
      getDetailFinancing: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', financing: {} }),
      getStockConcepts: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', concepts: [] }),
      screener: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getScreenerPresets: jest.fn().mockResolvedValue({ presets: [] }),
      getScreenerConcepts: jest.fn().mockResolvedValue({ concepts: [] }),
      getStrategies: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      createStrategy: jest.fn().mockResolvedValue({ id: 1, name: '策略1' }),
      updateStrategy: jest.fn().mockResolvedValue({ id: 1, name: '更新后' }),
      deleteStrategy: jest.fn().mockResolvedValue({ success: true }),
      getIndustries: jest.fn().mockResolvedValue([{ industryCode: 'BANK', industryName: '银行' }]),
      getAreas: jest.fn().mockResolvedValue([{ areaCode: 'SH', areaName: '上海' }]),
    }

    mockStockAnalysisService = {
      getTechnicalIndicators: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', indicators: {} }),
      getTimingSignals: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', signals: [] }),
      getChipDistribution: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', distribution: {} }),
      getMarginData: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', margin: {} }),
      getRelativeStrength: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', rs: {} }),
      getTechnicalFactors: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', factors: {} }),
      getLatestFactors: jest.fn().mockResolvedValue({ tsCode: '000001.SZ', factors: {} }),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StockController],
      providers: [
        { provide: StockService, useValue: mockStockService },
        { provide: StockAnalysisService, useValue: mockStockAnalysisService },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalGuards({
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    })
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 列表与搜索 ──────────────────────────────────────────────────────────

  describe('列表与搜索', () => {
    it('ST-BIZ-001: 查询股票列表', async () => {
      const res = await req.post('/stock/list').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
      expect(res.body.data).toHaveProperty('total')
    })

    it('ST-BIZ-002: 查询列表汇总', async () => {
      const res = await req.post('/stock/list/summary').send({}).expect(201)
      expect(res.body.data).toHaveProperty('total')
    })

    it('ST-BIZ-003: 搜索股票', async () => {
      const res = await req.post('/stock/search').send({ keyword: '平安' }).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('ST-ERR-001: search 缺 keyword 应 400', async () => {
      await req.post('/stock/search').send({}).expect(400)
    })

    it('ST-ERR-002: search keyword 空应 400', async () => {
      await req.post('/stock/search').send({ keyword: '' }).expect(400)
    })

    it('ST-EDGE-001: list pageSize=100（最大）', async () => {
      await req.post('/stock/list').send({ pageSize: 100 }).expect(201)
    })

    it('ST-EDGE-002: list pageSize=101 应 400', async () => {
      await req.post('/stock/list').send({ pageSize: 101 }).expect(400)
    })

    it('ST-EDGE-003: search limit=20（最大）', async () => {
      await req.post('/stock/search').send({ keyword: '平安', limit: 20 }).expect(201)
    })

    it('ST-EDGE-004: search limit=21 应 400', async () => {
      await req.post('/stock/search').send({ keyword: '平安', limit: 21 }).expect(400)
    })
  })

  // ── 详情 ────────────────────────────────────────────────────────────────

  describe('详情', () => {
    it('ST-BIZ-004: 查询股票详情', async () => {
      const res = await req.post('/stock/detail').send({ code: '000001.SZ' }).expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
    })

    it('ST-BIZ-005: 查询股票概览', async () => {
      const res = await req.post('/stock/detail/overview').send({ code: '000001.SZ' }).expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
    })

    it('ST-ERR-003: detail 缺 code 应 400', async () => {
      await req.post('/stock/detail').send({}).expect(400)
    })

    it('ST-ERR-004: detail code 空应 400', async () => {
      await req.post('/stock/detail').send({ code: '' }).expect(400)
    })

    it('ST-EDGE-005: tradeDate 格式正确', async () => {
      await req.post('/stock/detail').send({ code: '000001.SZ', tradeDate: '20260523' }).expect(201)
    })

    it('ST-EDGE-006: tradeDate 格式错误应 400', async () => {
      await req.post('/stock/detail').send({ code: '000001.SZ', tradeDate: '2026-05-23' }).expect(400)
    })
  })

  // ── 图表 ────────────────────────────────────────────────────────────────

  describe('图表', () => {
    it('ST-BIZ-006: 查询 K 线', async () => {
      const res = await req.post('/stock/detail/chart').send({ tsCode: '000001.SZ' }).expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
    })

    it('ST-ERR-005: chart 缺 tsCode 应 400', async () => {
      await req.post('/stock/detail/chart').send({}).expect(400)
    })
  })

  // ── 资金流 ──────────────────────────────────────────────────────────────

  describe('资金流', () => {
    it('ST-BIZ-007: 查询资金流', async () => {
      await req.post('/stock/detail/money-flow').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-008: 查询主力流', async () => {
      await req.post('/stock/detail/main-money-flow').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-009: 查询今日流', async () => {
      await req.post('/stock/detail/today-flow').send({ code: '000001.SZ' }).expect(201)
    })

    it('ST-ERR-006: money-flow 缺 tsCode 应 400', async () => {
      await req.post('/stock/detail/money-flow').send({}).expect(400)
    })

    it('ST-EDGE-007: days=1（最小）', async () => {
      await req.post('/stock/detail/money-flow').send({ tsCode: '000001.SZ', days: 1 }).expect(201)
    })

    it('ST-EDGE-008: days=120（最大）', async () => {
      await req.post('/stock/detail/money-flow').send({ tsCode: '000001.SZ', days: 120 }).expect(201)
    })

    it('ST-EDGE-009: days=121 应 400', async () => {
      await req.post('/stock/detail/money-flow').send({ tsCode: '000001.SZ', days: 121 }).expect(400)
    })
  })

  // ── 财务 ────────────────────────────────────────────────────────────────

  describe('财务', () => {
    it('ST-BIZ-010: 查询财务指标', async () => {
      await req.post('/stock/detail/financials').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-011: 查询财务报表', async () => {
      await req.post('/stock/detail/financial-statements').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-ERR-007: financials 缺 tsCode 应 400', async () => {
      await req.post('/stock/detail/financials').send({}).expect(400)
    })
  })

  // ── 股东与股本 ──────────────────────────────────────────────────────────

  describe('股东与股本', () => {
    it('ST-BIZ-012: 查询股东', async () => {
      await req.post('/stock/detail/shareholders').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-013: 查询股本', async () => {
      await req.post('/stock/detail/share-capital').send({ tsCode: '000001.SZ' }).expect(201)
    })
  })

  // ── 融资 ────────────────────────────────────────────────────────────────

  describe('融资', () => {
    it('ST-BIZ-014: 查询融资融券', async () => {
      await req.post('/stock/detail/financing').send({ tsCode: '000001.SZ' }).expect(201)
    })
  })

  // ── 分析 ────────────────────────────────────────────────────────────────

  describe('分析', () => {
    it('ST-BIZ-015: 技术指标', async () => {
      await req.post('/stock/detail/analysis/technical').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-016: 择时信号', async () => {
      await req.post('/stock/detail/analysis/timing-signals').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-017: 筹码分布', async () => {
      await req.post('/stock/detail/analysis/chip-distribution').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-018: 两融数据', async () => {
      await req.post('/stock/detail/analysis/margin').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-019: 相对强弱', async () => {
      await req.post('/stock/detail/analysis/relative-strength').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-020: 技术因子', async () => {
      await req.post('/stock/detail/analysis/factors').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-021: 最新因子', async () => {
      await req.post('/stock/detail/analysis/factors/latest').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-BIZ-022: 概念列表', async () => {
      await req.post('/stock/detail/concepts').send({ tsCode: '000001.SZ' }).expect(201)
    })

    it('ST-ERR-008: technical 缺 tsCode 应 400', async () => {
      await req.post('/stock/detail/analysis/technical').send({}).expect(400)
    })

    it('ST-EDGE-010: technical days=30（最小）', async () => {
      await req.post('/stock/detail/analysis/technical').send({ tsCode: '000001.SZ', days: 30 }).expect(201)
    })

    it('ST-EDGE-011: technical days=500（最大）', async () => {
      await req.post('/stock/detail/analysis/technical').send({ tsCode: '000001.SZ', days: 500 }).expect(201)
    })

    it('ST-EDGE-012: technical days=29 应 400', async () => {
      await req.post('/stock/detail/analysis/technical').send({ tsCode: '000001.SZ', days: 29 }).expect(400)
    })
  })

  // ── 选股 ────────────────────────────────────────────────────────────────

  describe('选股', () => {
    it('ST-BIZ-023: 条件选股', async () => {
      const res = await req.post('/stock/screener').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('ST-BIZ-024: 获取预设', async () => {
      const res = await req.post('/stock/screener/presets').send({}).expect(201)
      expect(res.body.data).toHaveProperty('presets')
    })

    it('ST-BIZ-025: 获取概念列表', async () => {
      const res = await req.post('/stock/screener/concepts').send({}).expect(201)
      expect(res.body.data).toHaveProperty('concepts')
    })
  })

  // ── 选股策略 ────────────────────────────────────────────────────────────

  describe('选股策略', () => {
    it('ST-BIZ-026: 查询策略列表', async () => {
      const res = await req.post('/stock/screener/strategies/list').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('ST-BIZ-027: 创建策略', async () => {
      const res = await req.post('/stock/screener/strategies').send({
        name: '低估值选股',
        filters: { minPeTtm: 5, maxPeTtm: 15 },
      }).expect(201)
      expect(res.body.data).toHaveProperty('id')
    })

    it('ST-BIZ-028: 更新策略', async () => {
      const res = await req.post('/stock/screener/strategies/update').send({
        id: 1,
        name: '更新后策略',
      }).expect(201)
      expect(res.body.data).toHaveProperty('id')
    })

    it('ST-BIZ-029: 删除策略', async () => {
      const res = await req.post('/stock/screener/strategies/delete').send({ id: 1 }).expect(201)
      expect(res.body.data).toHaveProperty('success')
    })

    it('ST-ERR-009: 创建缺 name 应 400', async () => {
      await req.post('/stock/screener/strategies').send({ filters: {} }).expect(400)
    })

    it('ST-ERR-010: 创建缺 filters 应 400', async () => {
      await req.post('/stock/screener/strategies').send({ name: 'test' }).expect(400)
    })
  })

  // ── 行业/地域 ──────────────────────────────────────────────────────────

  describe('行业/地域', () => {
    it('ST-BIZ-030: 行业字典', async () => {
      const res = await req.post('/stock/industries').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('ST-BIZ-031: 地域字典', async () => {
      const res = await req.post('/stock/areas').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
    })
  })

  // ── 安全 ────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('ST-SEC-001: 无 Token 创建策略应 401', async () => {
      const unauthModuleRef = await Test.createTestingModule({
        controllers: [StockController],
        providers: [
          { provide: StockService, useValue: mockStockService },
          { provide: StockAnalysisService, useValue: mockStockAnalysisService },
        ],
      }).compile()

      const unauthApp = unauthModuleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalGuards({
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      })
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/stock/screener/strategies/list')
        .expect(401)
      await unauthApp.close()
    })
  })
})
