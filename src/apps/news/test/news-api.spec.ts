import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import { UserRole, UserStatus } from '@prisma/client'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import { NewsAdminController } from '../news-admin.controller'
import { NewsAdminService } from '../news-admin.service'
import { NewsController } from '../news.controller'
import { NewsCoverageService } from '../news-coverage.service'
import { NewsHighlightsService } from '../news-highlights.service'
import { NewsQueryService } from '../news-query.service'
import { NewsStrictBodyGuard } from '../news-strict-body.guard'

describe('News API 冻结契约', () => {
  let app: INestApplication
  let role: UserRole
  const query = { list: jest.fn(), detail: jest.fn() }
  const coverage = { getCoverage: jest.fn() }
  const highlights = { getHighlights: jest.fn() }
  const admin = { run: jest.fn(), status: jest.fn(), providers: jest.fn() }

  beforeEach(async () => {
    role = UserRole.USER
    jest.clearAllMocks()
    query.list.mockResolvedValue({ items: [], nextCursor: null, dataThrough: null, partial: false, warnings: [] })
    coverage.getCoverage.mockResolvedValue({
      generatedAt: '2026-08-06T04:00:00.000Z',
      overallStatus: 'READY',
      dataThrough: null,
      partial: false,
      warnings: [],
      feeds: [],
    })
    highlights.getHighlights.mockResolvedValue({
      generatedAt: '2026-08-06T04:00:00.000Z',
      dataThrough: null,
      partial: false,
      warnings: [],
      rankingVersion: 'impact-v1',
      rankingStatus: 'READY',
      displayMode: 'HIGHLIGHTS',
      items: [],
    })
    admin.run.mockResolvedValue({
      commandId: 'c12345678901234567890',
      runIds: ['c22345678901234567890'],
      status: 'QUEUED',
      idempotentReplay: false,
      acceptedAt: '2026-08-06T04:00:00.000Z',
    })
    admin.status.mockResolvedValue({})
    admin.providers.mockResolvedValue({ generatedAt: '2026-08-06T04:00:00.000Z', providers: [] })
    const moduleRef = await Test.createTestingModule({
      controllers: [NewsController, NewsAdminController],
      providers: [
        Reflector,
        RolesGuard,
        NewsStrictBodyGuard,
        { provide: NewsQueryService, useValue: query },
        { provide: NewsCoverageService, useValue: coverage },
        { provide: NewsHighlightsService, useValue: highlights },
        { provide: NewsAdminService, useValue: admin },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.use((req: { user?: unknown }, _: unknown, next: () => void) => {
      req.user = { id: 7, account: 'news-test', nickname: 'test', role, status: UserStatus.ACTIVE, jti: 'test' }
      next()
    })
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, logger()))
    await app.init()
  })

  afterEach(async () => app.close())

  it('NEWS-BIZ-007: list 空 Body 使用冻结默认值并统一 HTTP 200', async () => {
    const response = await request(app.getHttpServer()).post('/news/articles/list').send({}).expect(200)
    expect(response.body.code).toBe(0)
    expect(query.list).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ limit: 30, scope: 'ALL', includeUnknownPublishedTime: false }),
    )
  })

  it('NEWS-ERR-006: News Body 多余字段严格拒绝', async () => {
    await request(app.getHttpServer()).post('/news/articles/list').send({ ownerId: 99 }).expect(400)
    expect(query.list).not.toHaveBeenCalled()
    await request(app.getHttpServer()).post('/news/coverage').send({ refresh: true }).expect(400)
    expect(coverage.getCoverage).not.toHaveBeenCalled()
  })

  it('NEWS-HIGHLIGHTS-API-001: highlights 仅接受 POST Body 且保持固定 scope/limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/news/articles/highlights')
      .send({ scope: 'ALL', limit: 5 })
      .expect(200)

    expect(response.body.code).toBe(0)
    expect(highlights.getHighlights).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ALL', limit: 5 }))
    await request(app.getHttpServer())
      .post('/news/articles/highlights')
      .send({ scope: 'WATCHLIST', limit: 5 })
      .expect(400)
    expect(highlights.getHighlights).toHaveBeenCalledTimes(1)
  })

  it('NEWS-ERR-007: 重复证券代码不静默去重', async () => {
    await request(app.getHttpServer())
      .post('/news/articles/list')
      .send({ scope: 'SECURITIES', securityCodes: ['600519.SH', '600519.SH'] })
      .expect(400)
  })

  it('NEWS-ERR-008: 普通 USER 不能访问管理端', async () => {
    await request(app.getHttpServer()).post('/news/admin/providers/list').send({}).expect(403)
    expect(admin.providers).not.toHaveBeenCalled()
  })

  it('NEWS-BIZ-012: SUPER_ADMIN 触发命令，strict body 后 HTTP 200', async () => {
    role = UserRole.SUPER_ADMIN
    const response = await request(app.getHttpServer())
      .post('/news/admin/ingestion/run')
      .send({
        clientRequestId: '8b65bf12-6612-4e15-a8d8-68e70d97e743',
        operation: 'POLL_FEED',
        providerKey: 'AKSHARE',
        feedKey: 'akshare.cls.telegraph',
      })
      .expect(200)
    expect(response.body.data.commandId).toBe('c12345678901234567890')
    expect(admin.run).toHaveBeenCalledWith(7, expect.objectContaining({ operation: 'POLL_FEED' }))
  })

  it.each([
    [
      'POLL_FEED 混入回补字段',
      {
        clientRequestId: '8b65bf12-6612-4e15-a8d8-68e70d97e743',
        operation: 'POLL_FEED',
        providerKey: 'AKSHARE',
        feedKey: 'akshare.cls.telegraph',
        securityCodes: ['600519.SH'],
        beginDate: '2026-08-01',
        endDate: '2026-08-06',
      },
    ],
    [
      'BACKFILL_SECURITY_NOTICES 混入 Provider 字段',
      {
        clientRequestId: '8b65bf12-6612-4e15-a8d8-68e70d97e743',
        operation: 'BACKFILL_SECURITY_NOTICES',
        providerKey: 'AKSHARE',
        feedKey: 'akshare.notice.security.backfill',
        securityCodes: ['600519.SH'],
        beginDate: '2026-08-01',
        endDate: '2026-08-06',
      },
    ],
    [
      'clientRequestId 使用大写 UUID',
      {
        clientRequestId: '8B65BF12-6612-4E15-A8D8-68E70D97E743',
        operation: 'POLL_FEED',
        providerKey: 'AKSHARE',
        feedKey: 'akshare.cls.telegraph',
      },
    ],
  ])('NEWS-SEC-ADMIN-STRICT: %s 必须在 Service 前返回 DTO 9001', async (_scenario, body) => {
    role = UserRole.SUPER_ADMIN

    const response = await request(app.getHttpServer()).post('/news/admin/ingestion/run').send(body)

    expect({
      status: response.status,
      code: response.body.code,
      serviceCalls: admin.run.mock.calls.length,
    }).toEqual({ status: 400, code: 9001, serviceCalls: 0 })
  })

  it('Swagger ingestion/run 使用 operation 判别的双分支 oneOf', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('1').build())
    const requestBody = document.paths['/news/admin/ingestion/run']?.post?.requestBody
    if (!requestBody || '$ref' in requestBody) throw new Error('ingestion/run requestBody 必须是内联媒体类型')
    const schema = requestBody.content['application/json']?.schema
    if (!schema || '$ref' in schema) throw new Error('ingestion/run requestBody schema 必须是判别联合')

    const operationMapping = schema.discriminator?.mapping ?? {}
    const oneOfRefs = (schema.oneOf ?? []).map((branch) => ('$ref' in branch ? branch.$ref : null))
    expect({
      discriminator: schema.discriminator?.propertyName,
      operations: Object.keys(operationMapping).sort(),
      oneOfRefs,
    }).toEqual({
      discriminator: 'operation',
      operations: ['BACKFILL_SECURITY_NOTICES', 'POLL_FEED'],
      oneOfRefs: expect.arrayContaining(Object.values(operationMapping)),
    })
    expect(oneOfRefs).toHaveLength(2)

    const requiredByOperation = {
      POLL_FEED: ['clientRequestId', 'operation', 'providerKey', 'feedKey'],
      BACKFILL_SECURITY_NOTICES: ['clientRequestId', 'operation', 'securityCodes', 'beginDate', 'endDate'],
    }
    for (const [operation, required] of Object.entries(requiredByOperation)) {
      const ref = operationMapping[operation]
      expect(oneOfRefs).toContain(ref)
      const schemaName = ref?.split('/').at(-1)
      const branch = schemaName ? document.components?.schemas?.[schemaName] : undefined
      if (!branch || '$ref' in branch) throw new Error(`${operation} 分支 schema 不存在`)
      expect(branch.properties?.operation).toEqual(expect.objectContaining({ enum: [operation] }))
      expect(branch.required).toEqual(expect.arrayContaining(required))
    }
  })
})

function logger(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
}
