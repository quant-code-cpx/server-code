import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AiMemoryCategory, AiMemorySensitivity, AiMemoryStatus, UserRole } from '@prisma/client'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { TokenPayload } from 'src/shared/token.interface'
import { AgentMemoryController } from '../../api/agent-memory.controller'
import { AgentErrorInterceptor } from '../../api/agent-error.interceptor'
import { AgentStrictBodyGuard } from '../../api/agent-strict-body.guard'
import { AgentMemoryNotFoundError } from '../memory-repository.errors'
import { UserMemoryService } from '../user-memory.service'

const user: TokenPayload = {
  id: 7,
  account: 'memory-api-test',
  nickname: 'Memory API Test',
  role: UserRole.USER,
  jti: 'memory-api-test-jti',
}

const memoryId = 'memory_test_1'
const createBody = {
  category: AiMemoryCategory.PREFERENCE,
  key: 'response.style',
  value: { style: 'concise' },
  sensitivity: AiMemorySensitivity.NORMAL,
  sourceConversationId: null,
  sourceMessageId: null,
  confidence: 0.9,
  expiresAt: null,
  topic: 'GENERAL',
  confirmation: true,
}
const routes = [
  { path: '/api/agent/memories/list', body: { cursor: null, limit: 30, includeInactive: false } },
  { path: '/api/agent/memories/create', body: createBody },
  {
    path: '/api/agent/memories/update',
    body: { memoryId, value: { style: 'detailed' }, topic: 'GENERAL', confirmation: true },
  },
  { path: '/api/agent/memories/delete', body: { memoryId } },
] as const

describe('AgentMemoryController', () => {
  let app: INestApplication
  let controller: AgentMemoryController
  let service: Record<string, jest.Mock>

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: jest.fn().mockResolvedValue(memoryResponse()),
      update: jest.fn().mockResolvedValue(memoryResponse({ version: 2 })),
      delete: jest
        .fn()
        .mockResolvedValue({ memoryId, status: AiMemoryStatus.REVOKED, deletedAt: new Date().toISOString() }),
    }
    const moduleRef = await createModule(service, authenticatedGuard())
    controller = moduleRef.get(AgentMemoryController)
    app = createApp(moduleRef)
    await app.init()
  })

  afterEach(async () => app.close())

  it('Controller 只向 Service 传认证 userId', async () => {
    await controller.create(user, createBody as never)
    await controller.update(user, routes[2].body as never)
    await controller.delete(user, routes[3].body)

    expect(service.create).toHaveBeenCalledWith(user.id, createBody)
    expect(service.update).toHaveBeenCalledWith(user.id, routes[2].body)
    expect(service.delete).toHaveBeenCalledWith(user.id, routes[3].body)
  })

  it.each(routes)('$path 只接受 POST，成功固定 200', async ({ path, body }) => {
    await request(app.getHttpServer()).post(path).send(body).expect(200)
    await request(app.getHttpServer()).get(path).expect(404)
  })

  it('拒绝 userId/未知字段、confirmation=false 和非法范围', async () => {
    await request(app.getHttpServer())
      .post('/api/agent/memories/create')
      .send({ ...createBody, userId: 999 })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/memories/create')
      .send({ ...createBody, confirmation: false })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/memories/list')
      .send({ cursor: null, limit: 101, includeInactive: false })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/memories/create')
      .send({ ...createBody, confidence: 1.01 })
      .expect(400)

    expect(service.create).not.toHaveBeenCalled()
    expect(service.list).not.toHaveBeenCalled()
  })

  it('Memory not-found 映射 404/6032', async () => {
    service.update.mockRejectedValueOnce(new AgentMemoryNotFoundError())
    const response = await request(app.getHttpServer())
      .post('/api/agent/memories/update')
      .send(routes[2].body)
      .expect(404)
    expect(response.body).toMatchObject({ code: 6032 })
  })

  it('Swagger 四端点只声明 200，不声明默认 201', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('1').build())
    for (const route of routes) {
      const operation = document.paths[route.path]?.post
      expect(operation).toBeDefined()
      expect(operation?.responses).toHaveProperty('200')
      expect(operation?.responses).not.toHaveProperty('201')
    }
  })
})

describe('AgentMemoryController 认证', () => {
  let app: INestApplication

  beforeAll(async () => {
    const service = { list: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() }
    const moduleRef = await createModule(service, {
      canActivate: () => {
        throw new UnauthorizedException('用户未登录或 Token 已失效')
      },
    })
    app = createApp(moduleRef)
    await app.init()
  })

  afterAll(async () => app.close())

  it.each(routes)('$path 无认证返回 401', async ({ path, body }) => {
    await request(app.getHttpServer()).post(path).send(body).expect(401)
  })
})

async function createModule(service: Record<string, jest.Mock>, guard: CanActivate): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [AgentMemoryController],
    providers: [AgentStrictBodyGuard, AgentErrorInterceptor, { provide: UserMemoryService, useValue: service }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(guard)
    .compile()
}

function authenticatedGuard(): CanActivate {
  return {
    canActivate(context: ExecutionContext) {
      context.switchToHttp().getRequest().user = user
      return true
    },
  }
}

function createApp(moduleRef: TestingModule): INestApplication {
  const app = moduleRef.createNestApplication()
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(true, logger))
  return app
}

function memoryResponse(overrides: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString()
  return {
    memoryId,
    category: AiMemoryCategory.PREFERENCE,
    key: 'response.style',
    value: { style: 'concise' },
    sensitivity: AiMemorySensitivity.NORMAL,
    status: AiMemoryStatus.CONFIRMED,
    sourceConversationId: null,
    sourceMessageId: null,
    confidence: 0.9,
    version: 1,
    validFrom: timestamp,
    confirmedAt: timestamp,
    expiresAt: timestamp,
    revokedAt: null,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
