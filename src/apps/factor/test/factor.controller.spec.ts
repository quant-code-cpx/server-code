import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import * as request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { FactorController } from '../factor.controller'
import { FactorService } from '../factor.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = testUser
    return true
  }),
}

const mockFactorService = {
  getLibrary: jest.fn(),
  getDetail: jest.fn(),
  getFactorValues: jest.fn(),
  getIcAnalysis: jest.fn(),
  getQuantileAnalysis: jest.fn(),
  getDecayAnalysis: jest.fn(),
  getDistribution: jest.fn(),
  getCorrelation: jest.fn(),
  screening: jest.fn(),
  createCustomFactor: jest.fn(),
  testCustomFactor: jest.fn(),
  updateCustomFactor: jest.fn(),
  deleteCustomFactor: jest.fn(),
  triggerSinglePrecompute: jest.fn(),
  triggerPrecompute: jest.fn(),
  triggerBackfill: jest.fn(),
  getPrecomputeStatus: jest.fn(),
  submitBacktest: jest.fn(),
  attribution: jest.fn(),
  orthogonalize: jest.fn(),
  famaMacBeth: jest.fn(),
}

const SUCCESS_CODE = 0

describe('FactorController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FactorController],
      providers: [{ provide: FactorService, useValue: mockFactorService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /factor/library → 201, data is array', async () => {
    const mockLibrary = [{ category: 'MOMENTUM', factors: [] }]
    mockFactorService.getLibrary.mockResolvedValueOnce(mockLibrary)

    await request(app.getHttpServer())
      .post('/factor/library')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(Array.isArray(res.body.data)).toBe(true)
      })
  })

  it('POST /factor/values → 201', async () => {
    const mockValues = { tradeDate: '20231201', factors: [] }
    mockFactorService.getFactorValues.mockResolvedValueOnce(mockValues)

    await request(app.getHttpServer())
      .post('/factor/values')
      .send({ factorName: 'pe_ttm', tradeDate: '20231201' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/analysis/ic → 201', async () => {
    const mockIc = { series: [], icMean: 0.05 }
    mockFactorService.getIcAnalysis.mockResolvedValueOnce(mockIc)

    await request(app.getHttpServer())
      .post('/factor/analysis/ic')
      .send({ factorName: 'pe_ttm', startDate: '20230101', endDate: '20231231' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/screening → 201', async () => {
    const mockResult = { stocks: [], total: 0 }
    mockFactorService.screening.mockResolvedValueOnce(mockResult)

    await request(app.getHttpServer())
      .post('/factor/screening')
      .send({
        conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 20 }],
        tradeDate: '20231201',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /factor/detail → 201', async () => {
    const mockDetail = { factorName: 'pe_ttm', description: 'PE TTM' }
    mockFactorService.getDetail.mockResolvedValueOnce(mockDetail)

    await request(app.getHttpServer())
      .post('/factor/detail')
      .send({ factorName: 'pe_ttm' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })
})
