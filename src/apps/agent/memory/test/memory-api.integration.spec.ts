import { randomUUID } from 'node:crypto'
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  AiMemoryCategory,
  AiMemorySensitivity,
  AiMemoryStatus,
  AiMessageRole,
  AiMessageStatus,
  PrismaClient,
  UserRole,
  type User,
} from '@prisma/client'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import type { TokenPayload } from 'src/shared/token.interface'
import { createTemporaryAgentDatabase, type TemporaryAgentDatabase } from 'test/agent/support/temporary-agent-database'
import { AgentMemoryController } from '../../api/agent-memory.controller'
import { AgentErrorInterceptor } from '../../api/agent-error.interceptor'
import { AgentStrictBodyGuard } from '../../api/agent-strict-body.guard'
import { UserMemoryRepository } from '../user-memory.repository'
import { UserMemoryService } from '../user-memory.service'

const runIntegration = process.env.RUN_AGENT_MEMORY_API_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

integrationDescribe('Agent Memory API - 独立 PostgreSQL HTTP 集成测试', () => {
  let database: TemporaryAgentDatabase | undefined
  let client: PrismaClient
  let app: INestApplication
  let userA: User
  let userB: User

  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService

  beforeAll(async () => {
    database = await createTemporaryAgentDatabase()
    client = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } })
    await client.$connect()
    userA = await createUser('memory_api_a')
    userB = await createUser('memory_api_b')
    const repository = new UserMemoryRepository(client as unknown as PrismaService, logger)
    const service = new UserMemoryService(repository)
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentMemoryController],
      providers: [AgentStrictBodyGuard, AgentErrorInterceptor, { provide: UserMemoryService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard())
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, logger))
    await app.init()
  }, 240_000)

  beforeEach(async () => {
    await client.aiUserMemory.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
    await client.aiMessage.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
    await client.aiConversation.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } })
  })

  afterAll(async () => {
    await app?.close()
    await client?.$disconnect()
    await database?.dispose()
  }, 60_000)

  it('JWT A 完成创建、列表、纠错、includeInactive 和删除闭环', async () => {
    const created = await post(userA.id, '/api/agent/memories/create', createBody()).expect(200)
    expect(created.body.data).toMatchObject({
      category: AiMemoryCategory.PREFERENCE,
      key: 'response.style',
      status: AiMemoryStatus.CONFIRMED,
      version: 1,
    })
    expect(created.body.data).not.toHaveProperty('userId')
    const memoryId = created.body.data.memoryId as string

    const active = await post(userA.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 30,
      includeInactive: false,
    }).expect(200)
    expect(active.body.data.items.map((item: { memoryId: string }) => item.memoryId)).toEqual([memoryId])

    const corrected = await post(userA.id, '/api/agent/memories/update', {
      memoryId,
      value: { style: 'detailed' },
      topic: 'GENERAL',
      confirmation: true,
    }).expect(200)
    expect(corrected.body.data).toMatchObject({ version: 2, value: { style: 'detailed' } })

    const history = await post(userA.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 30,
      includeInactive: true,
    }).expect(200)
    expect(history.body.data.items).toHaveLength(2)
    expect(new Set(history.body.data.items.map((item: { status: string }) => item.status))).toEqual(
      new Set([AiMemoryStatus.CONFIRMED, AiMemoryStatus.REVOKED]),
    )

    const deleted = await post(userA.id, '/api/agent/memories/delete', {
      memoryId: corrected.body.data.memoryId,
    }).expect(200)
    expect(deleted.body.data).toMatchObject({ status: AiMemoryStatus.REVOKED })
    expect(deleted.body.data.deletedAt).toEqual(expect.any(String))

    const afterDelete = await post(userA.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 30,
      includeInactive: false,
    }).expect(200)
    expect(afterDelete.body.data.items).toEqual([])
    const historyAfterDelete = await post(userA.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 30,
      includeInactive: true,
    }).expect(200)
    expect(historyAfterDelete.body.data.items).toHaveLength(1)
    expect(historyAfterDelete.body.data.items[0]).toMatchObject({ status: AiMemoryStatus.REVOKED, version: 1 })
  })

  it('双用户 list/update/delete 与 source provenance 全部按 owner 隔离', async () => {
    const fixtureB = await createConversationFixture(userB.id)
    const created = await post(userA.id, '/api/agent/memories/create', createBody()).expect(200)
    const memoryId = created.body.data.memoryId as string

    const listB = await post(userB.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 30,
      includeInactive: true,
    }).expect(200)
    expect(listB.body.data.items).toEqual([])
    await post(userB.id, '/api/agent/memories/update', {
      memoryId,
      value: { style: 'stolen' },
      topic: 'GENERAL',
      confirmation: true,
    })
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6032 }))
    await post(userB.id, '/api/agent/memories/delete', { memoryId })
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6032 }))

    await post(
      userA.id,
      '/api/agent/memories/create',
      createBody({
        key: 'profile.source',
        sourceConversationId: fixtureB.conversationId,
        sourceMessageId: fixtureB.messageId,
      }),
    )
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6033 }))
    expect(await client.aiUserMemory.count({ where: { userId: userA.id } })).toBe(1)
  })

  it('Strict Body、确认门禁、forbidden topic 与 GENERAL 敏感伪装在写库前拒绝', async () => {
    await post(userA.id, '/api/agent/memories/create', { ...createBody(), userId: userB.id })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 9001 }))
    await post(userA.id, '/api/agent/memories/create', { ...createBody(), confirmation: false }).expect(400)
    await post(userA.id, '/api/agent/memories/create', {
      ...createBody(),
      key: 'profile.health',
      topic: 'HEALTH',
    })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6033 }))
    await post(userA.id, '/api/agent/memories/create', {
      ...createBody(),
      key: 'profile.notes',
      value: { password: 'do-not-store' },
      topic: 'GENERAL',
    })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6033 }))
    expect(await client.aiUserMemory.count({ where: { userId: userA.id } })).toBe(0)
  })

  it('稳定 cursor 分页无重复遗漏，非法 cursor 返回 6033', async () => {
    for (const key of ['response.alpha', 'response.beta', 'response.gamma']) {
      await post(userA.id, '/api/agent/memories/create', createBody({ key })).expect(200)
    }
    const first = await post(userA.id, '/api/agent/memories/list', {
      cursor: null,
      limit: 2,
      includeInactive: false,
    }).expect(200)
    const second = await post(userA.id, '/api/agent/memories/list', {
      cursor: first.body.data.nextCursor,
      limit: 2,
      includeInactive: false,
    }).expect(200)
    const ids = [...first.body.data.items, ...second.body.data.items].map((item: { memoryId: string }) => item.memoryId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids)).toHaveProperty('size', 3)
    expect(second.body.data.nextCursor).toBeNull()

    await post(userA.id, '/api/agent/memories/list', {
      cursor: 'invalid-cursor',
      limit: 2,
      includeInactive: false,
    })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 6033 }))
  })

  it('同 key 并发 create 恰好一个成功，无 candidate 残留', async () => {
    const responses = await Promise.all([
      post(userA.id, '/api/agent/memories/create', createBody({ value: { style: 'a' } })),
      post(userA.id, '/api/agent/memories/create', createBody({ value: { style: 'b' } })),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 6034 })
    expect(
      await client.aiUserMemory.count({
        where: {
          userId: userA.id,
          category: AiMemoryCategory.PREFERENCE,
          key: 'response.style',
          status: AiMemoryStatus.CONFIRMED,
        },
      }),
    ).toBe(1)
    expect(await client.aiUserMemory.count({ where: { userId: userA.id, status: AiMemoryStatus.CANDIDATE } })).toBe(0)
  })

  it('同 memory 并发 update 恰好一个 version 2，旧版只撤销一次', async () => {
    const created = await post(userA.id, '/api/agent/memories/create', createBody()).expect(200)
    const memoryId = created.body.data.memoryId as string
    const responses = await Promise.all([
      post(userA.id, '/api/agent/memories/update', {
        memoryId,
        value: { style: 'a' },
        topic: 'GENERAL',
        confirmation: true,
      }),
      post(userA.id, '/api/agent/memories/update', {
        memoryId,
        value: { style: 'b' },
        topic: 'GENERAL',
        confirmation: true,
      }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(await client.aiUserMemory.count({ where: { userId: userA.id, key: 'response.style', version: 2 } })).toBe(1)
    expect(
      await client.aiUserMemory.count({
        where: { userId: userA.id, key: 'response.style', status: AiMemoryStatus.CONFIRMED },
      }),
    ).toBe(1)
  })

  it('确认插入故障完整回滚，不遗留 candidate 或 confirmed', async () => {
    await client.$executeRawUnsafe(`
      CREATE FUNCTION reject_memory_api_atomic() RETURNS trigger AS $$
      BEGIN
        IF NEW.key = 'response.atomic' THEN RAISE EXCEPTION 'injected memory API failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await client.$executeRawUnsafe(`
      CREATE TRIGGER reject_memory_api_atomic_trigger
      BEFORE INSERT ON ai_user_memories
      FOR EACH ROW EXECUTE FUNCTION reject_memory_api_atomic()
    `)
    try {
      await post(userA.id, '/api/agent/memories/create', createBody({ key: 'response.atomic' })).expect(500)
      expect(await client.aiUserMemory.count({ where: { userId: userA.id, key: 'response.atomic' } })).toBe(0)
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_memory_api_atomic_trigger ON ai_user_memories')
      await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_memory_api_atomic()')
    }
  })

  it('四端点无认证全部返回 401', async () => {
    for (const [path, body] of [
      ['/api/agent/memories/list', { cursor: null, limit: 30, includeInactive: false }],
      ['/api/agent/memories/create', createBody()],
      [
        '/api/agent/memories/update',
        { memoryId: 'memory_missing', value: { style: 'x' }, topic: 'GENERAL', confirmation: true },
      ],
      ['/api/agent/memories/delete', { memoryId: 'memory_missing' }],
    ] as const) {
      await request(app.getHttpServer()).post(path).send(body).expect(401)
    }
  })

  function post(userId: number, path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(path).set('x-test-user-id', String(userId)).send(body)
  }

  function testAuthGuard(): CanActivate {
    return {
      canActivate(context: ExecutionContext) {
        const req = context
          .switchToHttp()
          .getRequest<{ headers: Record<string, string | undefined>; user?: TokenPayload }>()
        const userId = Number(req.headers['x-test-user-id'])
        const found = [userA, userB].find((candidate) => candidate?.id === userId)
        if (!found) throw new UnauthorizedException('用户未登录或 Token 已失效')
        req.user = {
          id: found.id,
          account: found.account,
          nickname: found.nickname,
          role: UserRole.USER,
          jti: `memory-api-${found.id}`,
        }
        return true
      },
    }
  }

  async function createUser(prefix: string): Promise<User> {
    return client.user.create({
      data: {
        account: `${prefix}_${randomUUID()}`,
        password: 'integration-test-only',
        nickname: prefix,
      },
    })
  }

  async function createConversationFixture(userId: number) {
    const conversation = await client.aiConversation.create({
      data: { userId, title: 'memory source', clientRequestId: randomUUID() },
    })
    const message = await client.aiMessage.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: 'remember this',
        contentBlocks: [],
        clientRequestId: randomUUID(),
        completedAt: new Date(),
      },
    })
    return { conversationId: conversation.id, messageId: message.id }
  }
})

function createBody(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

jest.setTimeout(300_000)
