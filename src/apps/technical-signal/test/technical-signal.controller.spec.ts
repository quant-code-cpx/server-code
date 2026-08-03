import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { TechnicalSignalController } from '../technical-signal.controller'
import { TechnicalSignalDefinitionService } from '../services/technical-signal-definition.service'
import { TechnicalSignalStatisticsService } from '../services/technical-signal-statistics.service'

const mockDefinitionService = { list: jest.fn() }
const mockStatisticsService = { query: jest.fn(), listOccurrences: jest.fn() }

describe('TechnicalSignalController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TechnicalSignalController],
      providers: [
        { provide: TechnicalSignalDefinitionService, useValue: mockDefinitionService },
        { provide: TechnicalSignalStatisticsService, useValue: mockStatisticsService },
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST definitions returns wrapped catalog with HTTP 200', async () => {
    const payload = {
      definitions: [
        {
          signalKey: 'macd.golden-cross',
          semanticsVersion: 'macd.v1',
          definitionHash: 'a'.repeat(64),
          displayName: 'MACD 金叉',
          direction: 'BULLISH',
          source: 'LOCAL_QFQ_OHLCV',
          description: 'DIF 穿越',
          parameters: { fastPeriod: 12 },
          stable: true,
          deprecatedAt: null,
        },
      ],
    }
    mockDefinitionService.list.mockResolvedValueOnce(payload)

    const response = await request(app.getHttpServer())
      .post('/stock/detail/analysis/signal-definitions/list')
      .send({ signalKeys: ['macd.golden-cross'] })
      .expect(200)

    expect(response.body).toMatchObject({ code: 0, data: payload })
    expect(mockDefinitionService.list).toHaveBeenCalledWith(
      expect.objectContaining({ signalKeys: ['macd.golden-cross'] }),
    )
  })

  it('[BIZ] POST statistics accepts valid default query and preserves calculation result', async () => {
    const payload = { meta: { dataAsOf: '20260731', includeBenchmark: false }, groups: [] }
    mockStatisticsService.query.mockResolvedValueOnce(payload)

    const response = await request(app.getHttpServer())
      .post('/stock/detail/analysis/signal-statistics/query')
      .send({ tsCode: '000001.SZ' })
      .expect(200)

    expect(response.body).toMatchObject({ code: 0, data: payload })
    expect(mockStatisticsService.query).toHaveBeenCalledWith(expect.objectContaining({ tsCode: '000001.SZ' }))
  })

  it('[BIZ] POST occurrences accepts required window and returns independently paged samples', async () => {
    const payload = { total: 1, page: 2, pageSize: 10, items: [] }
    mockStatisticsService.listOccurrences.mockResolvedValueOnce(payload)

    const response = await request(app.getHttpServer())
      .post('/stock/detail/analysis/signal-occurrences/list')
      .send({
        tsCode: '000001.SZ',
        signalKey: 'macd.golden-cross',
        startDate: '20240101',
        endDate: '20251231',
        page: 2,
        pageSize: 10,
      })
      .expect(200)

    expect(response.body).toMatchObject({ code: 0, data: payload })
    expect(mockStatisticsService.listOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10, signalKey: 'macd.golden-cross' }),
    )
  })

  it('[API] routes are POST-only', async () => {
    await request(app.getHttpServer()).get('/stock/detail/analysis/signal-definitions/list').expect(404)
    expect(mockDefinitionService.list).not.toHaveBeenCalled()
  })

  it('[ERR] duplicate definition key is rejected by definition service with HTTP 400', async () => {
    const definitionService = new TechnicalSignalDefinitionService()
    mockDefinitionService.list.mockImplementationOnce((dto) => definitionService.list(dto))

    await request(app.getHttpServer())
      .post('/stock/detail/analysis/signal-definitions/list')
      .send({ signalKeys: ['macd.golden-cross', 'macd.golden-cross'] })
      .expect(400)

    expect(mockDefinitionService.list).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'invalid tsCode',
      path: '/stock/detail/analysis/signal-statistics/query',
      body: { tsCode: '000001.SH ' },
      service: mockStatisticsService.query,
    },
    {
      name: 'horizon below one',
      path: '/stock/detail/analysis/signal-statistics/query',
      body: { tsCode: '000001.SZ', horizons: [0] },
      service: mockStatisticsService.query,
    },
    {
      name: 'malformed occurrence date',
      path: '/stock/detail/analysis/signal-occurrences/list',
      body: {
        tsCode: '000001.SZ',
        signalKey: 'macd.golden-cross',
        startDate: '2024-01-01',
        endDate: '20251231',
      },
      service: mockStatisticsService.listOccurrences,
    },
    {
      name: 'impossible calendar date',
      path: '/stock/detail/analysis/signal-occurrences/list',
      body: {
        tsCode: '000001.SZ',
        signalKey: 'macd.golden-cross',
        startDate: '20240230',
        endDate: '20251231',
      },
      service: mockStatisticsService.listOccurrences,
    },
    {
      name: 'page size above limit',
      path: '/stock/detail/analysis/signal-occurrences/list',
      body: {
        tsCode: '000001.SZ',
        signalKey: 'macd.golden-cross',
        startDate: '20240101',
        endDate: '20251231',
        pageSize: 101,
      },
      service: mockStatisticsService.listOccurrences,
    },
  ])('[VAL] $name returns 400 before service invocation', async ({ path, body, service }) => {
    await request(app.getHttpServer()).post(path).send(body).expect(400)
    expect(service).not.toHaveBeenCalled()
  })
})
