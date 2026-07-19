import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { TokenPayload } from 'src/shared/token.interface'
import { AgentConversationNotFoundError } from '../../conversation/agent-conversation.errors'
import { AgentRunNotFoundError } from '../../execution/agent-execution.errors'
import { AgentConversationService } from '../../application/agent-conversation.service'
import { AgentRunService } from '../../application/agent-run.service'
import { AgentController } from '../agent.controller'
import { AgentErrorInterceptor } from '../agent-error.interceptor'
import { AgentStrictBodyGuard } from '../agent-strict-body.guard'

const user: TokenPayload = {
  id: 7,
  account: 'agent-api-test',
  nickname: 'Agent API Test',
  role: UserRole.USER,
  jti: 'agent-api-test-jti',
}

const requestId = '8e598a53-84d5-45bd-b06a-d8d10d3fb125'
const conversationId = 'cm_agent_test'
const messageId = 'msg_agent_test'
const runId = 'run_agent_test'

const routes = [
  {
    path: '/api/agent/conversations/create',
    body: { clientRequestId: requestId, title: '测试会话', modelPolicy: 'AUTO', preferredModel: null },
  },
  { path: '/api/agent/conversations/list', body: { cursor: null, limit: 30, includeArchived: false } },
  { path: '/api/agent/conversations/detail', body: { conversationId } },
  { path: '/api/agent/conversations/messages/list', body: { conversationId, beforeMessageId: null, limit: 50 } },
  {
    path: '/api/agent/conversations/model/update',
    body: { conversationId, modelPolicy: 'AUTO', preferredModel: null },
  },
  {
    path: '/api/agent/messages/send',
    body: {
      clientRequestId: requestId,
      conversationId,
      content: '分析贵州茅台',
      pageContext: { route: '/stock/detail', entityType: 'STOCK', entityId: '600519.SH' },
      modelPolicy: 'AUTO',
      allowedCapabilities: ['INTERNAL_DATA'],
    },
  },
  { path: '/api/agent/runs/regenerate', body: { clientRequestId: requestId, messageId, modelPolicy: 'AUTO' } },
  { path: '/api/agent/runs/status', body: { runId } },
  { path: '/api/agent/runs/cancel', body: { runId, expectedStatusVersion: 1 } },
  { path: '/api/agent/runs/tool-calls/list', body: { runId, includePayload: false } },
] as const

describe('AgentController', () => {
  let app: INestApplication
  let controller: AgentController
  let conversationService: Record<string, jest.Mock>
  let runService: Record<string, jest.Mock>

  beforeEach(async () => {
    conversationService = {
      create: jest.fn().mockResolvedValue({ conversationId, status: 'ACTIVE', createdAt: new Date().toISOString() }),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      detail: jest.fn().mockResolvedValue({ conversationId, status: 'ACTIVE' }),
      listMessages: jest.fn().mockResolvedValue({ items: [], nextBeforeMessageId: null }),
      updateModel: jest.fn().mockResolvedValue({ conversationId, modelPolicy: 'AUTO', preferredModel: null }),
    }
    runService = {
      send: jest.fn().mockResolvedValue({
        conversationId,
        userMessageId: 'msg_user',
        assistantMessageId: 'msg_assistant',
        runId,
        runStatus: 'QUEUED',
        streamEndpoint: '/api/agent/runs/events',
      }),
      regenerate: jest.fn().mockResolvedValue({
        conversationId,
        sourceMessageId: messageId,
        assistantMessageId: 'msg_assistant_v2',
        runId,
        runStatus: 'QUEUED',
        streamEndpoint: '/api/agent/runs/events',
      }),
      status: jest.fn().mockResolvedValue({ runId, status: 'QUEUED', statusVersion: 1 }),
      cancel: jest.fn().mockResolvedValue({ runId, status: 'CANCELLED', statusVersion: 2, cancellationAccepted: true }),
      listToolCalls: jest.fn().mockResolvedValue({ items: [], payloadIncluded: false }),
    }
    const moduleRef = await createModule(conversationService, runService, authenticatedGuard())
    controller = moduleRef.get(AgentController)
    app = createApp(moduleRef)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('Controller 单元调用只向 application service 传认证 userId', async () => {
    await controller.createConversation(user, routes[0].body)
    await controller.sendMessage(user, routes[5].body as never)
    await controller.cancelRun(user, routes[8].body)

    expect(conversationService.create).toHaveBeenCalledWith(user.id, routes[0].body)
    expect(runService.send).toHaveBeenCalledWith(user.id, routes[5].body)
    expect(runService.cancel).toHaveBeenCalledWith(user.id, routes[8].body)
  })

  it.each(routes)('$path 只接受 POST，成功状态固定 200', async ({ path, body }) => {
    await request(app.getHttpServer()).post(path).send(body).expect(HttpStatus.OK)
    await request(app.getHttpServer()).get(path).expect(404)
  })

  it('Agent 专用 Guard 在全局 whitelist 前拒绝顶层和嵌套未知字段', async () => {
    const topLevel = await request(app.getHttpServer())
      .post('/api/agent/conversations/create')
      .send({ ...routes[0].body, userId: 999 })
      .expect(400)
    expect(topLevel.body).toMatchObject({ code: 9001 })

    const nested = await request(app.getHttpServer())
      .post('/api/agent/messages/send')
      .send({ ...routes[5].body, pageContext: { ...routes[5].body.pageContext, secret: 'should-fail' } })
      .expect(400)
    expect(nested.body).toMatchObject({ code: 9001 })
  })

  it('非法 UUID、model、pageContext 和范围均拒绝', async () => {
    await request(app.getHttpServer())
      .post('/api/agent/conversations/create')
      .send({ ...routes[0].body, clientRequestId: 'not-uuid' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/messages/send')
      .send({ ...routes[5].body, modelPolicy: 'CUSTOM' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/messages/send')
      .send({ ...routes[5].body, pageContext: { route: 'javascript:alert(1)' } })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/messages/send')
      .send({ ...routes[5].body, pageContext: { route: '//evil.example/path' } })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/agent/messages/send')
      .send({ ...routes[5].body, pageContext: { route: '/stock/detail', visibleDataAsOf: '2026-99-99' } })
      .expect(400)
  })

  it('Agent domain not-found 映射显式 HTTP 与业务 code', async () => {
    conversationService.detail.mockRejectedValueOnce(new AgentConversationNotFoundError())
    runService.status.mockRejectedValueOnce(new AgentRunNotFoundError())

    const conversation = await request(app.getHttpServer())
      .post('/api/agent/conversations/detail')
      .send({ conversationId })
      .expect(404)
    expect(conversation.body).toMatchObject({ code: 6001 })

    const run = await request(app.getHttpServer()).post('/api/agent/runs/status').send({ runId }).expect(404)
    expect(run.body).toMatchObject({ code: 6002 })
  })

  it('Swagger 10 个端点只声明 200，不声明默认 201', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('1').build())
    for (const route of routes) {
      const operation = document.paths[route.path]?.post
      expect(operation).toBeDefined()
      expect(operation?.responses).toHaveProperty('200')
      expect(operation?.responses).not.toHaveProperty('201')
    }
  })
})

describe('AgentController 认证', () => {
  let app: INestApplication

  beforeAll(async () => {
    const services = {
      create: jest.fn(),
      list: jest.fn(),
      detail: jest.fn(),
      listMessages: jest.fn(),
      updateModel: jest.fn(),
    }
    const runs = {
      send: jest.fn(),
      regenerate: jest.fn(),
      status: jest.fn(),
      cancel: jest.fn(),
      listToolCalls: jest.fn(),
    }
    const moduleRef = await createModule(services, runs, {
      canActivate: () => {
        throw new UnauthorizedException('用户未登录或 Token 已失效')
      },
    })
    app = createApp(moduleRef)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it.each(routes)('$path 无认证返回 401', async ({ path, body }) => {
    await request(app.getHttpServer()).post(path).send(body).expect(401)
  })
})

async function createModule(
  conversationService: Record<string, jest.Mock>,
  runService: Record<string, jest.Mock>,
  guard: CanActivate,
): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [AgentController],
    providers: [
      AgentStrictBodyGuard,
      AgentErrorInterceptor,
      { provide: AgentConversationService, useValue: conversationService },
      { provide: AgentRunService, useValue: runService },
    ],
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
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(true, logger))
  return app
}

const HttpStatus = { OK: 200 }
