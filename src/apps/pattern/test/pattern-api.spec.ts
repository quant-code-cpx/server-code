/**
 * Pattern 模块 API 测试 — 业务优先
 *
 * 覆盖：模板列表、相似形态搜索（股票日线）、相似形态搜索（自定义序列）
 * 方法：Test.createTestingModule + mock services + supertest
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PatternController } from '../pattern.controller'
import { PatternService } from '../pattern.service'

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

describe('Pattern API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockPatternService: Record<string, jest.Mock>

  const sampleTemplate = [
    { id: 'head_shoulders_top', name: '头肩顶', description: '经典顶部反转形态', length: 20 },
    { id: 'double_bottom', name: '双底', description: '经典底部反转形态', length: 15 },
  ]

  const sampleSearchResult = {
    patternLength: 20,
    algorithm: 'NED',
    candidateCount: 5000,
    elapsedMs: 1234,
    querySeries: [0, 0.3, 0.7, 1.0, 0.6],
    matches: [
      {
        tsCode: '600000.SH',
        name: '浦发银行',
        startDate: '20250301',
        endDate: '20250328',
        distance: 0.05,
        similarity: 95.0,
        futureReturns: [2.5, 4.1, 6.3],
        normalizedSeries: [0, 0.31, 0.69, 1.0, 0.58],
      },
    ],
  }

  beforeEach(async () => {
    mockPatternService = {
      getTemplates: jest.fn().mockResolvedValue(sampleTemplate),
      search: jest.fn().mockResolvedValue(sampleSearchResult),
      searchBySeries: jest.fn().mockResolvedValue(sampleSearchResult),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PatternController],
      providers: [{ provide: PatternService, useValue: mockPatternService }],
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

  // ── 模板列表 ────────────────────────────────────────────────────────────

  describe('模板列表', () => {
    it('PT-BIZ-001: 获取模板列表 → 201', async () => {
      const res = await req.post('/pattern/templates/list').send({}).expect(201)
      expect(res.body.data).toEqual(sampleTemplate)
      expect(mockPatternService.getTemplates).toHaveBeenCalledTimes(1)
    })

    it('PT-EDGE-001: 空 body 获取模板 → 201', async () => {
      const res = await req.post('/pattern/templates/list').expect(201)
      expect(res.body.code).toBe(0)
    })
  })

  // ── search 端点 ─────────────────────────────────────────────────────────

  describe('search 端点', () => {
    const validBody = { tsCode: '000001.SZ', startDate: '20260301', endDate: '20260401' }

    it('PT-BIZ-002: 正常搜索（必填字段）→ 201', async () => {
      const res = await req.post('/pattern/search').send(validBody).expect(201)
      expect(res.body.data).toHaveProperty('patternLength')
      expect(res.body.data).toHaveProperty('matches')
      expect(mockPatternService.search).toHaveBeenCalledTimes(1)
    })

    it('PT-BIZ-003: 搜索带全部可选参数 → 201', async () => {
      const body = {
        ...validBody,
        algorithm: 'NED',
        topK: 10,
        scope: 'ALL',
        lookbackYears: 3,
        excludeSelf: false,
      }
      const res = await req.post('/pattern/search').send(body).expect(201)
      expect(res.body.code).toBe(0)
    })

    it('PT-BIZ-004: 搜索使用 DTW 算法 → 201', async () => {
      const body = { ...validBody, algorithm: 'DTW' }
      const res = await req.post('/pattern/search').send(body).expect(201)
      expect(res.body.data.algorithm).toBe('NED') // mock returns NED
    })

    it('PT-ERR-001: 缺 tsCode → 400', async () => {
      await req.post('/pattern/search').send({ startDate: '20260301', endDate: '20260401' }).expect(400)
    })

    it('PT-ERR-002: 缺 startDate → 400', async () => {
      await req.post('/pattern/search').send({ tsCode: '000001.SZ', endDate: '20260401' }).expect(400)
    })

    it('PT-ERR-003: 缺 endDate → 400', async () => {
      await req.post('/pattern/search').send({ tsCode: '000001.SZ', startDate: '20260301' }).expect(400)
    })

    it('PT-ERR-004: startDate 格式错误（含横线）→ 400', async () => {
      await req
        .post('/pattern/search')
        .send({ tsCode: '000001.SZ', startDate: '2026-03-01', endDate: '20260401' })
        .expect(400)
    })

    it('PT-ERR-005: endDate 格式错误（含横线）→ 400', async () => {
      await req
        .post('/pattern/search')
        .send({ tsCode: '000001.SZ', startDate: '20260301', endDate: '2026-04-01' })
        .expect(400)
    })

    it('PT-ERR-006: algorithm 无效值 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, algorithm: 'INVALID' }).expect(400)
    })

    it('PT-ERR-007: scope 无效值 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, scope: 'INVALID' }).expect(400)
    })

    it('PT-EDGE-002: topK=1（最小）→ 201', async () => {
      await req.post('/pattern/search').send({ ...validBody, topK: 1 }).expect(201)
    })

    it('PT-EDGE-003: topK=100（最大）→ 201', async () => {
      await req.post('/pattern/search').send({ ...validBody, topK: 100 }).expect(201)
    })

    it('PT-EDGE-004: topK=0 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, topK: 0 }).expect(400)
    })

    it('PT-EDGE-005: topK=101 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, topK: 101 }).expect(400)
    })

    it('PT-EDGE-006: lookbackYears=1（最小）→ 201', async () => {
      await req.post('/pattern/search').send({ ...validBody, lookbackYears: 1 }).expect(201)
    })

    it('PT-EDGE-007: lookbackYears=20（最大）→ 201', async () => {
      await req.post('/pattern/search').send({ ...validBody, lookbackYears: 20 }).expect(201)
    })

    it('PT-EDGE-008: lookbackYears=0 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, lookbackYears: 0 }).expect(400)
    })

    it('PT-EDGE-009: lookbackYears=21 → 400', async () => {
      await req.post('/pattern/search').send({ ...validBody, lookbackYears: 21 }).expect(400)
    })

    it('PT-EDGE-010: excludeSelf=false → 201', async () => {
      await req.post('/pattern/search').send({ ...validBody, excludeSelf: false }).expect(201)
    })
  })

  // ── search-by-series 端点 ───────────────────────────────────────────────

  describe('search-by-series 端点', () => {
    it('PT-BIZ-005: 正常搜索（5 个数字）→ 201', async () => {
      const res = await req
        .post('/pattern/search-by-series')
        .send({ series: [10, 12, 15, 13, 16] })
        .expect(201)
      expect(res.body.data).toHaveProperty('patternLength')
      expect(res.body.data).toHaveProperty('matches')
      expect(mockPatternService.searchBySeries).toHaveBeenCalledTimes(1)
    })

    it('PT-BIZ-006: 搜索带全部可选参数 → 201', async () => {
      const body = {
        series: [10, 12, 15, 13, 16],
        algorithm: 'DTW',
        topK: 5,
        scope: 'INDEX',
        indexCode: '000300.SH',
        lookbackYears: 10,
      }
      const res = await req.post('/pattern/search-by-series').send(body).expect(201)
      expect(res.body.code).toBe(0)
    })

    it('PT-ERR-008: 缺 series → 400', async () => {
      await req.post('/pattern/search-by-series').send({}).expect(400)
    })

    it('PT-ERR-009: series 不足 5 个 → 400', async () => {
      await req.post('/pattern/search-by-series').send({ series: [10, 12, 15] }).expect(400)
    })

    it('PT-ERR-010: series 含非数字 → 400', async () => {
      await req
        .post('/pattern/search-by-series')
        .send({ series: [10, 12, 'abc', 13, 16] })
        .expect(400)
    })

    it('PT-EDGE-011: series 恰好 5 个（最小）→ 201', async () => {
      await req
        .post('/pattern/search-by-series')
        .send({ series: [1, 2, 3, 4, 5] })
        .expect(201)
    })

    it('PT-EDGE-012: series 长序列（50 个）→ 201', async () => {
      const longSeries = Array.from({ length: 50 }, (_, i) => 100 + i)
      await req
        .post('/pattern/search-by-series')
        .send({ series: longSeries })
        .expect(201)
    })
  })

  // ── 安全 ────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('PT-SEC-001: 无 Token 访问 templates/list → 201（公开端点）', async () => {
      const res = await req.post('/pattern/templates/list').send({}).expect(201)
      expect(res.body.code).toBe(0)
    })

    it('PT-SEC-002: 无 Token 访问 search → 201（公开端点）', async () => {
      const body = { tsCode: '000001.SZ', startDate: '20260301', endDate: '20260401' }
      const res = await req.post('/pattern/search').send(body).expect(201)
      expect(res.body.code).toBe(0)
    })

    it('PT-SEC-003: 无 Token 访问 search-by-series → 201（公开端点）', async () => {
      const res = await req
        .post('/pattern/search-by-series')
        .send({ series: [10, 12, 15, 13, 16] })
        .expect(201)
      expect(res.body.code).toBe(0)
    })
  })
})
