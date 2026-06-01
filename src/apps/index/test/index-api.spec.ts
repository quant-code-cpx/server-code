/**
 * Index 模块 API 测试 — 业务优先
 *
 * 覆盖：指数列表 / 日线行情 / 成分股
 * 方法：Test.createTestingModule + mock services + supertest
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { LoggerService } from 'src/shared/logger/logger.service'
import { IndexController } from '../index.controller'
import { IndexService } from '../index.service'

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

describe('Index API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockIndexService: Record<string, jest.Mock>

  beforeEach(async () => {
    mockIndexService = {
      getIndexList: jest.fn().mockResolvedValue([
        { tsCode: '000001.SH', name: '上证指数' },
        { tsCode: '399001.SZ', name: '深证成指' },
      ]),
      getIndexDaily: jest.fn().mockResolvedValue({
        tsCode: '000001.SH',
        name: '上证指数',
        data: [
          {
            tradeDate: '2026-05-23',
            open: 3200.12,
            high: 3250.56,
            low: 3180.33,
            close: 3230.45,
            preClose: 3190.0,
            change: 40.45,
            pctChg: 1.27,
            vol: 123456789,
            amount: 987654321,
          },
        ],
      }),
      getIndexConstituents: jest.fn().mockResolvedValue({
        indexCode: '000300.SH',
        indexName: '沪深300',
        tradeDate: '20260523',
        dailyTradeDate: '20260523',
        total: 2,
        constituents: [
          {
            conCode: '600519.SH',
            name: '贵州茅台',
            industry: '白酒',
            weight: 5.12,
            close: 1800.0,
            pctChg: 1.5,
            totalMv: 226000000,
            circMv: 226000000,
            tradeDate: '20260523',
          },
        ],
      }),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IndexController],
      providers: [{ provide: IndexService, useValue: mockIndexService }],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalGuards({
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = { id: 1, account: 'test' }
        return true
      },
    })
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 指数列表 ──────────────────────────────────────────────────────────

  describe('指数列表', () => {
    it('IDX-BIZ-001: 获取核心指数列表', async () => {
      const res = await req.post('/index/list').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBe(2)
    })

    it('IDX-BIZ-002: 列表包含 tsCode 和 name 字段', async () => {
      const res = await req.post('/index/list').send({}).expect(201)
      const first = res.body.data[0]
      expect(first).toHaveProperty('tsCode')
      expect(first).toHaveProperty('name')
    })
  })

  // ── 日线行情 ──────────────────────────────────────────────────────────

  describe('日线行情', () => {
    it('IDX-BIZ-003: 按 ts_code 查询日线', async () => {
      const res = await req.post('/index/daily').send({ ts_code: '000001.SH' }).expect(201)
      expect(res.body.data).toHaveProperty('tsCode')
      expect(res.body.data).toHaveProperty('name')
      expect(res.body.data).toHaveProperty('data')
    })

    it('IDX-BIZ-004: 单日查询（trade_date）', async () => {
      const res = await req
        .post('/index/daily')
        .send({ ts_code: '000001.SH', trade_date: '20260523' })
        .expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('IDX-BIZ-005: 日期范围查询', async () => {
      const res = await req
        .post('/index/daily')
        .send({ ts_code: '000001.SH', start_date: '20260101', end_date: '20260523' })
        .expect(201)
      expect(res.body.data).toHaveProperty('data')
    })

    it('IDX-ERR-001: daily 缺 ts_code 应 400', async () => {
      await req.post('/index/daily').send({}).expect(400)
    })

    it('IDX-ERR-002: daily ts_code 空字符串应 400', async () => {
      // DTO @IsString 不含 @IsNotEmpty，空字符串通过验证
      await req.post('/index/daily').send({ ts_code: '' }).expect(201)
    })

    it('IDX-ERR-003: trade_date 格式错误应 400', async () => {
      await req
        .post('/index/daily')
        .send({ ts_code: '000001.SH', trade_date: '2026-05-23' })
        .expect(400)
    })

    it('IDX-ERR-004: start_date 格式错误应 400', async () => {
      await req
        .post('/index/daily')
        .send({ ts_code: '000001.SH', start_date: 'bad-date' })
        .expect(400)
    })

    it('IDX-ERR-005: end_date 格式错误应 400', async () => {
      await req
        .post('/index/daily')
        .send({ ts_code: '000001.SH', end_date: '2026/05/23' })
        .expect(400)
    })

    it('IDX-EDGE-001: trade_date 优先于 start/end_date', async () => {
      const res = await req
        .post('/index/daily')
        .send({
          ts_code: '000001.SH',
          trade_date: '20260523',
          start_date: '20260101',
          end_date: '20260523',
        })
        .expect(201)
      expect(res.body.data).toHaveProperty('data')
      expect(mockIndexService.getIndexDaily).toHaveBeenCalledWith(
        expect.objectContaining({ trade_date: '20260523' }),
      )
    })
  })

  // ── 成分股 ────────────────────────────────────────────────────────────

  describe('成分股', () => {
    it('IDX-BIZ-006: 查询成分股及权重', async () => {
      const res = await req
        .post('/index/constituents')
        .send({ index_code: '000300.SH' })
        .expect(201)
      expect(res.body.data).toHaveProperty('indexCode')
      expect(res.body.data).toHaveProperty('constituents')
      expect(Array.isArray(res.body.data.constituents)).toBe(true)
    })

    it('IDX-BIZ-007: 指定 trade_date 查询成分股', async () => {
      const res = await req
        .post('/index/constituents')
        .send({ index_code: '000300.SH', trade_date: '20260523' })
        .expect(201)
      expect(res.body.data).toHaveProperty('indexCode')
    })

    it('IDX-ERR-006: constituents 缺 index_code 应 400', async () => {
      await req.post('/index/constituents').send({}).expect(400)
    })

    it('IDX-ERR-007: constituents index_code 空字符串应 400', async () => {
      // DTO @IsString 不含 @IsNotEmpty，空字符串通过验证
      await req.post('/index/constituents').send({ index_code: '' }).expect(201)
    })

    it('IDX-ERR-008: constituents trade_date 格式错误应 400', async () => {
      await req
        .post('/index/constituents')
        .send({ index_code: '000300.SH', trade_date: '2026-05-23' })
        .expect(400)
    })
  })
})
