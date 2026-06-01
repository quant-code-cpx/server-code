/**
 * Market 模块 API 测试 — 业务优先
 *
 * 覆盖：资金流/板块/沪深港通/指数/情绪/估值/成交/宽度/概念/叙事/异动/日期
 * 方法：Test.createTestingModule + mock services + supertest
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { MarketController } from '../market.controller'
import { MarketService } from '../market.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('Market API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockMarketService: Record<string, jest.Mock>

  const user = buildTestUser()

  beforeEach(async () => {
    mockMarketService = {
      getMarketMoneyFlow: jest.fn().mockResolvedValue({ total: {}, levels: [] }),
      getSectorFlow: jest.fn().mockResolvedValue({ sectors: [] }),
      getMarketSentiment: jest.fn().mockResolvedValue({ up: 1000, down: 2000, flat: 500 }),
      getMarketValuation: jest.fn().mockResolvedValue({ peTtm: 15.5, pb: 1.8, pePercentile: 40 }),
      getIndexQuote: jest.fn().mockResolvedValue([{ tsCode: '000001.SH', name: '上证指数', close: 3200 }]),
      getHsgtFlow: jest.fn().mockResolvedValue({ northbound: [], southbound: [] }),
      getIndexTrend: jest.fn().mockResolvedValue({ tsCode: '000001.SH', dates: [], closes: [] }),
      getIndexQuoteWithSparkline: jest.fn().mockResolvedValue({ items: [] }),
      getChangeDistribution: jest.fn().mockResolvedValue({ bins: [] }),
      getSectorRanking: jest.fn().mockResolvedValue({ sectors: [] }),
      getVolumeOverview: jest.fn().mockResolvedValue({ data: [] }),
      getSentimentTrend: jest.fn().mockResolvedValue({ data: [] }),
      getValuationTrend: jest.fn().mockResolvedValue({ data: [] }),
      getMoneyFlowTrend: jest.fn().mockResolvedValue({ data: [] }),
      getSectorFlowRanking: jest.fn().mockResolvedValue({ sectors: [] }),
      getSectorFlowTrend: jest.fn().mockResolvedValue({ data: [] }),
      getHsgtTrend: jest.fn().mockResolvedValue({ data: [] }),
      getMainFlowRanking: jest.fn().mockResolvedValue({ data: [] }),
      getStockFlowDetail: jest.fn().mockResolvedValue({ data: [] }),
      getMarketBreadth: jest.fn().mockResolvedValue({ limitUp: 50, limitDown: 10 }),
      getConceptList: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getConceptMembers: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getDailyNarrative: jest.fn().mockResolvedValue({ tone: 'neutral', score: 50 }),
      getTopMovers: jest.fn().mockResolvedValue({ items: [] }),
      getDataDates: jest.fn().mockResolvedValue({ dates: {} }),
      getSectorTopBottom: jest.fn().mockResolvedValue({ topGainers: [], topLosers: [] }),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [
        { provide: MarketService, useValue: mockMarketService },
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

  // ── 资金流 ──────────────────────────────────────────────────────────────

  describe('资金流', () => {
    it('MK-BIZ-001: 查询市场资金流向', async () => {
      const res = await req.post('/market/money-flow').send({}).expect(201)
      expect(res.body.data).toHaveProperty('total')
    })

    it('MK-BIZ-002: 查询资金流向趋势', async () => {
      const res = await req.post('/market/money-flow-trend').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-BIZ-003: 查询主力资金排行', async () => {
      const res = await req.post('/market/main-flow-ranking').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-BIZ-004: 查询个股资金明细', async () => {
      const res = await req.post('/market/stock-flow-detail').send({ ts_code: '000001.SZ' }).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-ERR-001: stock-flow-detail 缺 ts_code 应 400', async () => {
      await req.post('/market/stock-flow-detail').send({}).expect(400)
    })

    it('MK-ERR-002: stock-flow-detail ts_code 空应 400', async () => {
      await req.post('/market/stock-flow-detail').send({ ts_code: '' }).expect(400)
    })

    it('MK-EDGE-001: hsgt-flow days=1（最小）', async () => {
      await req.post('/market/hsgt-flow').send({ days: 1 }).expect(201)
    })

    it('MK-EDGE-002: hsgt-flow days=365（最大）', async () => {
      await req.post('/market/hsgt-flow').send({ days: 365 }).expect(201)
    })

    it('MK-EDGE-003: hsgt-flow days=366 应 400', async () => {
      await req.post('/market/hsgt-flow').send({ days: 366 }).expect(400)
    })

    it('MK-EDGE-004: money-flow-trend days=5（最小）', async () => {
      await req.post('/market/money-flow-trend').send({ days: 5 }).expect(201)
    })

    it('MK-EDGE-005: money-flow-trend days=120（最大）', async () => {
      await req.post('/market/money-flow-trend').send({ days: 120 }).expect(201)
    })

    it('MK-EDGE-006: money-flow-trend days=4 应 400', async () => {
      await req.post('/market/money-flow-trend').send({ days: 4 }).expect(400)
    })

    it('MK-EDGE-007: stock-flow-detail days=5（最小）', async () => {
      await req.post('/market/stock-flow-detail').send({ ts_code: '000001.SZ', days: 5 }).expect(201)
    })

    it('MK-EDGE-008: stock-flow-detail days=60（最大）', async () => {
      await req.post('/market/stock-flow-detail').send({ ts_code: '000001.SZ', days: 60 }).expect(201)
    })

    it('MK-EDGE-009: stock-flow-detail days=61 应 400', async () => {
      await req.post('/market/stock-flow-detail').send({ ts_code: '000001.SZ', days: 61 }).expect(400)
    })

    it('MK-EDGE-010: main-flow-ranking limit=100（最大）', async () => {
      await req.post('/market/main-flow-ranking').send({ limit: 100 }).expect(201)
    })

    it('MK-EDGE-011: main-flow-ranking limit=101 应 400', async () => {
      await req.post('/market/main-flow-ranking').send({ limit: 101 }).expect(400)
    })
  })

  // ── 板块 ────────────────────────────────────────────────────────────────

  describe('板块', () => {
    it('MK-BIZ-005: 查询板块资金流向', async () => {
      const res = await req.post('/market/sector-flow').send({}).expect(201)
      expect(res.body.data).toHaveProperty('sectors')
    })

    it('MK-BIZ-006: 查询板块涨跌排行', async () => {
      const res = await req.post('/market/sector-ranking').send({}).expect(201)
      expect(res.body.data).toHaveProperty('sectors')
    })

    it('MK-BIZ-007: 查询板块资金排行', async () => {
      const res = await req.post('/market/sector-flow-ranking').send({}).expect(201)
      expect(res.body.data).toHaveProperty('sectors')
    })

    it('MK-BIZ-008: 查询板块资金趋势', async () => {
      const res = await req.post('/market/sector-flow-trend').send({ ts_code: 'BK0475' }).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-BIZ-009: 查询板块涨跌双榜', async () => {
      const res = await req.post('/market/sector-top-bottom').send({}).expect(201)
      expect(res.body.data).toHaveProperty('topGainers')
    })

    it('MK-ERR-003: sector-flow-trend 缺 ts_code 应 400', async () => {
      await req.post('/market/sector-flow-trend').send({}).expect(400)
    })

    it('MK-ERR-004: sector-flow-trend ts_code 空应 400', async () => {
      await req.post('/market/sector-flow-trend').send({ ts_code: '' }).expect(400)
    })

    it('MK-ERR-005: sector-flow content_type 无效应 400', async () => {
      await req.post('/market/sector-flow').send({ content_type: 'INVALID' }).expect(400)
    })

    it('MK-ERR-006: sector-ranking sort_by 无效应 400', async () => {
      await req.post('/market/sector-ranking').send({ sort_by: 'invalid' }).expect(400)
    })

    it('MK-ERR-007: sector-flow-ranking content_type 无效应 400', async () => {
      await req.post('/market/sector-flow-ranking').send({ content_type: 'INVALID' }).expect(400)
    })

    it('MK-ERR-008: sector-flow-ranking order 无效应 400', async () => {
      await req.post('/market/sector-flow-ranking').send({ order: 'invalid' }).expect(400)
    })

    it('MK-EDGE-012: sector-flow limit=100（最大）', async () => {
      await req.post('/market/sector-flow').send({ limit: 100 }).expect(201)
    })

    it('MK-EDGE-013: sector-flow limit=101 应 400', async () => {
      await req.post('/market/sector-flow').send({ limit: 101 }).expect(400)
    })

    it('MK-EDGE-014: sector-ranking limit=500（最大）', async () => {
      await req.post('/market/sector-ranking').send({ limit: 500 }).expect(201)
    })

    it('MK-EDGE-015: sector-ranking limit=501 应 400', async () => {
      await req.post('/market/sector-ranking').send({ limit: 501 }).expect(400)
    })

    it('MK-EDGE-016: sector-flow-trend days=5（最小）', async () => {
      await req.post('/market/sector-flow-trend').send({ ts_code: 'BK0475', days: 5 }).expect(201)
    })

    it('MK-EDGE-017: sector-flow-trend days=60（最大）', async () => {
      await req.post('/market/sector-flow-trend').send({ ts_code: 'BK0475', days: 60 }).expect(201)
    })

    it('MK-EDGE-018: sector-flow-trend days=61 应 400', async () => {
      await req.post('/market/sector-flow-trend').send({ ts_code: 'BK0475', days: 61 }).expect(400)
    })

    it('MK-EDGE-019: sector-top-bottom top_n=20（最大）', async () => {
      await req.post('/market/sector-top-bottom').send({ top_n: 20 }).expect(201)
    })

    it('MK-EDGE-020: sector-top-bottom top_n=21 应 400', async () => {
      await req.post('/market/sector-top-bottom').send({ top_n: 21 }).expect(400)
    })
  })

  // ── 沪深港通 ────────────────────────────────────────────────────────────

  describe('沪深港通', () => {
    it('MK-BIZ-010: 查询沪深港通资金流向', async () => {
      const res = await req.post('/market/hsgt-flow').send({}).expect(201)
      expect(res.body.data).toHaveProperty('northbound')
    })

    it('MK-BIZ-011: 查询沪深港通趋势', async () => {
      const res = await req.post('/market/hsgt-trend').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-ERR-009: hsgt-trend period 无效应 400', async () => {
      await req.post('/market/hsgt-trend').send({ period: '2y' }).expect(400)
    })
  })

  // ── 指数 ────────────────────────────────────────────────────────────────

  describe('指数', () => {
    it('MK-BIZ-012: 查询指数行情', async () => {
      const res = await req.post('/market/index-quote').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('MK-BIZ-013: 查询指数走势', async () => {
      const res = await req.post('/market/index-trend').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
    })

    it('MK-BIZ-014: 查询指数行情+sparkline', async () => {
      const res = await req.post('/market/index-quote-with-sparkline').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('MK-ERR-010: index-trend period 无效应 400', async () => {
      await req.post('/market/index-trend').send({ period: '2y' }).expect(400)
    })

    it('MK-ERR-011: index-quote ts_codes 非数组应 400', async () => {
      await req.post('/market/index-quote').send({ ts_codes: 'not-an-array' }).expect(400)
    })

    it('MK-ERR-012: index-quote-with-sparkline sparkline_period 无效应 400', async () => {
      await req.post('/market/index-quote-with-sparkline').send({ sparkline_period: '2y' }).expect(400)
    })
  })

  // ── 情绪与估值 ──────────────────────────────────────────────────────────

  describe('情绪与估值', () => {
    it('MK-BIZ-015: 查询市场情绪', async () => {
      const res = await req.post('/market/sentiment').send({}).expect(201)
      expect(res.body.data).toHaveProperty('up')
    })

    it('MK-BIZ-016: 查询情绪趋势', async () => {
      const res = await req.post('/market/sentiment-trend').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-BIZ-017: 查询市场估值', async () => {
      const res = await req.post('/market/valuation').send({}).expect(201)
      expect(res.body.data).toHaveProperty('peTtm')
    })

    it('MK-BIZ-018: 查询估值趋势', async () => {
      const res = await req.post('/market/valuation-trend').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-ERR-013: valuation-trend period 无效应 400', async () => {
      await req.post('/market/valuation-trend').send({ period: '2y' }).expect(400)
    })

    it('MK-EDGE-021: sentiment-trend days=5（最小）', async () => {
      await req.post('/market/sentiment-trend').send({ days: 5 }).expect(201)
    })

    it('MK-EDGE-022: sentiment-trend days=120（最大）', async () => {
      await req.post('/market/sentiment-trend').send({ days: 120 }).expect(201)
    })

    it('MK-EDGE-023: sentiment-trend days=4 应 400', async () => {
      await req.post('/market/sentiment-trend').send({ days: 4 }).expect(400)
    })
  })

  // ── 成交与宽度 ──────────────────────────────────────────────────────────

  describe('成交与宽度', () => {
    it('MK-BIZ-019: 查询成交额概况', async () => {
      const res = await req.post('/market/volume-overview').send({}).expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('MK-BIZ-020: 查询涨跌幅分布', async () => {
      const res = await req.post('/market/change-distribution').send({}).expect(201)
      expect(res.body.data).toHaveProperty('bins')
    })

    it('MK-BIZ-021: 查询市场宽度', async () => {
      const res = await req.post('/market/market-breadth').send({}).expect(201)
      expect(res.body.data).toHaveProperty('limitUp')
    })

    it('MK-EDGE-024: volume-overview days=5（最小）', async () => {
      await req.post('/market/volume-overview').send({ days: 5 }).expect(201)
    })

    it('MK-EDGE-025: volume-overview days=120（最大）', async () => {
      await req.post('/market/volume-overview').send({ days: 120 }).expect(201)
    })

    it('MK-EDGE-026: volume-overview days=4 应 400', async () => {
      await req.post('/market/volume-overview').send({ days: 4 }).expect(400)
    })
  })

  // ── 概念 ────────────────────────────────────────────────────────────────

  describe('概念', () => {
    it('MK-BIZ-022: 查询概念列表', async () => {
      const res = await req.post('/market/concept/list').send({}).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('MK-BIZ-023: 查询概念成分股', async () => {
      const res = await req.post('/market/concept/members').send({ tsCode: '885835.TI' }).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('MK-ERR-014: concept/members 缺 tsCode 应 400', async () => {
      await req.post('/market/concept/members').send({}).expect(400)
    })

    it('MK-ERR-015: concept/members tsCode 空应 400', async () => {
      await req.post('/market/concept/members').send({ tsCode: '' }).expect(400)
    })

    it('MK-EDGE-027: concept/list pageSize=100（最大）', async () => {
      await req.post('/market/concept/list').send({ pageSize: 100 }).expect(201)
    })

    it('MK-EDGE-028: concept/list pageSize=101 应 400', async () => {
      await req.post('/market/concept/list').send({ pageSize: 101 }).expect(400)
    })

    it('MK-EDGE-029: concept/members pageSize=200（最大）', async () => {
      await req.post('/market/concept/members').send({ tsCode: '885835.TI', pageSize: 200 }).expect(201)
    })

    it('MK-EDGE-030: concept/members pageSize=201 应 400', async () => {
      await req.post('/market/concept/members').send({ tsCode: '885835.TI', pageSize: 201 }).expect(400)
    })
  })

  // ── 叙事与异动 ──────────────────────────────────────────────────────────

  describe('叙事与异动', () => {
    it('MK-BIZ-024: 查询当日叙事', async () => {
      const res = await req.post('/market/daily-narrative').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tone')
    })

    it('MK-BIZ-025: 查询异动个股', async () => {
      const res = await req.post('/market/top-movers').send({ dim: 'gain' }).expect(201)
      expect(res.body.data).toHaveProperty('items')
    })

    it('MK-ERR-016: top-movers 缺 dim 应 400', async () => {
      await req.post('/market/top-movers').send({}).expect(400)
    })

    it('MK-ERR-017: top-movers dim 无效应 400', async () => {
      await req.post('/market/top-movers').send({ dim: 'invalid' }).expect(400)
    })

    it('MK-EDGE-031: top-movers limit=100（最大）', async () => {
      await req.post('/market/top-movers').send({ dim: 'gain', limit: 100 }).expect(201)
    })

    it('MK-EDGE-032: top-movers limit=101 应 400', async () => {
      await req.post('/market/top-movers').send({ dim: 'gain', limit: 101 }).expect(400)
    })
  })

  // ── 日期 ────────────────────────────────────────────────────────────────

  describe('日期', () => {
    it('MK-BIZ-026: 查询数据日期', async () => {
      const res = await req.post('/market/data-dates').send({}).expect(201)
      expect(res.body.data).toHaveProperty('dates')
    })
  })

  // ── 通用边界 ────────────────────────────────────────────────────────────

  describe('通用边界', () => {
    it('MK-ERR-018: money-flow trade_date 格式错误应 400', async () => {
      await req.post('/market/money-flow').send({ trade_date: '2026-05-24' }).expect(400)
    })

    it('MK-ERR-019: sector-ranking trade_date 格式错误应 400', async () => {
      await req.post('/market/sector-ranking').send({ trade_date: '2026/05/24' }).expect(400)
    })

    it('MK-EDGE-033: money-flow trade_date 格式正确', async () => {
      await req.post('/market/money-flow').send({ trade_date: '20260524' }).expect(201)
    })

    it('MK-EDGE-034: main-flow-ranking dual=true', async () => {
      mockMarketService.getMainFlowRanking.mockResolvedValue({ topInflow: [], topOutflow: [] })
      await req.post('/market/main-flow-ranking').send({ dual: true }).expect(201)
    })

    it('MK-EDGE-035: sector-flow-ranking dual=true', async () => {
      mockMarketService.getSectorFlowRanking.mockResolvedValue({ topInflow: [], topOutflow: [] })
      await req.post('/market/sector-flow-ranking').send({ dual: true }).expect(201)
    })
  })
})
