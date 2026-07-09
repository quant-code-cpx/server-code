import { UserRole } from '@prisma/client'
import { EventStudyController } from 'src/apps/event-study/event-study.controller'
import { EventSignalService } from 'src/apps/event-study/event-signal.service'
import { EventStudyService } from 'src/apps/event-study/event-study.service'
import { createTestApp, buildTestUser } from 'test/helpers/create-test-app'

describe('Event-study Fresh V2', () => {
  const mockEventStudyService = {
    getEventTypes: jest.fn(),
    getEventSchema: jest.fn(),
    queryEventsWithNames: jest.fn(),
    eventsCalendar: jest.fn(),
    analyze: jest.fn(),
  }

  const mockEventSignalService = {
    createRule: jest.fn(),
    listRules: jest.fn(),
    updateRule: jest.fn(),
    deleteRule: jest.fn(),
    previewRule: jest.fn(),
    scanAndGenerate: jest.fn(),
    enqueueScan: jest.fn(),
    getScanJobStatus: jest.fn(),
    querySignals: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('EST-V2-001 /event-study/event-types/list 返回 201 与数组', async () => {
    mockEventStudyService.getEventTypes.mockResolvedValue([{ eventType: 'FORECAST', label: '业绩预告' }])

    const { app, request } = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
      ],
    })

    await request.post('/event-study/event-types/list').send({}).expect(201).expect(({ body }) => {
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
    })

    await app.close()
  })

  it('EST-V2-002 /event-study/events 无效 eventType 返回 400', async () => {
    const { app, request } = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
      ],
    })

    await request
      .post('/event-study/events')
      .send({ eventType: 'INVALID', startDate: '20260101', endDate: '20260523' })
      .expect(400)

    await app.close()
  })

  it('EST-V2-003 普通用户调用 /event-study/signal-rules/scan 返回 403', async () => {
    const { app, request } = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
      ],
      user: buildTestUser({ role: UserRole.USER }),
    })

    await request.post('/event-study/signal-rules/scan').send({ tradeDate: '20260523' }).expect(403)

    await app.close()
  })

  it('EST-V2-004 /event-study/events 遇到 BigInt 字段不应 500（历史风险回归）', async () => {
    mockEventStudyService.queryEventsWithNames.mockResolvedValue({
      total: 1,
      items: [{ tsCode: '000001.SZ', eventDate: '20260523', cashDivTax: BigInt(1000) }],
    })

    const { app, request } = await createTestApp({
      controllers: [EventStudyController],
      providers: [
        { provide: EventStudyService, useValue: mockEventStudyService },
        { provide: EventSignalService, useValue: mockEventSignalService },
      ],
    })

    await request
      .post('/event-study/events')
      .send({ eventType: 'DIVIDEND_EX', startDate: '20260101', endDate: '20260523' })
      .expect(201)

    await app.close()
  })
})
