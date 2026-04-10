import { INestApplication, ExecutionContext, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { UserRole } from '@prisma/client'
import { StrategyDraftController } from '../strategy-draft.controller'
import { StrategyDraftService } from '../strategy-draft.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = testUser
    return true
  }),
}

const mockService = {
  getDrafts: jest.fn(async () => ({ drafts: [] })),
  getDraft: jest.fn(async () => ({ id: 1, name: '草稿1' })),
  createDraft: jest.fn(async () => ({ id: 1, name: '草稿1' })),
  updateDraft: jest.fn(async () => ({ id: 1, name: '更新草稿' })),
  deleteDraft: jest.fn(async () => ({ message: '删除成功' })),
  submitDraft: jest.fn(async () => ({ id: 'run-1', status: 'PENDING' })),
}

describe('StrategyDraftController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyDraftController],
      providers: [{ provide: StrategyDraftService, useValue: mockService }],
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

  it('POST /strategy-draft/list → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/list')
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.getDrafts).toHaveBeenCalled()
      }))

  it('POST /strategy-draft/detail → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/detail')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.id).toBe(1)
      }))

  it('POST /strategy-draft/create → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/create')
      .send({ name: '草稿1', config: {} })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.id).toBe(1)
        expect(mockService.createDraft).toHaveBeenCalled()
      }))

  it('POST /strategy-draft/update → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/update')
      .send({ id: 1, name: '更新草稿' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.updateDraft).toHaveBeenCalled()
      }))

  it('POST /strategy-draft/delete → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/delete')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.message).toBe('删除成功')
      }))

  it('POST /strategy-draft/submit → 200', () =>
    request(app.getHttpServer())
      .post('/strategy-draft/submit')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.submitDraft).toHaveBeenCalled()
      }))
})
