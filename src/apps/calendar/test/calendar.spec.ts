/**
 * Calendar 模块 V2 测试（全新设计）
 *
 * 验证：range 查询、upcoming 查询、DTO 校验、JWT 鉴权
 */

import { Test, TestingModule } from '@nestjs/testing'
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { CalendarController } from '../calendar.controller'
import { CalendarService } from '../calendar.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { buildTestUser } from 'test/helpers/create-test-app'

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('CalendarController — DTO校验 + JWT鉴权', () => {
  let app: INestApplication
  let httpRequest: any
  let mockService: any

  beforeAll(async () => {
    mockService = {
      getEventsByDateRange: jest.fn().mockResolvedValue({ events: [] }),
      getUpcomingEvents: jest.fn().mockResolvedValue({ events: [] }),
    }

    const reflector = new Reflector()

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = buildTestUser()
        return true
      },
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: mockService },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    })
      .overrideGuard(require('src/lifecycle/guard/jwt-auth.guard').JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

    await app.init()
    httpRequest = request(app.getHttpServer())
  })

  afterAll(async () => {
    await app.close()
  })

  // ══════════════════════════════════════════════════════════════════════════
  describe('range', () => {
    it('正常查询', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501', endDate: '20260523' })
        .expect(201)
    })

    it('按类型过滤', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501', endDate: '20260523', types: ['DIVIDEND'] })
        .expect(201)
    })

    it('按 tsCodes 过滤', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501', endDate: '20260523', tsCodes: ['000001.SZ'] })
        .expect(201)
    })

    it('keyword 搜索', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501', endDate: '20260523', keyword: '平安' })
        .expect(201)
    })

    it('缺 startDate → 400', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ endDate: '20260523' })
        .expect(400)
    })

    it('缺 endDate → 400', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501' })
        .expect(400)
    })

    it('startDate 格式错误 → 400', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: 'abc', endDate: '20260523' })
        .expect(400)
    })

    it('endDate 格式错误 → 400', async () => {
      await httpRequest
        .post('/calendar/range')
        .send({ startDate: '20260501', endDate: 'abc' })
        .expect(400)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  describe('upcoming', () => {
    it('默认 30 天', async () => {
      await httpRequest
        .post('/calendar/upcoming')
        .send({})
        .expect(201)
    })

    it('自定义 7 天', async () => {
      await httpRequest
        .post('/calendar/upcoming')
        .send({ days: 7 })
        .expect(201)
    })

    it('days=365（最大值）', async () => {
      await httpRequest
        .post('/calendar/upcoming')
        .send({ days: 365 })
        .expect(201)
    })

    it('days=366（超限）→ 400', async () => {
      await httpRequest
        .post('/calendar/upcoming')
        .send({ days: 366 })
        .expect(400)
    })

    it('days=0 → 400', async () => {
      await httpRequest
        .post('/calendar/upcoming')
        .send({ days: 0 })
        .expect(400)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  describe('鉴权', () => {
    it('无 Token → 401', async () => {
      const unauthGuard: CanActivate = {
        canActivate(_ctx: ExecutionContext): boolean {
          throw new UnauthorizedException('用户未登录或 Token 已失效')
        },
      }

      const module2: TestingModule = await Test.createTestingModule({
        controllers: [CalendarController],
        providers: [
          { provide: CalendarService, useValue: mockService },
          { provide: LoggerService, useValue: createMockLoggerService() },
        ],
      })
        .overrideGuard(require('src/lifecycle/guard/jwt-auth.guard').JwtAuthGuard)
        .useValue(unauthGuard)
        .compile()

      const app2 = module2.createNestApplication()

      app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      app2.useGlobalInterceptors(new TransformInterceptor())
      app2.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

      await app2.init()
      const req2 = request(app2.getHttpServer())

      await req2.post('/calendar/range').send({ startDate: '20260501', endDate: '20260523' }).expect(401)

      await app2.close()
    })
  })
})
