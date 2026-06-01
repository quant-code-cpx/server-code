/**
 * Industry-rotation 模块 API 测试 — 业务优先
 *
 * 覆盖：收益对比/动量排名/资金流分析/估值分位/轮动总览/行业详情/热力图
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
import { IndustryRotationController } from '../industry-rotation.controller'
import { IndustryRotationService } from '../industry-rotation.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

// ── Mock data helpers ────────────────────────────────────────────────────────

function mockReturnComparisonData() {
  return {
    tradeDate: '20260523',
    industries: [
      { tsCode: 'BK0475.DC', name: '银行', returns: { 5: 1.2, 20: 3.5, 60: 8.1 }, latestPctChange: 0.5, latestClose: 3500.0 },
      { tsCode: 'BK0438.DC', name: '食品饮料', returns: { 5: -0.3, 20: -1.2, 60: 2.4 }, latestPctChange: -0.2, latestClose: 2800.0 },
    ],
  }
}

function mockMomentumRankingData() {
  return {
    tradeDate: '20260523',
    method: 'weighted',
    industries: [
      { tsCode: 'BK0475.DC', name: '银行', momentumScore: 4.2, return5d: 1.2, return20d: 3.5, return60d: 8.1, latestPctChange: 0.5, rank: 1 },
    ],
  }
}

function mockFlowAnalysisData() {
  return {
    tradeDate: '20260523',
    days: 5,
    industries: [
      {
        tsCode: 'BK0475.DC', name: '银行', cumulativeNetAmount: 12345.67, avgDailyNetAmount: 2469.13,
        cumulativeReturn: 1.5, flowMomentum: 500.0, flowAcceleration: 200.0,
        cumulativeBuyElg: 8000.0, cumulativeBuyLg: 4000.0, mainForceRatio: 0.97, latestDayRank: 1,
      },
    ],
    summary: { inflowCount: 15, outflowCount: 20, topInflowNames: ['银行', '非银金融'], topOutflowNames: ['传媒', '计算机'] },
  }
}

function mockValuationData() {
  return {
    tradeDate: '20260523',
    industries: [
      {
        industry: '银行', stockCount: 42, peTtmMedian: 5.5, pbMedian: 0.6,
        peTtmPercentile1y: 15.2, peTtmPercentile3y: 10.8, pbPercentile1y: 20.1, pbPercentile3y: 15.5, valuationLabel: '低估',
      },
    ],
  }
}

function mockOverviewData() {
  return {
    tradeDate: '20260523',
    returnSnapshot: { topGainers: [{ name: '银行', value: 3.5 }], topLosers: [{ name: '传媒', value: -2.1 }] },
    momentumSnapshot: { leaders: [{ name: '银行', value: 4.2 }], laggards: [{ name: '传媒', value: -1.5 }] },
    flowSnapshot: { topInflow: [{ name: '银行', value: 12345 }], topOutflow: [{ name: '传媒', value: -5678 }] },
    valuationSnapshot: { undervalued: [{ name: '银行', value: 15.2 }], overvalued: [{ name: '半导体', value: 85.3 }] },
  }
}

function mockDetailData() {
  return {
    industry: '银行',
    tsCode: 'BK0475.DC',
    returnTrend: [{ tradeDate: '20260523', close: 3500.0, pctChange: 0.5, cumulativeReturn: 3.5 }],
    flowTrend: [{ tradeDate: '20260523', netAmount: 2469.13, cumulativeNet: 12345.67, buyElgAmount: 8000.0, buyLgAmount: 4000.0 }],
    valuation: { peTtmMedian: 5.5, pbMedian: 0.6, peTtmPercentile1y: 15.2, pbPercentile1y: 20.1, valuationLabel: '低估' },
    topStocks: [{ tsCode: '601398.SH', name: '工商银行', pctChg: 0.3, peTtm: 5.2, pb: 0.55, totalMv: 1500000 }],
  }
}

function mockHeatmapData() {
  return {
    tradeDate: '20260523',
    periods: [1, 5, 10, 20, 60],
    industries: [
      { tsCode: 'BK0475.DC', name: '银行', returns: { 1: 0.5, 5: 1.2, 10: 2.0, 20: 3.5, 60: 8.1 } },
    ],
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('Industry-rotation API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockService: Record<string, jest.Mock>

  const user = buildTestUser()

  beforeEach(async () => {
    mockService = {
      getReturnComparison: jest.fn().mockResolvedValue(mockReturnComparisonData()),
      getMomentumRanking: jest.fn().mockResolvedValue(mockMomentumRankingData()),
      getFlowAnalysis: jest.fn().mockResolvedValue(mockFlowAnalysisData()),
      getIndustryValuation: jest.fn().mockResolvedValue(mockValuationData()),
      getOverview: jest.fn().mockResolvedValue(mockOverviewData()),
      getDetail: jest.fn().mockResolvedValue(mockDetailData()),
      getHeatmap: jest.fn().mockResolvedValue(mockHeatmapData()),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IndustryRotationController],
      providers: [
        { provide: IndustryRotationService, useValue: mockService },
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

  // ── 收益对比 (return-comparison) ──────────────────────────────────────────

  describe('收益对比 return-comparison', () => {
    it('IR-BIZ-001: 空 body 查询（全默认）', async () => {
      const res = await req.post('/industry-rotation/return-comparison').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('industries')
      expect(Array.isArray(res.body.data.industries)).toBe(true)
    })

    it('IR-BIZ-002: 指定 trade_date', async () => {
      const res = await req.post('/industry-rotation/return-comparison').send({ trade_date: '20260520' }).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(mockService.getReturnComparison).toHaveBeenCalledWith(
        expect.objectContaining({ trade_date: '20260520' }),
      )
    })

    it('IR-BIZ-003: 自定义 periods', async () => {
      const res = await req.post('/industry-rotation/return-comparison').send({ periods: [5, 20] }).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
    })

    it('IR-ERR-001: trade_date 格式错误应 400', async () => {
      await req.post('/industry-rotation/return-comparison').send({ trade_date: '2026-05-20' }).expect(400)
    })

    it('IR-ERR-002: periods 超过 5 个应 400', async () => {
      await req.post('/industry-rotation/return-comparison').send({ periods: [1, 5, 10, 20, 30, 60] }).expect(400)
    })

    it('IR-ERR-003: periods 元素超出范围应 400', async () => {
      await req.post('/industry-rotation/return-comparison').send({ periods: [0, 5, 61] }).expect(400)
    })

    it('IR-ERR-004: sort_period < 1 应 400', async () => {
      await req.post('/industry-rotation/return-comparison').send({ sort_period: 0 }).expect(400)
    })

    it('IR-ERR-005: order 无效值应 400', async () => {
      await req.post('/industry-rotation/return-comparison').send({ order: 'random' }).expect(400)
    })

    it('IR-EDGE-001: periods 单个元素', async () => {
      await req.post('/industry-rotation/return-comparison').send({ periods: [20] }).expect(201)
    })

    it('IR-EDGE-002: periods 恰好 5 个', async () => {
      await req.post('/industry-rotation/return-comparison').send({ periods: [1, 5, 10, 20, 60] }).expect(201)
    })
  })

  // ── 动量排名 (momentum-ranking) ───────────────────────────────────────────

  describe('动量排名 momentum-ranking', () => {
    it('IR-BIZ-004: 空 body 查询', async () => {
      const res = await req.post('/industry-rotation/momentum-ranking').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('method')
      expect(res.body.data).toHaveProperty('industries')
    })

    it('IR-BIZ-005: 指定 method=simple', async () => {
      const res = await req.post('/industry-rotation/momentum-ranking').send({ method: 'simple' }).expect(201)
      expect(mockService.getMomentumRanking).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'simple' }),
      )
    })

    it('IR-BIZ-006: 指定 limit', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ limit: 10 }).expect(201)
    })

    it('IR-ERR-006: method 无效值应 400', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ method: 'invalid' }).expect(400)
    })

    it('IR-ERR-007: limit 超出范围应 400', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ limit: 101 }).expect(400)
    })

    it('IR-ERR-008: weights 不是 3 个元素应 400', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ weights: [0.5, 0.5] }).expect(400)
    })

    it('IR-ERR-009: weights 元素低于 0.01 应 400', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ weights: [0.0, 0.5, 0.5] }).expect(400)
    })

    it('IR-EDGE-003: limit=1（最小）', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ limit: 1 }).expect(201)
    })

    it('IR-EDGE-004: limit=100（最大）', async () => {
      await req.post('/industry-rotation/momentum-ranking').send({ limit: 100 }).expect(201)
    })
  })

  // ── 资金流分析 (flow-analysis) ────────────────────────────────────────────

  describe('资金流分析 flow-analysis', () => {
    it('IR-BIZ-007: 空 body 查询', async () => {
      const res = await req.post('/industry-rotation/flow-analysis').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('days')
      expect(res.body.data).toHaveProperty('industries')
      expect(res.body.data).toHaveProperty('summary')
    })

    it('IR-BIZ-008: 指定 days+sort_by', async () => {
      const res = await req.post('/industry-rotation/flow-analysis').send({ days: 10, sort_by: 'flow_momentum' }).expect(201)
      expect(mockService.getFlowAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ days: 10, sort_by: 'flow_momentum' }),
      )
    })

    it('IR-ERR-010: days 超出范围应 400', async () => {
      await req.post('/industry-rotation/flow-analysis').send({ days: 61 }).expect(400)
    })

    it('IR-ERR-011: sort_by 无效值应 400', async () => {
      await req.post('/industry-rotation/flow-analysis').send({ sort_by: 'invalid_field' }).expect(400)
    })

    it('IR-EDGE-005: days=1（最小）', async () => {
      await req.post('/industry-rotation/flow-analysis').send({ days: 1 }).expect(201)
    })

    it('IR-EDGE-006: days=60（最大）', async () => {
      await req.post('/industry-rotation/flow-analysis').send({ days: 60 }).expect(201)
    })
  })

  // ── 估值分位 (valuation) ──────────────────────────────────────────────────

  describe('估值分位 valuation', () => {
    it('IR-BIZ-009: 空 body 查询', async () => {
      const res = await req.post('/industry-rotation/valuation').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('industries')
    })

    it('IR-BIZ-010: 指定 industry 筛选', async () => {
      const res = await req.post('/industry-rotation/valuation').send({ industry: '银行' }).expect(201)
      expect(mockService.getIndustryValuation).toHaveBeenCalledWith(
        expect.objectContaining({ industry: '银行' }),
      )
    })

    it('IR-ERR-012: sort_by 无效值应 400', async () => {
      await req.post('/industry-rotation/valuation').send({ sort_by: 'invalid_field' }).expect(400)
    })
  })

  // ── 轮动总览 (overview) ──────────────────────────────────────────────────

  describe('轮动总览 overview', () => {
    it('IR-BIZ-011: 空 body 查询', async () => {
      const res = await req.post('/industry-rotation/overview').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('returnSnapshot')
      expect(res.body.data).toHaveProperty('momentumSnapshot')
      expect(res.body.data).toHaveProperty('flowSnapshot')
      expect(res.body.data).toHaveProperty('valuationSnapshot')
    })

    it('IR-BIZ-012: 指定 trade_date', async () => {
      const res = await req.post('/industry-rotation/overview').send({ trade_date: '20260520' }).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
    })
  })

  // ── 单行业详情 (detail) ──────────────────────────────────────────────────

  describe('单行业详情 detail', () => {
    it('IR-BIZ-013: 按 tsCode 查询', async () => {
      const res = await req.post('/industry-rotation/detail').send({ tsCode: 'BK0475.DC' }).expect(201)
      expect(res.body.data).toHaveProperty('industry')
      expect(res.body.data).toHaveProperty('tsCode')
      expect(res.body.data).toHaveProperty('returnTrend')
      expect(res.body.data).toHaveProperty('flowTrend')
      expect(res.body.data).toHaveProperty('topStocks')
    })

    it('IR-BIZ-014: 按 industry 查询', async () => {
      const res = await req.post('/industry-rotation/detail').send({ industry: '银行' }).expect(201)
      expect(res.body.data).toHaveProperty('industry')
    })

    it('IR-BIZ-015: tsCode 和 industry 都不传返回空数据', async () => {
      const res = await req.post('/industry-rotation/detail').send({}).expect(201)
      expect(res.body.data).toHaveProperty('industry')
      expect(res.body.data).toHaveProperty('tsCode')
      expect(res.body.data).toHaveProperty('returnTrend')
      expect(res.body.data).toHaveProperty('flowTrend')
      expect(res.body.data).toHaveProperty('topStocks')
    })

    it('IR-ERR-013: tsCode 空字符串应 400', async () => {
      await req.post('/industry-rotation/detail').send({ tsCode: '' }).expect(400)
    })

    it('IR-ERR-014: industry 空字符串应 400', async () => {
      await req.post('/industry-rotation/detail').send({ industry: '' }).expect(400)
    })

    it('IR-ERR-015: days 超出范围应 400', async () => {
      await req.post('/industry-rotation/detail').send({ tsCode: 'BK0475.DC', days: 4 }).expect(400)
    })

    it('IR-EDGE-007: days=5（最小）', async () => {
      await req.post('/industry-rotation/detail').send({ tsCode: 'BK0475.DC', days: 5 }).expect(201)
    })

    it('IR-EDGE-008: days=60（最大）', async () => {
      await req.post('/industry-rotation/detail').send({ tsCode: 'BK0475.DC', days: 60 }).expect(201)
    })
  })

  // ── 热力图 (heatmap) ─────────────────────────────────────────────────────

  describe('热力图 heatmap', () => {
    it('IR-BIZ-016: 空 body 查询', async () => {
      const res = await req.post('/industry-rotation/heatmap').send({}).expect(201)
      expect(res.body.data).toHaveProperty('tradeDate')
      expect(res.body.data).toHaveProperty('periods')
      expect(res.body.data).toHaveProperty('industries')
    })

    it('IR-BIZ-017: 自定义 periods', async () => {
      const res = await req.post('/industry-rotation/heatmap').send({ periods: [5, 20] }).expect(201)
      expect(mockService.getHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({ periods: [5, 20] }),
      )
    })
  })
})
