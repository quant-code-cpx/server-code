import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { UserRole } from '@prisma/client'
import { CalendarController } from '../calendar.controller'
import { CalendarService } from '../calendar.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
const mockService = { getEventsByDateRange: jest.fn(), getUpcomingEvents: jest.fn() }
const mockJwtGuard = { canActivate: jest.fn((ctx: ExecutionContext) => { ctx.switchToHttp().getRequest().user = testUser; return true }) }

describe('CalendarController', () => {
  let app: INestApplication
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [CalendarController], providers: [{ provide: CalendarService, useValue: mockService }],
    }).overrideGuard(JwtAuthGuard).useValue(mockJwtGuard).compile()
    app = m.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    await app.init()
  })
  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('[BIZ] POST /calendar/range → 201', async () => {
    mockService.getEventsByDateRange.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/calendar/range').send({ startDate: '20240101', endDate: '20240131' }).expect(201)
  })
  it('[BIZ] POST /calendar/upcoming → 201', async () => {
    mockService.getUpcomingEvents.mockResolvedValueOnce([])
    await request(app.getHttpServer()).post('/calendar/upcoming').send({}).expect(201)
  })
})
