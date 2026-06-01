import { UserRole } from '@prisma/client'
import { AlertController } from 'src/apps/alert/alert.controller'
import { AlertCalendarService } from 'src/apps/alert/alert-calendar.service'
import { AlertLimitService } from 'src/apps/alert/alert-limit.service'
import { MarketAnomalyService } from 'src/apps/alert/market-anomaly.service'
import { PriceAlertService } from 'src/apps/alert/price-alert.service'
import { createTestApp, buildTestUser } from 'test/helpers/create-test-app'

describe('Alert Fresh V2', () => {
  const mockCalendarService = {
    getCalendar: jest.fn(),
    getHistoryTrend: jest.fn(),
  }

  const mockPriceAlertService = {
    createRule: jest.fn(),
    listRules: jest.fn(),
    listHistory: jest.fn(),
    scanStatus: jest.fn(),
    updateRule: jest.fn(),
    deleteRule: jest.fn(),
    runScan: jest.fn(),
  }

  const mockMarketAnomalyService = {
    queryAnomalies: jest.fn(),
    getSummary: jest.fn(),
    getDetail: jest.fn(),
    runScan: jest.fn(),
  }

  const mockAlertLimitService = {
    list: jest.fn(),
    summary: jest.fn(),
    nextDayPerf: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('ALT-V2-002 /alert/calendar/list 日期格式错误返回 400', async () => {
    const { app, request } = await createTestApp({
      controllers: [AlertController],
      providers: [
        { provide: AlertCalendarService, useValue: mockCalendarService },
        { provide: PriceAlertService, useValue: mockPriceAlertService },
        { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
        { provide: AlertLimitService, useValue: mockAlertLimitService },
      ],
    })

    await request.post('/alert/calendar/list').send({ startDate: '2026-05-01', endDate: '20260523' }).expect(400)

    await app.close()
  })

  it('ALT-V2-003 普通用户调用 /alert/anomalies/scan 返回 403', async () => {
    const { app, request } = await createTestApp({
      controllers: [AlertController],
      providers: [
        { provide: AlertCalendarService, useValue: mockCalendarService },
        { provide: PriceAlertService, useValue: mockPriceAlertService },
        { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
        { provide: AlertLimitService, useValue: mockAlertLimitService },
      ],
      user: buildTestUser({ role: UserRole.USER }),
    })

    await request.post('/alert/anomalies/scan').send({}).expect(403)

    await app.close()
  })

  it('ALT-V2-004 /alert/anomalies/detail 传 id 不传 anomalyId 应返回 400（契约预期）', async () => {
    mockMarketAnomalyService.getDetail.mockResolvedValue(null)

    const { app, request } = await createTestApp({
      controllers: [AlertController],
      providers: [
        { provide: AlertCalendarService, useValue: mockCalendarService },
        { provide: PriceAlertService, useValue: mockPriceAlertService },
        { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
        { provide: AlertLimitService, useValue: mockAlertLimitService },
      ],
    })

    await request.post('/alert/anomalies/detail').send({ id: 123 }).expect(400)

    await app.close()
  })

  it('ALT-V2-005 /alert/limit-list pageSize=201 应被限制到 <=200', async () => {
    mockAlertLimitService.list.mockImplementation(async (dto: { pageSize?: number }) => ({
      total: 0,
      page: 1,
      pageSize: dto.pageSize,
      items: [],
    }))

    const { app, request } = await createTestApp({
      controllers: [AlertController],
      providers: [
        { provide: AlertCalendarService, useValue: mockCalendarService },
        { provide: PriceAlertService, useValue: mockPriceAlertService },
        { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
        { provide: AlertLimitService, useValue: mockAlertLimitService },
      ],
    })

    await request.post('/alert/limit-list').send({ pageSize: 201 }).expect(201).expect(({ body }) => {
      expect(body.data.pageSize).toBeLessThanOrEqual(200)
    })

    await app.close()
  })
})
