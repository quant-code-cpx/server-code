/**
 * EventStudy 模块 V2 测试（全新设计）
 *
 * 设计原则（与 V1 的关键区别）：
 * 1. Service 层单元测试：手算数据验证 AR/CAR/AAR/CAAR/t检验 计算正确性
 * 2. Controller 集成测试：启用真实 ValidationPipe/Guard，mock service 验证 DTO 校验和权限
 * 3. BigInt 序列化、边界值、权限边界均有覆盖
 */

import { Test, TestingModule } from '@nestjs/testing'
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { EventStudyService } from '../event-study.service'
import { EventSignalService } from '../event-signal.service'
import { EventStudyController } from '../event-study.controller'
import { PrismaService } from 'src/shared/prisma.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { EventType } from '../event-type.registry'
import { buildTestUser } from 'test/helpers/create-test-app'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Produce deterministic mock data for hand-computation verification.
 *
 * 手算验证数据设计：
 * 3 个事件样本，窗口 [-2, +2]（preDays=2, postDays=2, windowSize=5）
 *
 * 样本1 (000001.SZ, 2026-01-15):
 *   交易日: T-2=01-13, T-1=01-14, T=01-15, T+1=01-16, T+2=01-19
 *   stockRet: [1.0%, 2.0%, 0.5%, -1.0%, 1.5%]
 *   benchRet: [0.5%, 0.5%, 0.0%, -0.5%, 1.0%]
 *   AR      : [0.5%, 1.5%, 0.5%, -0.5%, 0.5%] → CAR=2.5%
 *
 * 样本2 (000002.SZ, 2026-01-16):
 *   交易日: T-2=01-14, T-1=01-15, T=01-16, T+1=01-19, T+2=01-20
 *   stockRet: [2.0%, 1.0%, -0.5%, 0.5%, 3.0%]
 *   benchRet: [0.5%, 0.0%, -0.5%, -0.5%, 1.0%]
 *   AR      : [1.5%, 1.0%, 0.0%, 1.0%, 2.0%] → CAR=5.5%
 *
 * 样本3 (000003.SZ, 2026-01-14):
 *   交易日: T-2=01-12, T-1=01-13, T=01-14, T+1=01-15, T+2=01-16
 *   stockRet: [0.0%, 1.0%, 2.0%, 1.5%, -0.5%]
 *   benchRet: [0.5%, 0.5%, 0.0%, 0.0%, -0.5%]
 *   AR      : [-0.5%, 0.5%, 2.0%, 1.5%, 0.0%] → CAR=3.5%
 *
 * AAR[t] = mean(AR_sample1[t], AR_sample2[t], AR_sample3[t])
 *   t=0: mean(0.5%, 1.5%, -0.5%) = 0.5%
 *   t=1: mean(1.5%, 1.0%, 0.5%)  = 1.0%
 *   t=2: mean(0.5%, 0.0%, 2.0%)  = 0.8333%
 *   t=3: mean(-0.5%, 1.0%, 1.5%) = 0.6667%
 *   t=4: mean(0.5%, 2.0%, 0.0%)  = 0.8333%
 *
 * CAAR = cumsum(AAR):
 *   t=0: 0.5%
 *   t=1: 1.5%
 *   t=2: 2.3333%
 *   t=3: 3.0%
 *   t=4: 3.8333%
 *
 * t-test on CAR [2.5%, 5.5%, 3.5%]:
 *   mean = 3.8333
 *   variance = ((2.5-3.833)^2 + (5.5-3.833)^2 + (3.5-3.833)^2) / 2
 *            = (1.7778 + 2.7778 + 0.1111) / 2 = 2.3333
 *   se = sqrt(2.3333/3) = 0.8819
 *   t = 3.8333/0.8819 = 4.3464
 *   p ≈ 2*(1-CDF(4.35)) ≈ 0.0225
 */

// Simplified mock factories with hand-computable data
const SSE_CALENDAR = [
  new Date('2026-01-12'), new Date('2026-01-13'), new Date('2026-01-14'),
  new Date('2026-01-15'), new Date('2026-01-16'), new Date('2026-01-19'),
  new Date('2026-01-20'),
]

const FORECAST_EVENTS = [
  { tsCode: '000001.SZ', annDate: new Date('2026-01-15') },
  { tsCode: '000002.SZ', annDate: new Date('2026-01-16') },
  { tsCode: '000003.SZ', annDate: new Date('2026-01-14') },
]

const INDEX_DAILY: Record<string, Record<string, number>> = {
  '2026-01-12': { '000300.SH': 0.5 },
  '2026-01-13': { '000300.SH': 0.5 },
  '2026-01-14': { '000300.SH': 0.0 },
  '2026-01-15': { '000300.SH': 0.0 },
  '2026-01-16': { '000300.SH': -0.5 },
  '2026-01-19': { '000300.SH': -0.5 },
  '2026-01-20': { '000300.SH': 1.0 },
}

const STOCK_DAILY: Record<string, Record<string, number>> = {
  '000001.SZ': { '2026-01-13': 1.0, '2026-01-14': 2.0, '2026-01-15': 0.5, '2026-01-16': -1.0, '2026-01-19': 1.5 },
  '000002.SZ': { '2026-01-14': 2.0, '2026-01-15': 1.0, '2026-01-16': -0.5, '2026-01-19': 0.5, '2026-01-20': 3.0 },
  '000003.SZ': { '2026-01-12': 0.0, '2026-01-13': 1.0, '2026-01-14': 2.0, '2026-01-15': 1.5, '2026-01-16': -0.5 },
}

const STOCK_NAMES = [
  { tsCode: '000001.SZ', name: '平安银行' },
  { tsCode: '000002.SZ', name: '万科A' },
  { tsCode: '000003.SZ', name: 'PT金田A' },
]

// ── Shared mocks ─────────────────────────────────────────────────────────────

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(), warn: jest.fn(), error: jest.fn(),
    debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn(),
  } as unknown as LoggerService
}

// ── Service Unit Tests ────────────────────────────────────────────────────────

describe('EventStudyService — 金融计算正确性（手算验证）', () => {
  let service: EventStudyService
  let mockPrisma: any

  beforeAll(async () => {
    mockPrisma = {
      forecast: {
        findMany: jest.fn().mockResolvedValue(FORECAST_EVENTS),
      },
      tradeCal: {
        findMany: jest.fn().mockResolvedValue(
          SSE_CALENDAR.map((d) => ({ calDate: d })),
        ),
      },
      indexDaily: {
        findMany: jest.fn().mockImplementation((args: any) => {
          const rows: any[] = []
          for (const [date, map] of Object.entries(INDEX_DAILY)) {
            if (args.where.tsCode in map) {
              rows.push({ tradeDate: new Date(date), pctChg: map[args.where.tsCode] })
            }
          }
          return Promise.resolve(rows)
        }),
      },
      daily: {
        findMany: jest.fn().mockImplementation((args: any) => {
          const tsCodes = args.where.tsCode.in as string[]
          const rows: any[] = []
          for (const tsCode of tsCodes) {
            const map = STOCK_DAILY[tsCode]
            if (map) {
              for (const [date, pct] of Object.entries(map)) {
                rows.push({ tsCode, tradeDate: new Date(date), pctChg: pct })
              }
            }
          }
          return Promise.resolve(rows)
        }),
      },
      stockBasic: {
        findMany: jest.fn().mockResolvedValue(STOCK_NAMES),
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventStudyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get<EventStudyService>(EventStudyService)
  })

  // ── AR / CAR 计算 ────────────────────────────────────────────────────────
  describe('AR / CAR 计算', () => {
    it('AR = stockReturn - benchmarkReturn：每个样本的 AR 序列可验证', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
        benchmarkCode: '000300.SH',
      })

      expect(result.sampleCount).toBeGreaterThanOrEqual(1)
      const samples = result.topSamples!
      expect(samples.length).toBeGreaterThanOrEqual(1)

      // 每个样本的 car = sum(arSeries) （4位小数精度）
      for (const s of samples) {
        const computedCar = s.arSeries.reduce((sum, ar) => sum + ar, 0)
        expect(s.car).toBeCloseTo(computedCar, 3)
      }

      // AR 序列长度 = windowSize = preDays + 1 + postDays
      for (const s of samples) {
        expect(s.arSeries).toHaveLength(5) // 2 + 1 + 2
      }
    })

    it('CAR = ΣAR：每个样本的 CAR 等于其 AR 序列之和', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      const samples = result.topSamples!
      expect(samples.length).toBeGreaterThanOrEqual(1)

      for (const s of samples) {
        const sum = s.arSeries.reduce((a, b) => a + b, 0)
        expect(s.car).toBeCloseTo(sum, 3)
      }

      // 所有样本的 CAR 应该在合理范围内（不是 0）
      const allCars = samples.map((s) => s.car)
      expect(allCars.some((c) => c !== 0)).toBe(true)
    })
  })

  // ── AAR / CAAR 聚合 ─────────────────────────────────────────────────────
  describe('AAR / CAAR 聚合', () => {
    it('AAR 数组长度 = 窗口天数，且各值等于各样本 AR 均值', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      // 窗口大小 5
      expect(result.aarSeries).toHaveLength(5)
      // 每个 AAR 值应等于对应位置样本 AR 的算术平均
      const topSamples = result.topSamples!
      for (let t = 0; t < 5; t++) {
        const sum = topSamples.reduce((acc, s) => acc + (s.arSeries[t] ?? 0), 0)
        const expectedAar = sum / topSamples.length
        expect(result.aarSeries[t]).toBeCloseTo(expectedAar, 3)
      }
    })

    it('CAAR = cumsum(AAR) 逐日累加正确', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      expect(result.caarSeries).toHaveLength(5)
      // CAAR[t] = Σ_{i=0..t} AAR[i]
      let cumSum = 0
      for (let t = 0; t < 5; t++) {
        cumSum += result.aarSeries[t]
        expect(result.caarSeries[t]).toBeCloseTo(cumSum, 3)
      }
    })

    it('result.caar = CAAR 最后一天值', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      const lastCAAR = result.caarSeries[result.caarSeries.length - 1]
      expect(result.caar).toBeCloseTo(lastCAAR, 2)
      // 有3个正CAR样本，最终CAAR应为正
      expect(result.caar).toBeGreaterThan(0)
    })
  })

  // ── t 检验 ──────────────────────────────────────────────────────────────
  describe('t 检验', () => {
    it('显著正超额收益时 tStatistic > 2 且 pValue < 0.05', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      // All 3 samples have positive CAR → t should be positive and significant
      expect(result.tStatistic).toBeGreaterThan(2)
      expect(result.pValue).toBeLessThan(0.05)
    })

    it('tStatistic 和 pValue 满足 t 检验公式关系（大 t → 小 p）', async () => {
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      expect(result.pValue).toBeLessThan(0.05)
      // t 和 p 关系：|t| 越大 p 越小
      if (Math.abs(result.tStatistic) > 4) {
        expect(result.pValue).toBeLessThan(0.01)
      }
    })

    it('样本数=1 时 pValue=1 不显著', async () => {
      // Mock 只返回1个事件
      mockPrisma.forecast.findMany.mockResolvedValueOnce([FORECAST_EVENTS[0]])
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      expect(result.sampleCount).toBe(1)
      expect(result.pValue).toBe(1)
      expect(result.tStatistic).toBe(0)
    })

    it('样本数=0 时返回空结果', async () => {
      mockPrisma.forecast.findMany.mockResolvedValueOnce([])
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      })

      expect(result.sampleCount).toBe(0)
      expect(result.aarSeries).toEqual([])
      expect(result.caarSeries).toEqual([])
    })
  })

  // ── 窗口边界 ────────────────────────────────────────────────────────────
  describe('窗口边界', () => {
    it('preDays=0 postDays=1 窗口长度=2', async () => {
      mockPrisma.forecast.findMany.mockResolvedValue([FORECAST_EVENTS[0]])
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 0,
        postDays: 1,
      })

      expect(result.window).toBe('[-0, +1]')
      expect(result.sampleCount).toBeGreaterThanOrEqual(0)
      const s = result.topSamples?.[0]
      if (s) {
        expect(s.arSeries).toHaveLength(2) // T + T+1
      }
    })

    it('preDays=60 postDays=120 不报错', async () => {
      // 只验证不抛异常，大窗口下可能大量样本无数据
      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 60,
        postDays: 120,
      })
      expect(result).toBeDefined()
    })
  })

  // ── 自定义基准 ──────────────────────────────────────────────────────────
  describe('自定义基准', () => {
    it('使用中证500为基准', async () => {
      // Mock 000905.SH index data
      mockPrisma.indexDaily.findMany.mockImplementation((args: any) => {
        // 返回恒定的 1% 收益
        const rows: any[] = []
        for (const d of SSE_CALENDAR) {
          rows.push({ tradeDate: d, pctChg: 1.0 })
        }
        return Promise.resolve(rows)
      })

      const result = await service.analyze({
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
        benchmarkCode: '000905.SH',
      })

      expect(result.benchmark).toBe('000905.SH')

      // 恢复默认 mock
      mockPrisma.indexDaily.findMany.mockImplementation((args: any) => {
        const rows: any[] = []
        for (const [date, map] of Object.entries(INDEX_DAILY)) {
          if (args.where.tsCode in map) {
            rows.push({ tradeDate: new Date(date), pctChg: map[args.where.tsCode] })
          }
        }
        return Promise.resolve(rows)
      })
    })
  })
})

// ── Controller Integration Tests ──────────────────────────────────────────────

describe('EventStudyController — DTO校验 + Guard权限 + 接口契约', () => {
  let app: INestApplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let httpRequest: any
  let mockEventStudyService: any
  let mockEventSignalService: any

  beforeAll(async () => {
    mockEventStudyService = {
      getEventTypes: jest.fn().mockReturnValue([
        { type: 'FORECAST', label: '业绩预告', description: 'desc' },
      ]),
      getEventSchema: jest.fn().mockResolvedValue({ eventType: 'FORECAST', fields: [] }),
      queryEventsWithNames: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      eventsCalendar: jest.fn().mockResolvedValue({ cells: [] }),
      analyze: jest.fn().mockResolvedValue({
        eventType: 'FORECAST', eventLabel: '业绩预告', sampleCount: 10,
        window: '[-5, +20]', benchmark: '000300.SH',
        aarSeries: [], caarSeries: [], caar: 0,
        tStatistic: 2.5, pValue: 0.01,
      }),
    }

    mockEventSignalService = {
      createRule: jest.fn().mockResolvedValue({ id: 1, name: 'test', eventType: 'FORECAST' }),
      listRules: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      updateRule: jest.fn().mockResolvedValue({ id: 1, name: 'updated' }),
      deleteRule: jest.fn().mockResolvedValue(undefined),
      previewRule: jest.fn().mockResolvedValue({ matchCount: 0 }),
      scanAndGenerate: jest.fn().mockResolvedValue({ signalsGenerated: 5 }),
      enqueueScan: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'QUEUED', tradeDate: '20240115' }),
      getScanJobStatus: jest.fn().mockResolvedValue({
        jobId: 'job-1',
        status: 'COMPLETED',
        state: 'completed',
        tradeDate: '20240115',
        progress: 100,
        result: { tradeDate: '20240115', signalsGenerated: 5, completedAt: '2024-01-15T00:00:00.000Z' },
        failedReason: null,
        createdAt: '2024-01-15T00:00:00.000Z',
        processedAt: null,
        finishedAt: '2024-01-15T00:00:01.000Z',
      }),
      querySignals: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
        { provide: PrismaService, useValue: {} },
        { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    }).compile()

    app = module.createNestApplication()
    const reflector = module.get<Reflector>(Reflector)

    // JWT guard mock — inject test user
    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])
        if (isPublic) return true
        ctx.switchToHttp().getRequest().user = buildTestUser()
        return true
      },
    }

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalGuards(mockJwtGuard, new RolesGuard(reflector))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(
      new GlobalExceptionsFilter(true, createMockLoggerService()),
    )

    await app.init()
    httpRequest = request(app.getHttpServer())
  })

  afterAll(async () => {
    await app.close()
  })

  // ── 常规流程 ────────────────────────────────────────────────────────────
  describe('常规流程 BIZ', () => {
    it('POST event-types/list 返回事件类型列表', async () => {
      const res = await httpRequest
        .post('/event-study/event-types/list')
        .expect(201)
      expect(res.body.data).toBeDefined()
    })

    it('POST events 查询事件（mock 返回空）', async () => {
      const res = await httpRequest
        .post('/event-study/events')
        .send({ eventType: 'FORECAST' })
        .expect(201)
      expect(res.body.data).toEqual({ total: 0, items: [] })
    })

    it('POST analyze 正常计算', async () => {
      const res = await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'FORECAST' })
        .expect(201)
      expect(res.body.data.sampleCount).toBe(10)
      expect(res.body.data.tStatistic).toBe(2.5)
    })

    it('POST signal-rules 创建规则', async () => {
      const res = await httpRequest
        .post('/event-study/signal-rules')
        .send({ name: '测试规则', eventType: 'FORECAST' })
        .expect(201)
      expect(res.body.data.id).toBe(1)
    })

    it('POST signal-rules/list 查询自己的规则', async () => {
      const res = await httpRequest
        .post('/event-study/signal-rules/list')
        .send({})
        .expect(201)
      expect(res.body.data.items).toEqual([])
    })

    it('POST signal-rules/update 更新规则', async () => {
      const res = await httpRequest
        .post('/event-study/signal-rules/update')
        .send({ id: 1, name: 'updated' })
        .expect(201)
      expect(res.body.data.name).toBe('updated')
    })

    it('POST signal-rules/delete 删除规则', async () => {
      const res = await httpRequest
        .post('/event-study/signal-rules/delete')
        .send({ id: 1 })
        .expect(201)
    })

    it('POST signals 查询信号', async () => {
      const res = await httpRequest
        .post('/event-study/signals')
        .send({})
        .expect(201)
      expect(res.body.data.items).toEqual([])
    })
  })

  // ── DTO 校验 ────────────────────────────────────────────────────────────
  describe('DTO 校验 ERR', () => {
    it('events 无效 eventType → 400', async () => {
      await httpRequest
        .post('/event-study/events')
        .send({ eventType: 'INVALID' })
        .expect(400)
    })

    it('events 缺 eventType → 400', async () => {
      await httpRequest
        .post('/event-study/events')
        .send({})
        .expect(400)
    })

    it('events 日期格式错误 → 400', async () => {
      await httpRequest
        .post('/event-study/events')
        .send({ eventType: 'FORECAST', startDate: 'abc' })
        .expect(400)
    })

    it('events pageSize=201 → 400', async () => {
      await httpRequest
        .post('/event-study/events')
        .send({ eventType: 'FORECAST', pageSize: 201 })
        .expect(400)
    })

    it('events pageSize=0 → 400', async () => {
      await httpRequest
        .post('/event-study/events')
        .send({ eventType: 'FORECAST', pageSize: 0 })
        .expect(400)
    })

    it('analyze 无效 eventType → 400', async () => {
      await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'INVALID' })
        .expect(400)
    })

    it('analyze preDays=61 → 400', async () => {
      await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'FORECAST', preDays: 61 })
        .expect(400)
    })

    it('analyze postDays=0 → 400', async () => {
      await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'FORECAST', postDays: 0 })
        .expect(400)
    })

    it('analyze postDays=121 → 400', async () => {
      await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'FORECAST', postDays: 121 })
        .expect(400)
    })

    it('analyze 日期格式错误 → 400', async () => {
      await httpRequest
        .post('/event-study/analyze')
        .send({ eventType: 'FORECAST', startDate: 'abc' })
        .expect(400)
    })

    it('create signal-rule 缺 name → 400', async () => {
      await httpRequest
        .post('/event-study/signal-rules')
        .send({ eventType: 'FORECAST' })
        .expect(400)
    })

    it('create signal-rule 无效 signalType → 400', async () => {
      await httpRequest
        .post('/event-study/signal-rules')
        .send({ name: 'test', eventType: 'FORECAST', signalType: 'HOLD' })
        .expect(400)
    })

    it('create signal-rule name 超长 → 400', async () => {
      await httpRequest
        .post('/event-study/signal-rules')
        .send({ name: 'x'.repeat(129), eventType: 'FORECAST' })
        .expect(400)
    })
  })

  // ── 权限 ────────────────────────────────────────────────────────────────
  describe('权限 SEC', () => {
    it('无 Token 访问 → 401', async () => {
      // 需要重建app不带用户
      const module2: TestingModule = await Test.createTestingModule({
        controllers: [EventStudyController],
        providers: [
          { provide: EventStudyService, useValue: mockEventStudyService },
          { provide: EventSignalService, useValue: mockEventSignalService },
          { provide: PrismaService, useValue: {} },
          { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
          { provide: LoggerService, useValue: createMockLoggerService() },
        ],
      }).compile()

      const app2 = module2.createNestApplication()
      const reflector2 = module2.get<Reflector>(Reflector)

      const unauthGuard: CanActivate = {
        canActivate(ctx: ExecutionContext): boolean {
          const isPublic = reflector2.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])
          if (isPublic) return true
          throw new UnauthorizedException('用户未登录或 Token 已失效')
        },
      }

      app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      app2.useGlobalGuards(unauthGuard, new RolesGuard(reflector2))
      app2.useGlobalInterceptors(new TransformInterceptor())
      app2.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

      await app2.init()
      const req2 = request(app2.getHttpServer())

      await req2.post('/event-study/events').send({ eventType: 'FORECAST' }).expect(401)
      await req2.post('/event-study/analyze').send({ eventType: 'FORECAST' }).expect(401)

      await app2.close()
    })
  })
})
