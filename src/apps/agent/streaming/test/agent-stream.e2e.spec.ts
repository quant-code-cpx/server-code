import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { Test, type TestingModule } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import request from 'supertest'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { TokenPayload } from 'src/shared/token.interface'
import { AgentStreamConfig } from 'src/config/agent-stream.config'
import { AGENT_EVENT_FIXTURES } from '../../contracts'
import { AgentRunNotFoundError } from '../../execution/agent-execution.errors'
import { AgentStreamController } from '../../api/agent-stream.controller'
import { AgentErrorInterceptor } from '../../api/agent-error.interceptor'
import { AgentStrictBodyGuard } from '../../api/agent-strict-body.guard'
import { AgentStreamMetricsService } from '../agent-stream-metrics.service'
import { AgentStreamService, type AgentStreamSession } from '../agent-stream.service'

const user: TokenPayload = {
  id: 7,
  account: 'agent-sse-test',
  nickname: 'Agent SSE Test',
  role: UserRole.USER,
  jti: 'agent-sse-test-jti',
}

describe('AgentStreamController HTTP stream', () => {
  let app: INestApplication
  let streams: { open: jest.Mock }

  beforeEach(async () => {
    streams = { open: jest.fn().mockResolvedValue(finiteSession()) }
    const moduleRef = await createModule(streams, authenticatedGuard())
    app = createApp(moduleRef)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it('POST 返回 raw text/event-stream，不被 TransformInterceptor 包装', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/agent/runs/events')
      .set('Accept', 'text/event-stream')
      .set('Last-Event-ID', 'evt_41')
      .send({ runId: 'run_fixture', afterSequence: 3 })
      .expect(200)

    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.headers['cache-control']).toBe('no-cache, no-transform')
    expect(response.headers['x-accel-buffering']).toBe('no')
    expect(response.text).toContain('event: agent.completed')
    expect(response.text).not.toContain('"code":0')
    expect(streams.open).toHaveBeenCalledWith(7, 'run_fixture', 3, 'evt_41', expect.any(AbortSignal))
  })

  it('仅接受 POST，严格拒绝未知字段与非法 afterSequence', async () => {
    await request(app.getHttpServer()).get('/api/agent/runs/events').expect(404)
    const unknown = await request(app.getHttpServer())
      .post('/api/agent/runs/events')
      .send({ runId: 'run_fixture', afterSequence: 0, userId: 999 })
      .expect(400)
    expect(unknown.body).toMatchObject({ code: 9001 })
    await request(app.getHttpServer())
      .post('/api/agent/runs/events')
      .send({ runId: 'run_fixture', afterSequence: -1 })
      .expect(400)
  })

  it('owner 校验失败时保持 JSON 404/code 6002，未提前写 SSE headers', async () => {
    streams.open.mockRejectedValueOnce(new AgentRunNotFoundError())
    const response = await request(app.getHttpServer())
      .post('/api/agent/runs/events')
      .send({ runId: 'run_missing', afterSequence: 0 })
      .expect(404)

    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toMatchObject({ code: 6002 })
  })

  it('等待业务事件期间发送 heartbeat comment，且 heartbeat 不伪造业务 frame', async () => {
    streams.open.mockResolvedValueOnce(delayedSession(25))
    const response = await request(app.getHttpServer())
      .post('/api/agent/runs/events')
      .send({ runId: 'run_fixture', afterSequence: 0 })
      .expect(200)

    expect(response.text).toContain(': heartbeat\n\n')
    expect(response.text.match(/^event: /gm)).toHaveLength(1)
  })

  it('Swagger 声明 POST 200 raw stream，不声明 GET/201', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('1').build())
    const path = document.paths['/api/agent/runs/events']
    expect(path?.post?.responses).toHaveProperty('200')
    expect(path?.post?.responses).not.toHaveProperty('201')
    expect(path?.get).toBeUndefined()
  })
})

describe('AgentStreamController 鉴权', () => {
  it('无 JWT 返回 401，不调用 stream service', async () => {
    const streams = { open: jest.fn() }
    const moduleRef = await createModule(streams, {
      canActivate: () => {
        throw new UnauthorizedException('用户未登录或 Token 已失效')
      },
    })
    const app = createApp(moduleRef)
    await app.init()
    try {
      await request(app.getHttpServer())
        .post('/api/agent/runs/events')
        .send({ runId: 'run_fixture', afterSequence: 0 })
        .expect(401)
      expect(streams.open).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})

describe('AgentStreamController 背压', () => {
  it('Writable 长时间不 drain 时以 slow_consumer 关闭，不写半帧或 JSON 错误', async () => {
    const close = jest.fn()
    const session: AgentStreamSession = {
      events: (async function* () {
        yield AGENT_EVENT_FIXTURES.find((event) => event.type === 'agent.completed')!
      })(),
      terminationReason: null,
      close,
    }
    const streams = { open: jest.fn().mockResolvedValue(session) }
    const metrics = { recordBytes: jest.fn() }
    const controller = new AgentStreamController(
      streams as unknown as AgentStreamService,
      metrics as unknown as AgentStreamMetricsService,
      {
        heartbeatMs: 5,
        idleTimeoutMs: 10_000,
        maxConnectionsPerUser: 3,
        maxBufferBytes: 1_048_576,
        pollIntervalMs: 1,
      },
      mockLogger(),
    )
    const request = Object.assign(new EventEmitter(), {}) as unknown as ExpressRequest
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writableLength: 1024,
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      flushHeaders() {
        this.headersSent = true
      },
      write: jest.fn().mockReturnValue(false),
      end() {
        this.writableEnded = true
      },
    }) as unknown as ExpressResponse

    await controller.events(user, { runId: 'run_fixture', afterSequence: 0 }, undefined, request, response)

    expect(close).toHaveBeenCalledWith('slow_consumer')
    expect(metrics.recordBytes).toHaveBeenCalled()
    expect(response.writableEnded).toBe(true)
  })
})

async function createModule(streams: { open: jest.Mock }, guard: CanActivate): Promise<TestingModule> {
  const logger = mockLogger()
  return Test.createTestingModule({
    controllers: [AgentStreamController],
    providers: [
      AgentStrictBodyGuard,
      AgentErrorInterceptor,
      { provide: AgentStreamService, useValue: streams },
      { provide: AgentStreamMetricsService, useValue: { recordBytes: jest.fn() } },
      {
        provide: AgentStreamConfig.KEY,
        useValue: {
          heartbeatMs: 10,
          idleTimeoutMs: 10_000,
          maxConnectionsPerUser: 3,
          maxBufferBytes: 1_048_576,
          pollIntervalMs: 100,
        },
      },
      { provide: LoggerService, useValue: logger },
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
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(true, mockLogger()))
  return app
}

function finiteSession(): AgentStreamSession {
  let reason: AgentStreamSession['terminationReason'] = null
  return {
    events: (async function* () {
      yield AGENT_EVENT_FIXTURES.find((event) => event.type === 'agent.completed')!
      reason = 'terminal'
    })(),
    get terminationReason() {
      return reason
    },
    close: jest.fn(),
  }
}

function delayedSession(delayMs: number): AgentStreamSession {
  let reason: AgentStreamSession['terminationReason'] = null
  return {
    events: (async function* () {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      yield AGENT_EVENT_FIXTURES.find((event) => event.type === 'agent.completed')!
      reason = 'terminal'
    })(),
    get terminationReason() {
      return reason
    },
    close: jest.fn(),
  }
}

function mockLogger(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
}
