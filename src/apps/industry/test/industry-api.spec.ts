/**
 * Industry 模块 API 测试 — 业务优先
 *
 * 覆盖：字典映射（BIZ/ERR/EDGE/SEC）
 * 方法：Test.createTestingModule + mock services + supertest
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { LoggerService } from 'src/shared/logger/logger.service'
import { IndustryController } from '../industry.controller'
import { IndustryDictService } from '../industry-dict.service'

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
}

const SUCCESS_CODE = 0

const mockDictData = {
  source: 'sw_l1' as const,
  target: 'dc_industry' as const,
  version: 'SW2021',
  tradeDate: '20260427',
  coverage: {
    total: 31,
    matched: 28,
    unmatched: 3,
    matchRate: 0.9032,
    listedStockCount: 5510,
    listedStockMappedCount: 5491,
    listedStockMappedRate: 0.9966,
  },
  items: [
    {
      swCode: '801120.SI',
      swName: '食品饮料',
      dcTsCode: 'BK0438.DC',
      dcBoardCode: 'BK0438',
      dcName: '食品饮料',
      matchType: 'exact' as const,
      confidence: 1,
    },
    {
      swCode: '801050.SI',
      swName: '有色金属',
      dcTsCode: null,
      dcBoardCode: null,
      dcName: null,
      matchType: 'none' as const,
      confidence: 0,
    },
  ],
}

describe('Industry API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockDictService: Record<string, jest.Mock>

  beforeEach(async () => {
    mockDictService = {
      getDictMapping: jest.fn().mockResolvedValue(mockDictData),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IndustryController],
      providers: [{ provide: IndustryDictService, useValue: mockDictService }],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 字典映射 ────────────────────────────────────────────────────────────

  describe('字典映射', () => {
    it('IN-BIZ-001: 空请求体查询字典映射 → 201, 默认参数', async () => {
      const res = await req.post('/industry/dict-mapping').send({}).expect(201)
      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data).toHaveProperty('items')
      expect(res.body.data).toHaveProperty('coverage')
      expect(Array.isArray(res.body.data.items)).toBe(true)
      expect(mockDictService.getDictMapping).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'sw_l1', target: 'dc_industry', includeUnmatched: true }),
      )
    })

    it('IN-BIZ-002: 显式传入合法参数 → 201, 透传给 service', async () => {
      const res = await req
        .post('/industry/dict-mapping')
        .send({ source: 'sw_l1', target: 'dc_industry', includeUnmatched: false })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDictService.getDictMapping).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'sw_l1', target: 'dc_industry', includeUnmatched: false }),
      )
    })

    it('IN-BIZ-003: includeUnmatched=false → 201', async () => {
      const filteredData = {
        ...mockDictData,
        items: mockDictData.items.filter((i) => i.matchType !== 'none'),
      }
      mockDictService.getDictMapping.mockResolvedValueOnce(filteredData)

      const res = await req
        .post('/industry/dict-mapping')
        .send({ includeUnmatched: false })
        .expect(201)

      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.items[0].matchType).toBe('exact')
    })

    it('IN-BIZ-004: 返回数据结构完整性', async () => {
      const res = await req.post('/industry/dict-mapping').send({}).expect(201)
      const data = res.body.data
      expect(data.source).toBe('sw_l1')
      expect(data.target).toBe('dc_industry')
      expect(data).toHaveProperty('version')
      expect(data).toHaveProperty('tradeDate')
      expect(data.coverage).toHaveProperty('total')
      expect(data.coverage).toHaveProperty('matched')
      expect(data.coverage).toHaveProperty('unmatched')
      expect(data.coverage).toHaveProperty('matchRate')
      expect(data.coverage).toHaveProperty('listedStockCount')
      expect(data.coverage).toHaveProperty('listedStockMappedCount')
      expect(data.coverage).toHaveProperty('listedStockMappedRate')
      expect(data.items[0]).toHaveProperty('swCode')
      expect(data.items[0]).toHaveProperty('swName')
      expect(data.items[0]).toHaveProperty('matchType')
      expect(data.items[0]).toHaveProperty('confidence')
    })

    it('IN-ERR-001: 非法 source → 400', async () => {
      await req.post('/industry/dict-mapping').send({ source: 'invalid_source' }).expect(400)
      expect(mockDictService.getDictMapping).not.toHaveBeenCalled()
    })

    it('IN-ERR-002: 非法 target → 400', async () => {
      await req.post('/industry/dict-mapping').send({ target: 'invalid_target' }).expect(400)
      expect(mockDictService.getDictMapping).not.toHaveBeenCalled()
    })

    it('IN-ERR-003: source 和 target 同时非法 → 400', async () => {
      await req.post('/industry/dict-mapping').send({ source: 'bad', target: 'bad' }).expect(400)
      expect(mockDictService.getDictMapping).not.toHaveBeenCalled()
    })

    it('IN-ERR-004: includeUnmatched 任意值经 @Type(Boolean) 均被接受（DTO 设计特征）', async () => {
      // @Type(() => Boolean) 将任意值转为 boolean，@IsBoolean() 始终通过
      const res = await req
        .post('/industry/dict-mapping')
        .send({ includeUnmatched: 'truthy_string' })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      // 验证 transform 后为 boolean true
      expect(mockDictService.getDictMapping).toHaveBeenCalledWith(
        expect.objectContaining({ includeUnmatched: true }),
      )
    })

    it('IN-EDGE-001: service 抛异常 → 500', async () => {
      mockDictService.getDictMapping.mockRejectedValueOnce(new Error('DB connection failed'))

      await req.post('/industry/dict-mapping').send({}).expect(500)
    })

    it('IN-EDGE-002: service 返回空数据 → 201, 空 items', async () => {
      mockDictService.getDictMapping.mockResolvedValueOnce({
        source: 'sw_l1',
        target: 'dc_industry',
        version: null,
        tradeDate: null,
        coverage: { total: 0, matched: 0, unmatched: 0, matchRate: 0, listedStockCount: 0, listedStockMappedCount: 0, listedStockMappedRate: 0 },
        items: [],
      })

      const res = await req.post('/industry/dict-mapping').send({}).expect(201)
      expect(res.body.data.items).toHaveLength(0)
      expect(res.body.data.coverage.total).toBe(0)
      expect(res.body.data.version).toBeNull()
      expect(res.body.data.tradeDate).toBeNull()
    })

    it('IN-SEC-001: 无 Token 访问 → 201（公共端点）', async () => {
      // Industry controller has no @UseGuards, so no token required
      const res = await req.post('/industry/dict-mapping').send({}).expect(201)
      expect(res.body.code).toBe(SUCCESS_CODE)
    })
  })
})
