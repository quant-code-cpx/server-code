import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { MarketController } from '../market.controller'
import { MarketService } from '../market.service'

const SUCCESS_CODE = 0

const mockMarketService: Record<string, jest.Mock> = {
  getMarketMoneyFlow: jest.fn(), getSectorFlow: jest.fn(), getMarketSentiment: jest.fn(),
  getMarketValuation: jest.fn(), getIndexQuote: jest.fn(), getHsgtFlow: jest.fn(),
  getIndexTrend: jest.fn(), getIndexQuoteWithSparkline: jest.fn(), getChangeDistribution: jest.fn(),
  getSectorRanking: jest.fn(), getVolumeOverview: jest.fn(), getSentimentTrend: jest.fn(),
  getValuationTrend: jest.fn(), getMoneyFlowTrend: jest.fn(), getSectorFlowRanking: jest.fn(),
  getSectorFlowTrend: jest.fn(), getHsgtTrend: jest.fn(), getMainFlowRanking: jest.fn(),
  getStockFlowDetail: jest.fn(), getConceptList: jest.fn(), getConceptMembers: jest.fn(),
  getDailyNarrative: jest.fn(), getTopMovers: jest.fn(), getDataDates: jest.fn(),
  getSectorTopBottom: jest.fn(), getMarketBreadth: jest.fn(),
}

const ok = (key: string) => (mockMarketService[key] as jest.Mock).mockResolvedValueOnce({})

describe('MarketController', () => {
  let app: INestApplication
  beforeEach(async () => {
    jest.clearAllMocks()
    const m = await Test.createTestingModule({
      controllers: [MarketController], providers: [{ provide: MarketService, useValue: mockMarketService }],
    }).compile()
    app = m.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterEach(async () => app.close())

  const eps: Array<[string, string, Record<string, unknown>]> = [
    ['/market/money-flow', 'getMarketMoneyFlow', {}],
    ['/market/sector-flow', 'getSectorFlow', {}],
    ['/market/sentiment', 'getMarketSentiment', {}],
    ['/market/valuation', 'getMarketValuation', {}],
    ['/market/index-quote', 'getIndexQuote', {}],
    ['/market/hsgt-flow', 'getHsgtFlow', {}],
    ['/market/index-trend', 'getIndexTrend', {}],
    ['/market/index-quote-with-sparkline', 'getIndexQuoteWithSparkline', {}],
    ['/market/change-distribution', 'getChangeDistribution', {}],
    ['/market/sector-ranking', 'getSectorRanking', {}],
    ['/market/volume-overview', 'getVolumeOverview', {}],
    ['/market/sentiment-trend', 'getSentimentTrend', {}],
    ['/market/valuation-trend', 'getValuationTrend', {}],
    ['/market/money-flow-trend', 'getMoneyFlowTrend', {}],
    ['/market/sector-flow-ranking', 'getSectorFlowRanking', {}],
    ['/market/sector-flow-trend', 'getSectorFlowTrend', { ts_code: 'BK0001' }],
    ['/market/hsgt-trend', 'getHsgtTrend', {}],
    ['/market/main-flow-ranking', 'getMainFlowRanking', {}],
    ['/market/stock-flow-detail', 'getStockFlowDetail', { ts_code: '000001.SZ' }],
    ['/market/market-breadth', 'getMarketBreadth', {}],
    ['/market/concept/list', 'getConceptList', {}],
    ['/market/concept/members', 'getConceptMembers', { tsCode: '885835.TI' }],
    ['/market/daily-narrative', 'getDailyNarrative', {}],
        ['/market/top-movers', 'getTopMovers', { dim: 'gain' }],
    ['/market/data-dates', 'getDataDates', {}],
    ['/market/sector-top-bottom', 'getSectorTopBottom', {}],
  ]

  eps.forEach(([path, svcKey, body]) => {
    it(`[BIZ] POST ${path} → 201`, async () => {
      ok(svcKey)
      await request(app.getHttpServer()).post(path).send(body).expect(201).expect((res: any) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
      })
    })
  })

  it('[VAL] POST /market/money-flow trade_date 含横线 → 400', async () => {
    await request(app.getHttpServer()).post('/market/money-flow').send({ trade_date: '2023-12-01' }).expect(400)
  })
  it('[VAL] POST /market/sector-flow content_type 非法枚举 → 400', async () => {
    await request(app.getHttpServer()).post('/market/sector-flow').send({ content_type: 'INVALID' }).expect(400)
  })
  it('[VAL] POST /market/stock-flow-detail 缺 ts_code → 400', async () => {
    await request(app.getHttpServer()).post('/market/stock-flow-detail').send({}).expect(400)
  })
})
