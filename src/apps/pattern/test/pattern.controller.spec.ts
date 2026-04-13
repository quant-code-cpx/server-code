import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { PatternController } from '../pattern.controller'
import { PatternService } from '../pattern.service'

const mockPatternService = {
  getTemplates: jest.fn(),
  search: jest.fn(),
  searchBySeries: jest.fn(),
}

// PatternController has no guards (public endpoints)

describe('PatternController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatternController],
      providers: [{ provide: PatternService, useValue: mockPatternService }],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  // ── [BIZ] 正常业务路径 ───────────────────────────────────────────────────────

  it('[BIZ] POST /pattern/templates/list → 201', async () => {
    mockPatternService.getTemplates.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/pattern/templates/list').send({}).expect(201)
    expect(res.body.code).toBe(0)
  })

  it('[BIZ] POST /pattern/search → 201', async () => {
    mockPatternService.search.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer())
      .post('/pattern/search')
      .send({ tsCode: '000001.SZ', startDate: '20240101', endDate: '20240401' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockPatternService.search).toHaveBeenCalledTimes(1)
  })

  // ── [VAL] DTO 校验 ─────────────────────────────────────────────────────────

  it('[VAL] POST /pattern/search 缺 tsCode → 400', async () => {
    await request(app.getHttpServer())
      .post('/pattern/search')
      .send({ startDate: '20240101', endDate: '20240401' })
      .expect(400)
  })

  it('[VAL] POST /pattern/search startDate 含横线格式 → 400 (@Matches /^\\d{8}$/)', async () => {
    await request(app.getHttpServer())
      .post('/pattern/search')
      .send({ tsCode: '000001.SZ', startDate: '2024-01-01', endDate: '20240401' })
      .expect(400)
  })

  it('[VAL] POST /pattern/search 缺 startDate → 400', async () => {
    await request(app.getHttpServer())
      .post('/pattern/search')
      .send({ tsCode: '000001.SZ', endDate: '20240401' })
      .expect(400)
  })
})
