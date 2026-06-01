import { CanActivate, ExecutionContext } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { CalendarController } from 'src/apps/calendar/calendar.controller'
import { CalendarService } from 'src/apps/calendar/calendar.service'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { createTestApp } from 'test/helpers/create-test-app'

describe('Calendar Fresh V2', () => {
  const mockCalendarService = {
    getEventsByDateRange: jest.fn(),
    getUpcomingEvents: jest.fn(),
  }

  async function createCalendarAppWithAuth(authorized: boolean) {
    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [{ provide: CalendarService, useValue: mockCalendarService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext): boolean {
          if (!authorized) return false
          ctx.switchToHttp().getRequest().user = { id: 1, account: 'test', role: 'USER' }
          return true
        },
      } as CanActivate)
      .compile()

    const app = moduleRef.createNestApplication()
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new (await import('src/lifecycle/interceptors/transform.interceptor')).TransformInterceptor())
    app.useGlobalFilters(
      new (await import('src/lifecycle/filters/global.exception')).GlobalExceptionsFilter(
        true,
        {
          log: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          verbose: jest.fn(),
          devLog: jest.fn(),
        } as any,
      ),
    )
    await app.init()
    return {
      app,
      request: (await import('supertest')).default(app.getHttpServer()),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('CAL-V2-001 无 token 访问 /calendar/range 返回 403', async () => {
    const { app, request } = await createCalendarAppWithAuth(false)

    await request.post('/calendar/range').send({ startDate: '20260501', endDate: '20260523' }).expect(403)

    await app.close()
  })

  it('CAL-V2-003 /calendar/range 日期格式错误返回 400', async () => {
    const { app, request } = await createCalendarAppWithAuth(true)

    await request.post('/calendar/range').send({ startDate: 'abc', endDate: '20260523' }).expect(400)

    await app.close()
  })

  it('CAL-V2-004 /calendar/upcoming 默认 days=30', async () => {
    mockCalendarService.getUpcomingEvents.mockResolvedValue({ events: [] })

    const { app, request } = await createCalendarAppWithAuth(true)

    await request.post('/calendar/upcoming').send({}).expect(201)
    expect(mockCalendarService.getUpcomingEvents).toHaveBeenCalledWith(30)

    await app.close()
  })

  it('CAL-V2-005 /calendar/upcoming days=366 返回 400', async () => {
    const { app, request } = await createCalendarAppWithAuth(true)

    await request.post('/calendar/upcoming').send({ days: 366 }).expect(400)

    await app.close()
  })
})
