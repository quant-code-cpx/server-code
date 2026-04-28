import { INestApplication, ValidationPipe, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { IndustryRotationController } from '../industry-rotation.controller'
import { IndustryRotationService } from '../industry-rotation.service'

const mockIndustryRotationService = {
  getReturnComparison: jest.fn(async () => ({ industries: [], dates: [] })),
  getMomentumRanking: jest.fn(async () => []),
  getFlowAnalysis: jest.fn(async () => []),
  getIndustryValuation: jest.fn(async () => []),
  getOverview: jest.fn(async () => ({ heatData: [], summary: {} })),
  getDetail: jest.fn(async () => ({ industry: '银行', tsCode: 'BK1283.DC', returnTrend: [], flowTrend: [], valuation: null, topStocks: [] })),
  getHeatmap: jest.fn(async () => ({ matrix: [] })),
}

const SUCCESS_CODE = 0

describe('IndustryRotationController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndustryRotationController],
      providers: [{ provide: IndustryRotationService, useValue: mockIndustryRotationService }],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /industry-rotation/overview → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/overview')
      .send({})
      .expect(201)
    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(res.body.data).toBeDefined()
    expect(mockIndustryRotationService.getOverview).toHaveBeenCalledTimes(1)
  })

  it('POST /industry-rotation/return-comparison → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/return-comparison')
      .send({})
      .expect(201)
    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(res.body.data).toBeDefined()
    expect(mockIndustryRotationService.getReturnComparison).toHaveBeenCalledTimes(1)
  })

  it('POST /industry-rotation/detail → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/detail')
      .send({ industry: '银行' })
      .expect(201)
    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(res.body.data).toBeDefined()
    expect(mockIndustryRotationService.getDetail).toHaveBeenCalledWith(expect.objectContaining({ industry: '银行' }))
  })

  it('POST /industry-rotation/flow-analysis → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/flow-analysis')
      .send({})
      .expect(201)
    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(mockIndustryRotationService.getFlowAnalysis).toHaveBeenCalledTimes(1)
  })

  // tsCode 和 industry 至少传一个；都不传时 service 返回空结果
  it('POST /industry-rotation/detail 缺 tsCode 和 industry → 201 空结果', async () => {
    mockIndustryRotationService.getDetail.mockResolvedValueOnce({
      industry: '',
      tsCode: null,
      returnTrend: [],
      flowTrend: [],
      valuation: null,
      topStocks: [],
    })

    const res = await request(app.getHttpServer())
      .post('/industry-rotation/detail')
      .send({})
      .expect(201)

    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(res.body.data.returnTrend).toEqual([])
  })

  // 传 tsCode 时正常返回
  it('POST /industry-rotation/detail 传 tsCode → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/detail')
      .send({ tsCode: 'BK0438.DC' })
      .expect(201)

    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(mockIndustryRotationService.getDetail).toHaveBeenCalledWith(
      expect.objectContaining({ tsCode: 'BK0438.DC' }),
    )
  })

  // 同时传 tsCode 和 industry 时，tsCode 优先
  it('POST /industry-rotation/detail 同时传 tsCode 和 industry → tsCode 优先', async () => {
    const res = await request(app.getHttpServer())
      .post('/industry-rotation/detail')
      .send({ tsCode: 'BK0438.DC', industry: '银行' })
      .expect(201)

    expect(res.body.code).toBe(SUCCESS_CODE)
    expect(mockIndustryRotationService.getDetail).toHaveBeenCalledWith(
      expect.objectContaining({ tsCode: 'BK0438.DC', industry: '银行' }),
    )
  })

  // FlowAnalysisQueryDto.trade_date uses @IsOptional @Matches — hyphen format fails
  it('[VAL] POST /industry-rotation/flow-analysis trade_date 含横线格式 → 400', async () => {
    await request(app.getHttpServer())
      .post('/industry-rotation/flow-analysis')
      .send({ trade_date: '2024-01-01' })
      .expect(400)
    expect(mockIndustryRotationService.getFlowAnalysis).not.toHaveBeenCalled()
  })

  it('[ERR] POST /industry-rotation/detail NotFoundException → 404', async () => {
    mockIndustryRotationService.getDetail.mockRejectedValueOnce(new NotFoundException('industry not found'))
    await request(app.getHttpServer())
      .post('/industry-rotation/detail')
      .send({ industry: 'unknown' })
      .expect(404)
    expect(mockIndustryRotationService.getDetail).toHaveBeenCalledTimes(1)
  })
})
