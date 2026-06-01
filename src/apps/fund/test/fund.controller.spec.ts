import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { FundController } from '../fund.controller'
import { FundService } from '../fund.service'

const mockFundService = { getFundHoldings: jest.fn(), getInstitutionalSummary: jest.fn(), getEtfFlow: jest.fn() }

describe('FundController', () => {
  let app: INestApplication
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [FundController], providers: [{ provide: FundService, useValue: mockFundService }],
    }).compile()
    app = m.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    await app.init()
  })
  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST /fund/holdings → 201', async () => {
    mockFundService.getFundHoldings.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/fund/holdings').send({}).expect(201)
  })
  it('[BIZ] POST /fund/institutional-summary → 201', async () => {
    mockFundService.getInstitutionalSummary.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/fund/institutional-summary').send({}).expect(201)
  })
  it('[BIZ] POST /fund/etf-flow → 201', async () => {
    mockFundService.getEtfFlow.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/fund/etf-flow').send({}).expect(201)
  })
})
