import { INestApplication, ExecutionContext, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { UserRole } from '@prisma/client'
import { ResearchNoteController } from '../research-note.controller'
import { ResearchNoteService } from '../research-note.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = testUser
    return true
  }),
}

const mockService = {
  findAll: jest.fn(async () => ({ notes: [], total: 0, page: 1, pageSize: 20 })),
  getUserTags: jest.fn(async () => ({ tags: ['量化'] })),
  findByStock: jest.fn(async () => ({ notes: [], total: 0 })),
  findOne: jest.fn(async () => ({ id: 1, title: '笔记1' })),
  create: jest.fn(async () => ({ id: 1, title: '新笔记' })),
  update: jest.fn(async () => ({ id: 1, title: '更新笔记' })),
  remove: jest.fn(async () => ({ message: '删除成功' })),
}

describe('ResearchNoteController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResearchNoteController],
      providers: [{ provide: ResearchNoteService, useValue: mockService }],
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

  it('POST /research-note/list → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/list')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.findAll).toHaveBeenCalled()
      }))

  it('POST /research-note/tags → 200 + 标签列表', () =>
    request(app.getHttpServer())
      .post('/research-note/tags')
      .expect(201)
      .expect((res) => {
        expect(res.body.data.tags).toEqual(['量化'])
      }))

  it('POST /research-note/stock → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/stock')
      .send({ tsCode: '000001.SZ' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.findByStock).toHaveBeenCalled()
      }))

  it('POST /research-note/detail → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/detail')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.id).toBe(1)
      }))

  it('POST /research-note/create → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/create')
      .send({ title: '新笔记', content: '内容' })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.id).toBe(1)
        expect(mockService.create).toHaveBeenCalled()
      }))

  it('POST /research-note/update → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/update')
      .send({ id: 1, title: '更新笔记' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.update).toHaveBeenCalled()
      }))

  it('POST /research-note/delete → 200', () =>
    request(app.getHttpServer())
      .post('/research-note/delete')
      .send({ id: 1 })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.message).toBe('删除成功')
      }))
})
