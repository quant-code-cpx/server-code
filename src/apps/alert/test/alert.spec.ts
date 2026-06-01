/**
 * Alert 模块 V2 测试（全新设计）
 *
 * 覆盖：事件日历、异动监控、涨跌停明细、价格预警的 Controller DTO 校验 + Guard 权限
 * Service 层依赖 Prisma 查询，主要验证接口契约和权限边界。
 */

import { Test, TestingModule } from '@nestjs/testing'
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { AlertController } from '../alert.controller'
import { AlertCalendarService } from '../alert-calendar.service'
import { PriceAlertService } from '../price-alert.service'
import { MarketAnomalyService } from '../market-anomaly.service'
import { AlertLimitService } from '../alert-limit.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { buildTestUser } from 'test/helpers/create-test-app'

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('AlertController — DTO校验 + Guard权限 + 接口契约', () => {
  let app: INestApplication
  let httpRequest: any
  let mockCalendar: any
  let mockPriceAlert: any
  let mockAnomaly: any
  let mockLimit: any

  beforeAll(async () => {
    mockCalendar = {
      getCalendar: jest.fn().mockResolvedValue({ totalCount: 0, events: [] }),
      getHistoryTrend: jest.fn().mockResolvedValue({ samples: [], average: {} }),
    }
    mockPriceAlert = {
      createRule: jest.fn().mockResolvedValue({ id: 1 }),
      listRules: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listHistory: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      scanStatus: jest.fn().mockResolvedValue({ lastScanAt: null, activeCount: 0 }),
      updateRule: jest.fn().mockResolvedValue({ id: 1, name: 'updated' }),
      deleteRule: jest.fn().mockResolvedValue(undefined),
      runScan: jest.fn().mockResolvedValue({ scanned: 5 }),
    }
    mockAnomaly = {
      queryAnomalies: jest.fn().mockResolvedValue({ items: [], total: 0, stats: { byType: {}, total: 0 } }),
      getSummary: jest.fn().mockResolvedValue({ byType: {}, total: 0 }),
      getDetail: jest.fn().mockResolvedValue({ id: 1 }),
      runScan: jest.fn().mockResolvedValue({ scanned: 0 }),
    }
    mockLimit = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      summary: jest.fn().mockResolvedValue([]),
      nextDayPerf: jest.fn().mockResolvedValue([]),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlertController],
      providers: [
        { provide: AlertCalendarService, useValue: mockCalendar },
        { provide: PriceAlertService, useValue: mockPriceAlert },
        { provide: MarketAnomalyService, useValue: mockAnomaly },
        { provide: AlertLimitService, useValue: mockLimit },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    }).compile()

    app = module.createNestApplication()
    const reflector = module.get<Reflector>(Reflector)

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
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

    await app.init()
    httpRequest = request(app.getHttpServer())
  })

  afterAll(async () => {
    await app.close()
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 事件日历 calendar/list + calendar/history-trend
  // ══════════════════════════════════════════════════════════════════════════
  describe('事件日历', () => {
    it('calendar/list 正常查询', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ startDate: '20260501', endDate: '20260523' })
        .expect(201)
    })

    it('calendar/list 缺少 startDate → 400', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ endDate: '20260523' })
        .expect(400)
    })

    it('calendar/list 日期格式错误 → 400', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ startDate: 'abc', endDate: '20260523' })
        .expect(400)
    })

    it('calendar/list keyword 搜索', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ startDate: '20260501', endDate: '20260523', keyword: '平安' })
        .expect(201)
    })

    it('calendar/list marketCapBuckets 过滤', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ startDate: '20260501', endDate: '20260523', marketCapBuckets: ['MEGA'] })
        .expect(201)
    })

    it('calendar/list impactLevels 过滤', async () => {
      await httpRequest
        .post('/alert/calendar/list')
        .send({ startDate: '20260501', endDate: '20260523', impactLevels: ['HIGH'] })
        .expect(201)
    })

    it('calendar/history-trend 正常查询', async () => {
      await httpRequest
        .post('/alert/calendar/history-trend')
        .send({ tsCode: '000001.SZ', type: 'DIVIDEND' })
        .expect(201)
    })

    it('calendar/history-trend 缺少 tsCode → 400', async () => {
      await httpRequest
        .post('/alert/calendar/history-trend')
        .send({ type: 'DIVIDEND' })
        .expect(400)
    })

    it('calendar/history-trend 无效 type → 400', async () => {
      await httpRequest
        .post('/alert/calendar/history-trend')
        .send({ tsCode: '000001.SZ', type: 'INVALID' })
        .expect(400)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 异动监控 anomalies/*
  // ══════════════════════════════════════════════════════════════════════════
  describe('异动监控', () => {
    it('anomalies/list 正常查询', async () => {
      await httpRequest
        .post('/alert/anomalies/list')
        .send({ tradeDate: '20260522' })
        .expect(201)
    })

    it('anomalies/summary 查询', async () => {
      await httpRequest
        .post('/alert/anomalies/summary')
        .send({ tradeDate: '20260522' })
        .expect(201)
    })

    it('anomalies/detail 查询', async () => {
      await httpRequest
        .post('/alert/anomalies/detail')
        .send({ anomalyId: 1 })
        .expect(201)
    })

    it('anomalies/list 按 type 过滤', async () => {
      await httpRequest
        .post('/alert/anomalies/list')
        .send({ type: 'VOLUME_SURGE' })
        .expect(201)
    })

    it('anomalies/list 日期格式错误 → 400', async () => {
      await httpRequest
        .post('/alert/anomalies/list')
        .send({ tradeDate: 'abc' })
        .expect(400)
    })

    it('anomalies/list sortBy 无效 → 400', async () => {
      await httpRequest
        .post('/alert/anomalies/list')
        .send({ sortBy: 'invalidField' })
        .expect(400)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 涨跌停 limit-list / limit-summary / limit-next-day-perf
  // ══════════════════════════════════════════════════════════════════════════
  describe('涨跌停', () => {
    it('limit-list 正常查询', async () => {
      await httpRequest
        .post('/alert/limit-list')
        .send({ tradeDate: '20260522' })
        .expect(201)
    })

    it('limit-list limitType=UP 过滤', async () => {
      await httpRequest
        .post('/alert/limit-list')
        .send({ limitType: 'UP' })
        .expect(201)
    })

    it('limit-list limitType=DOWN 过滤', async () => {
      await httpRequest
        .post('/alert/limit-list')
        .send({ limitType: 'DOWN' })
        .expect(201)
    })

    it('limit-list 日期格式错误 → 400', async () => {
      await httpRequest
        .post('/alert/limit-list')
        .send({ tradeDate: 'abc' })
        .expect(400)
    })

    it('limit-list pageSize=201 → 自动截断为 200（201 通过）', async () => {
      await httpRequest
        .post('/alert/limit-list')
        .send({ pageSize: 201 })
        .expect(201)
    })

    it('limit-summary range 超限 → 400', async () => {
      await httpRequest
        .post('/alert/limit-summary')
        .send({ range: 31 })
        .expect(400)
    })

    it('limit-next-day-perf 正常查询', async () => {
      await httpRequest
        .post('/alert/limit-next-day-perf')
        .send({ tradeDate: '20260522' })
        .expect(201)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // 价格预警 price-rules CRUD
  // ══════════════════════════════════════════════════════════════════════════
  describe('价格预警', () => {
    it('创建规则', async () => {
      await httpRequest
        .post('/alert/price-rules')
        .send({ tsCode: '000001.SZ', ruleType: 'PRICE_ABOVE', threshold: 100 })
        .expect(201)
    })

    it('创建规则缺 tsCode 且无 watchlistId/portfolioId → 400', async () => {
      await httpRequest
        .post('/alert/price-rules')
        .send({ ruleType: 'PRICE_ABOVE', threshold: 100 })
        .expect(400)
    })

    it('创建规则缺 ruleType → 400', async () => {
      await httpRequest
        .post('/alert/price-rules')
        .send({ tsCode: '000001.SZ' })
        .expect(400)
    })

    it('列表查询', async () => {
      await httpRequest
        .post('/alert/price-rules/list')
        .send({})
        .expect(201)
    })

    it('列表查询按状态过滤', async () => {
      await httpRequest
        .post('/alert/price-rules/list')
        .send({ status: 'ACTIVE' })
        .expect(201)
    })

    it('更新规则', async () => {
      await httpRequest
        .post('/alert/price-rules/update')
        .send({ id: 1, threshold: 50 })
        .expect(201)
    })

    it('更新规则缺 id → 400', async () => {
      await httpRequest
        .post('/alert/price-rules/update')
        .send({ threshold: 50 })
        .expect(400)
    })

    it('删除规则', async () => {
      await httpRequest
        .post('/alert/price-rules/delete')
        .send({ id: 1 })
        .expect(201)
    })

    it('scan-status 查询', async () => {
      await httpRequest
        .post('/alert/price-rules/scan-status')
        .send({})
        .expect(201)
    })
  })
})
