import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { IndexController } from '../index.controller'
import { IndexService } from '../index.service'

const mockIndexService = {
  getIndexList: jest.fn(async () => [{ tsCode: '000300.SH', name: '沪深300' }]),
  getIndexDaily: jest.fn(async () => ({ list: [], total: 0 })),
  getIndexConstituents: jest.fn(async () => ({ list: [], total: 0 })),
}

describe('IndexController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndexController],
      providers: [{ provide: IndexService, useValue: mockIndexService }],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('POST /index/list → 201 + 指数列表', () =>
    request(app.getHttpServer())
      .post('/index/list')
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(res.body.data).toEqual([{ tsCode: '000300.SH', name: '沪深300' }])
      }))

  it('POST /index/daily → 201', () =>
    request(app.getHttpServer())
      .post('/index/daily')
      .send({ ts_code: '000300.SH', start_date: '20260101' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockIndexService.getIndexDaily).toHaveBeenCalled()
      }))

  it('POST /index/constituents → 201', () =>
    request(app.getHttpServer())
      .post('/index/constituents')
      .send({ index_code: '000300.SH' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockIndexService.getIndexConstituents).toHaveBeenCalled()
      }))

  // IndexDailyQueryDto.ts_code uses @IsString() (required, no @IsOptional)
  it('[VAL] POST /index/daily 缺 ts_code → 400', () =>
    request(app.getHttpServer()).post('/index/daily').send({}).expect(400))

  // start_date uses @IsOptional() @Matches(/^\d{8}$/) — hyphen format fails even when optional
  it('[VAL] POST /index/daily start_date 含横线格式 → 400', () =>
    request(app.getHttpServer())
      .post('/index/daily')
      .send({ ts_code: '000300.SH', start_date: '2026-01-01' })
      .expect(400))

  // IndexConstituentsQueryDto.index_code uses @IsString() (required, no @IsOptional)
  it('[VAL] POST /index/constituents 缺 index_code → 400', () =>
    request(app.getHttpServer()).post('/index/constituents').send({}).expect(400))
})
