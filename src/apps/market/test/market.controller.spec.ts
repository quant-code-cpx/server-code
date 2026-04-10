import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { MarketController } from '../market.controller'
import { MarketService } from '../market.service'

const SUCCESS_CODE = 0

const mockMarketService = {
  getMarketMoneyFlow: jest.fn(),
  getSectorFlow: jest.fn(),
  getMarketSentiment: jest.fn(),
  getMarketValuation: jest.fn(),
  getIndexQuote: jest.fn(),
  getHsgtFlow: jest.fn(),
  getIndexTrend: jest.fn(),
  getChangeDistribution: jest.fn(),
  getSectorRanking: jest.fn(),
  getVolumeOverview: jest.fn(),
  getSentimentTrend: jest.fn(),
  getValuationTrend: jest.fn(),
  getMoneyFlowTrend: jest.fn(),
  getSectorFlowRanking: jest.fn(),
  getSectorFlowTrend: jest.fn(),
  getHsgtTrend: jest.fn(),
  getMainFlowRanking: jest.fn(),
  getStockFlowDetail: jest.fn(),
  getConceptList: jest.fn(),
  getConceptMembers: jest.fn(),
}

describe('MarketController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [{ provide: MarketService, useValue: mockMarketService }],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /market/money-flow → 201 with code 200000', async () => {
    const mockData = [{ date: '20231201', netAmount: 1000 }]
    mockMarketService.getMarketMoneyFlow.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/market/money-flow')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /market/sector-flow → 201', async () => {
    const mockData = { industry: [], concept: [] }
    mockMarketService.getSectorFlow.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/market/sector-flow')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /market/sentiment → 201', async () => {
    const mockData = { upCount: 2000, downCount: 1500, flatCount: 200 }
    mockMarketService.getMarketSentiment.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/market/sentiment')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /market/index-quote → 201', async () => {
    const mockData = [{ tsCode: '000300.SH', close: 3800 }]
    mockMarketService.getIndexQuote.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/market/index-quote')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })
})
