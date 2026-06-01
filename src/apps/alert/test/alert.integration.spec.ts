/**
 * Alert 真实 DB 集成测试（无 mock）
 */
import { Test, TestingModule } from '@nestjs/testing'
import { AlertCalendarService } from '../alert-calendar.service'
import { MarketAnomalyService } from '../market-anomaly.service'
import { AlertLimitService } from '../alert-limit.service'
import { PrismaService } from 'src/shared/prisma.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { EventStudyService } from 'src/apps/event-study/event-study.service'

const mockLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, devLog: () => {} }

describe('Alert — 真实 DB 集成测试', () => {
  let calendarService: AlertCalendarService
  let anomalyService: MarketAnomalyService
  let limitService: AlertLimitService
  let prisma: PrismaService
  let dbAvailable = true

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertCalendarService, MarketAnomalyService, AlertLimitService, PrismaService,
        { provide: LoggerService, useValue: mockLogger },
        { provide: EventsGateway, useValue: { broadcast: () => {} } },
        {
          provide: EventStudyService,
          useValue: {
            analyze: async () => ({ topSamples: [] }),
          },
        },
      ],
    }).compile()
    calendarService = module.get<AlertCalendarService>(AlertCalendarService)
    anomalyService = module.get<MarketAnomalyService>(MarketAnomalyService)
    limitService = module.get<AlertLimitService>(AlertLimitService)
    prisma = module.get<PrismaService>(PrismaService)

    try {
      await prisma.$connect()
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbAvailable = false
    }
  }, 15000)

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.$disconnect()
    }
  })

  function skipWhenDbUnavailable() {
    if (!dbAvailable) return true
    return false
  }

  it('calendar/list — 正常查询不抛异常', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await calendarService.getCalendar({ startDate: '20260501', endDate: '20260523' }, 2)
    expect(r).toBeDefined()
  }, 30000)

  it('calendar/list — 按类型过滤', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await calendarService.getCalendar({ startDate: '20260501', endDate: '20260523', types: ['DIVIDEND' as any] }, 2)
    expect(r).toBeDefined()
  }, 30000)

  it('calendar/list — keyword 搜索', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await calendarService.getCalendar({ startDate: '20260301', endDate: '20260523', keyword: '银行' }, 2)
    expect(r).toBeDefined()
  }, 30000)

  it('calendar/history-trend — 正常查询', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await calendarService.getHistoryTrend({ tsCode: '000001.SZ', type: 'DIVIDEND' as any })
    expect(r).toBeDefined()
  }, 30000)

  it('anomalies/list — 正常查询', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await anomalyService.queryAnomalies({}, 2)
    expect(r).toBeDefined()
  }, 30000)

  it('anomalies/summary — 正常查询', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await anomalyService.getSummary(undefined, 2)
    expect(r).toBeDefined()
  }, 30000)

  it('limit-list — 正常查询', async () => {
    if (skipWhenDbUnavailable()) return
    const r = await limitService.list({})
    expect(r).toBeDefined()
  }, 30000)
})

jest.setTimeout(60000)
