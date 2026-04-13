import { INestApplication, ExecutionContext, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { UserRole } from '@prisma/client'
import { ScreenerSubscriptionController } from '../screener-subscription.controller'
import { ScreenerSubscriptionService } from '../screener-subscription.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = testUser
    return true
  }),
}

const mockService = {
  findAll: jest.fn(async () => ({ subscriptions: [] })),
  create: jest.fn(async () => ({ id: 1 })),
  update: jest.fn(async () => ({ id: 1 })),
  remove: jest.fn(async () => ({ message: '删除成功' })),
  pause: jest.fn(async () => ({ message: '已暂停' })),
  resume: jest.fn(async () => ({ message: '已恢复' })),
  manualRun: jest.fn(async () => ({ jobId: 'job-1', message: '任务已加入队列' })),
  getLogs: jest.fn(async () => ({ logs: [], total: 0, page: 1, pageSize: 20 })),
}

describe('ScreenerSubscriptionController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScreenerSubscriptionController],
      providers: [{ provide: ScreenerSubscriptionService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('POST /screener-subscription/list → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/list')
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.findAll).toHaveBeenCalled()
      }))

  it('POST /screener-subscription/create → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/create')
      .send({ name: '订阅1', filters: { minPe: 10 } })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.id).toBe(1)
        expect(mockService.create).toHaveBeenCalled()
      }))

  it('POST /screener-subscription/update → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/update')
      .send({ id: 1, name: '新名称' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.update).toHaveBeenCalled()
      }))

  it('POST /screener-subscription/delete → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/delete')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.message).toBe('删除成功')
      }))

  it('POST /screener-subscription/pause → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/pause')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.message).toBe('已暂停')
      }))

  it('POST /screener-subscription/resume → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/resume')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.message).toBe('已恢复')
      }))

  it('POST /screener-subscription/run → 200 + jobId', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/run')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.jobId).toBe('job-1')
        expect(mockService.manualRun).toHaveBeenCalled()
      }))

  it('POST /screener-subscription/logs → 200', () =>
    request(app.getHttpServer())
      .post('/screener-subscription/logs')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.getLogs).toHaveBeenCalled()
      }))
})
