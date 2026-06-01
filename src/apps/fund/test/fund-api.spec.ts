/**
 * Fund 模块 API 测试 — 业务优先
 *
 * 覆盖：基金持仓明细、机构持仓汇总、ETF 资金流向
 * 方法：Test.createTestingModule + mock services + supertest
 * 说明：FundController 无 class-level @UseGuards，公共端点无需认证
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { LoggerService } from 'src/shared/logger/logger.service'
import { FundController } from '../fund.controller'
import { FundService } from '../fund.service'

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

describe('Fund API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockFundService: Record<string, jest.Mock>

  const sampleHolding = {
    ts_code: '510300.SH',
    fund_name: '华泰柏瑞沪深300ETF',
    end_date: '20231231',
    ann_date: '20240115',
    symbol: '600519.SH',
    mkv: 1000000,
    amount: 5000,
    stk_mkv_ratio: 5.5,
    stk_float_ratio: 0.8,
  }

  const sampleInstitutionalSummary = {
    symbol: '600519.SH',
    end_date: '20231231',
    fund_count: 3,
    total_mkv: 5000000,
    total_amount: 25000,
    avg_stk_float_ratio: 1.2,
    holders: [
      { ts_code: '510300.SH', fund_name: '华泰柏瑞沪深300ETF', mkv: 2000000, amount: 10000, stk_mkv_ratio: 3.0, stk_float_ratio: 0.5 },
    ],
  }

  const sampleEtfFlow = {
    ts_code: '510300.SH',
    fund_name: '华泰柏瑞沪深300ETF',
    trade_date: '20240101',
    fd_share: 500000,
    share_delta: 10000,
    flow_direction: 'inflow' as const,
  }

  beforeEach(async () => {
    mockFundService = {
      getFundHoldings: jest.fn().mockResolvedValue([sampleHolding]),
      getInstitutionalSummary: jest.fn().mockResolvedValue([sampleInstitutionalSummary]),
      getEtfFlow: jest.fn().mockResolvedValue([sampleEtfFlow]),
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FundController],
      providers: [{ provide: FundService, useValue: mockFundService }],
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

  // ── 基金持仓明细（holdings）──────────────────────────────────────────────

  describe('基金持仓明细（holdings）', () => {
    it('FD-BIZ-001: 空 body 查询持仓 → 201', async () => {
      const res = await req.post('/fund/holdings').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].ts_code).toBe('510300.SH')
    })

    it('FD-BIZ-002: 按 ts_code 查询持仓 → 201', async () => {
      const res = await req.post('/fund/holdings').send({ ts_code: '510300.SH' }).expect(201)
      expect(mockFundService.getFundHoldings).toHaveBeenCalledWith(
        expect.objectContaining({ ts_code: '510300.SH' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-003: 按 end_date 查询持仓 → 201', async () => {
      const res = await req.post('/fund/holdings').send({ end_date: '20231231' }).expect(201)
      expect(mockFundService.getFundHoldings).toHaveBeenCalledWith(
        expect.objectContaining({ end_date: '20231231' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-004: 同时传 ts_code + end_date → 201', async () => {
      const res = await req.post('/fund/holdings')
        .send({ ts_code: '510300.SH', end_date: '20231231' })
        .expect(201)
      expect(mockFundService.getFundHoldings).toHaveBeenCalledWith(
        expect.objectContaining({ ts_code: '510300.SH', end_date: '20231231' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-ERR-001: end_date 格式错误应 400', async () => {
      await req.post('/fund/holdings').send({ end_date: '2023-12-31' }).expect(400)
    })

    it('FD-EDGE-001: end_date 全数字 8 位 → 201', async () => {
      await req.post('/fund/holdings').send({ end_date: '20231231' }).expect(201)
    })
  })

  // ── 机构持仓汇总（institutional-summary）─────────────────────────────────

  describe('机构持仓汇总（institutional-summary）', () => {
    it('FD-BIZ-005: 空 body 查询汇总 → 201', async () => {
      const res = await req.post('/fund/institutional-summary').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].symbol).toBe('600519.SH')
    })

    it('FD-BIZ-006: 按 symbol 查询汇总 → 201', async () => {
      const res = await req.post('/fund/institutional-summary')
        .send({ symbol: '600519.SH' })
        .expect(201)
      expect(mockFundService.getInstitutionalSummary).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: '600519.SH' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-007: 按 end_date 查询汇总 → 201', async () => {
      const res = await req.post('/fund/institutional-summary')
        .send({ end_date: '20231231' })
        .expect(201)
      expect(mockFundService.getInstitutionalSummary).toHaveBeenCalledWith(
        expect.objectContaining({ end_date: '20231231' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-008: 带 limit 查询汇总 → 201', async () => {
      const res = await req.post('/fund/institutional-summary')
        .send({ limit: 10 })
        .expect(201)
      expect(mockFundService.getInstitutionalSummary).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-ERR-002: end_date 格式错误应 400', async () => {
      await req.post('/fund/institutional-summary')
        .send({ end_date: '2023/12/31' })
        .expect(400)
    })

    it('FD-ERR-003: limit=0 应 400', async () => {
      await req.post('/fund/institutional-summary')
        .send({ limit: 0 })
        .expect(400)
    })

    it('FD-ERR-004: limit 非数字应 400', async () => {
      await req.post('/fund/institutional-summary')
        .send({ limit: 'abc' })
        .expect(400)
    })

    it('FD-EDGE-002: limit=1（最小）→ 201', async () => {
      await req.post('/fund/institutional-summary')
        .send({ limit: 1 })
        .expect(201)
    })
  })

  // ── ETF 资金流向（etf-flow）───────────────────────────────────────────────

  describe('ETF 资金流向（etf-flow）', () => {
    it('FD-BIZ-009: 空 body 查询 ETF 流向 → 201', async () => {
      const res = await req.post('/fund/etf-flow').send({}).expect(201)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].flow_direction).toBe('inflow')
    })

    it('FD-BIZ-010: 按 ts_code 查询 ETF 流向 → 201', async () => {
      const res = await req.post('/fund/etf-flow')
        .send({ ts_code: '510300.SH' })
        .expect(201)
      expect(mockFundService.getEtfFlow).toHaveBeenCalledWith(
        expect.objectContaining({ ts_code: '510300.SH' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-011: 按 days 查询 ETF 流向 → 201', async () => {
      const res = await req.post('/fund/etf-flow')
        .send({ days: 14 })
        .expect(201)
      expect(mockFundService.getEtfFlow).toHaveBeenCalledWith(
        expect.objectContaining({ days: 14 }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-BIZ-012: 按 start_date 查询 ETF 流向 → 201', async () => {
      const res = await req.post('/fund/etf-flow')
        .send({ start_date: '20240101' })
        .expect(201)
      expect(mockFundService.getEtfFlow).toHaveBeenCalledWith(
        expect.objectContaining({ start_date: '20240101' }),
      )
      expect(res.body.data).toHaveLength(1)
    })

    it('FD-ERR-005: start_date 格式错误应 400', async () => {
      await req.post('/fund/etf-flow')
        .send({ start_date: '2024-01-01' })
        .expect(400)
    })

    it('FD-ERR-006: days=0 应 400', async () => {
      await req.post('/fund/etf-flow')
        .send({ days: 0 })
        .expect(400)
    })

    it('FD-ERR-007: days 非数字应 400', async () => {
      await req.post('/fund/etf-flow')
        .send({ days: 'abc' })
        .expect(400)
    })

    it('FD-EDGE-003: days=1（最小）→ 201', async () => {
      await req.post('/fund/etf-flow')
        .send({ days: 1 })
        .expect(201)
    })

    it('FD-EDGE-004: start_date 格式正确 → 201', async () => {
      await req.post('/fund/etf-flow')
        .send({ start_date: '20240101' })
        .expect(201)
    })
  })
})
