/**
 * IndustryController — 单元测试
 *
 * 覆盖要点：
 * 1. POST /industry/dict-mapping → 201, code=0
 * 2. 空请求体走默认参数
 * 3. 非法 source 返回 400
 * 4. 非法 target 返回 400
 */
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { IndustryController } from '../industry.controller'
import { IndustryDictService } from '../industry-dict.service'

const mockDictService = {
  getDictMapping: jest.fn(),
}

const SUCCESS_CODE = 0

describe('IndustryController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndustryController],
      providers: [{ provide: IndustryDictService, useValue: mockDictService }],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /industry/dict-mapping → 201, code=0, data 有 items 和 coverage', async () => {
    const mockData = {
      source: 'sw_l1',
      target: 'dc_industry',
      version: 'SW2021',
      tradeDate: '20260427',
      coverage: { total: 31, matched: 31, unmatched: 0, matchRate: 1 },
      items: [{ swCode: '801120.SI', swName: '食品饮料', dcTsCode: 'BK0438.DC', matchType: 'exact', confidence: 1 }],
    }
    mockDictService.getDictMapping.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/industry/dict-mapping')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data.source).toBe('sw_l1')
        expect(res.body.data.coverage.total).toBe(31)
        expect(Array.isArray(res.body.data.items)).toBe(true)
      })
  })

  it('空请求体 → 走默认参数（source=sw_l1, target=dc_industry）', async () => {
    mockDictService.getDictMapping.mockResolvedValueOnce({
      source: 'sw_l1',
      target: 'dc_industry',
      coverage: { total: 0, matched: 0 },
      items: [],
    })

    await request(app.getHttpServer())
      .post('/industry/dict-mapping')
      .send({})
      .expect(201)

    expect(mockDictService.getDictMapping).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'sw_l1', target: 'dc_industry' }),
    )
  })

  it('显式传入合法参数 → 透传给 service', async () => {
    mockDictService.getDictMapping.mockResolvedValueOnce({
      source: 'sw_l1',
      target: 'dc_industry',
      coverage: { total: 0, matched: 0 },
      items: [],
    })

    await request(app.getHttpServer())
      .post('/industry/dict-mapping')
      .send({ source: 'sw_l1', target: 'dc_industry', includeUnmatched: false })
      .expect(201)

    expect(mockDictService.getDictMapping).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'sw_l1', target: 'dc_industry', includeUnmatched: false }),
    )
  })

  it('[VAL] 非法 source → 400', async () => {
    await request(app.getHttpServer())
      .post('/industry/dict-mapping')
      .send({ source: 'invalid_source' })
      .expect(400)

    expect(mockDictService.getDictMapping).not.toHaveBeenCalled()
  })

  it('[VAL] 非法 target → 400', async () => {
    await request(app.getHttpServer())
      .post('/industry/dict-mapping')
      .send({ target: 'invalid_target' })
      .expect(400)

    expect(mockDictService.getDictMapping).not.toHaveBeenCalled()
  })
})
