/**
 * ScreenerSubscription 模块 API 测试 — 业务优先
 *
 * 覆盖：订阅 CRUD、暂停/恢复、手动执行、日志、校验
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole, SubscriptionFrequency, SubscriptionStatus } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ScreenerSubscriptionController } from '../screener-subscription.controller'
import { ScreenerSubscriptionService } from '../screener-subscription.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

describe('ScreenerSubscription API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockService: Record<string, jest.Mock>

  const user = buildTestUser()

  const sampleSubscription = {
    id: 10,
    userId: 1,
    name: '均线突破订阅',
    strategyId: null,
    strategyName: null,
    strategyStatus: null,
    filters: { pe: { max: 30 }, roe: { min: 15 } },
    sortBy: null,
    sortOrder: null,
    frequency: SubscriptionFrequency.DAILY,
    status: SubscriptionStatus.ACTIVE,
    lastRunAt: null,
    lastRunResult: null,
    lastMatchCodes: [],
    consecutiveFails: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const sampleLog = {
    id: 100,
    subscriptionId: 10,
    tradeDate: '20260523',
    matchCount: 5,
    newEntryCount: 2,
    exitCount: 1,
    newEntryCodes: ['000001.SZ', '600000.SH'],
    exitCodes: ['000002.SZ'],
    newEntries: [
      { tsCode: '000001.SZ', name: '平安银行', industry: '银行', close: 12.5, pctChg: 1.2 },
      { tsCode: '600000.SH', name: '浦发银行', industry: '银行', close: 8.3, pctChg: -0.5 },
    ],
    exits: [{ tsCode: '000002.SZ', name: '万科A', industry: '房地产', close: 15.0, pctChg: -2.1 }],
    executionMs: 1200,
    success: true,
    errorMessage: null,
    createdAt: new Date(),
  }

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn().mockResolvedValue({ subscriptions: [sampleSubscription] }),
      detail: jest.fn().mockResolvedValue(sampleSubscription),
      create: jest.fn().mockResolvedValue(sampleSubscription),
      update: jest.fn().mockResolvedValue({ ...sampleSubscription, name: '更新后订阅' }),
      remove: jest.fn().mockResolvedValue({ message: '删除成功' }),
      pause: jest.fn().mockResolvedValue({ ...sampleSubscription, status: SubscriptionStatus.PAUSED }),
      resume: jest.fn().mockResolvedValue({ ...sampleSubscription, status: SubscriptionStatus.ACTIVE }),
      manualRun: jest.fn().mockResolvedValue({ jobId: 'job-123', message: '任务已加入队列' }),
      getLogs: jest.fn().mockResolvedValue({ logs: [sampleLog], total: 1, page: 1, pageSize: 20 }),
      validate: jest.fn().mockResolvedValue({ hasDuplicate: false, similarSubscriptions: [] }),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ScreenerSubscriptionController],
      providers: [{ provide: ScreenerSubscriptionService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  })

  afterEach(async () => {
    await app.close()
  })

  // ── 列表 ──────────────────────────────────────────────────────────────────

  describe('列表', () => {
    it('SS-BIZ-001: 查询订阅列表', async () => {
      const res = await req.post('/screener-subscription/list').send({}).expect(201)
      expect(res.body.data.subscriptions).toHaveLength(1)
      expect(res.body.data.subscriptions[0].id).toBe(10)
      expect(mockService.findAll).toHaveBeenCalledWith(1)
    })

    it('SS-SEC-001: 无 Token 查询列表应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [ScreenerSubscriptionController],
        providers: [{ provide: ScreenerSubscriptionService, useValue: mockService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue(mockJwtGuardNoAuth)
        .compile()

      const unauthApp = moduleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/screener-subscription/list')
        .expect(401)
      await unauthApp.close()
    })
  })

  // ── 详情 ──────────────────────────────────────────────────────────────────

  describe('详情', () => {
    it('SS-BIZ-002: 查询订阅详情', async () => {
      const res = await req.post('/screener-subscription/detail').send({ id: 10 }).expect(201)
      expect(res.body.data.id).toBe(10)
      expect(res.body.data.name).toBe('均线突破订阅')
      expect(mockService.detail).toHaveBeenCalledWith(1, 10)
    })

    // NOTE: controller uses inline type `{ id: number }` without @IsInt() DTO,
    it('SS-ERR-001: detail 缺 id 应 400', async () => {
      await req.post('/screener-subscription/detail').send({}).expect(400)
    })

    it('SS-ERR-002: detail id 非整数应 400', async () => {
      await req.post('/screener-subscription/detail').send({ id: 'abc' }).expect(400)
    })
  })

  // ── 创建 ──────────────────────────────────────────────────────────────────

  describe('创建', () => {
    it('SS-BIZ-003: 创建订阅（name+filters）', async () => {
      const res = await req
        .post('/screener-subscription/create')
        .send({ name: '均线突破订阅', filters: { pe: { max: 30 } } })
        .expect(201)
      expect(res.body.data.id).toBe(10)
      expect(mockService.create).toHaveBeenCalledWith(1, expect.objectContaining({ name: '均线突破订阅' }))
    })

    it('SS-BIZ-004: 创建订阅（name+strategyId）', async () => {
      await req
        .post('/screener-subscription/create')
        .send({ name: '策略订阅', strategyId: 5 })
        .expect(201)
      expect(mockService.create).toHaveBeenCalledWith(1, expect.objectContaining({ name: '策略订阅', strategyId: 5 }))
    })

    it('SS-ERR-003: create 缺 name 应 400', async () => {
      await req.post('/screener-subscription/create').send({ filters: { pe: 10 } }).expect(400)
    })

    it('SS-ERR-004: create name 空应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: '', filters: { pe: 10 } }).expect(400)
    })

    it('SS-ERR-005: create name 超 50 字符应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'a'.repeat(51), filters: { pe: 10 } }).expect(400)
    })

    it('SS-ERR-006: create filters 非对象应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'test', filters: 'abc' }).expect(400)
    })

    it('SS-ERR-007: create strategyId 非整数应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'test', strategyId: 'abc' }).expect(400)
    })

    it('SS-ERR-008: create 无效 frequency 应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'test', filters: {}, frequency: 'INVALID' }).expect(400)
    })

    it('SS-ERR-009: create 无效 sortOrder 应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'test', filters: {}, sortOrder: 'random' }).expect(400)
    })

    it('SS-EDGE-001: create name 1 字符', async () => {
      await req.post('/screener-subscription/create').send({ name: 'a', filters: {} }).expect(201)
    })

    it('SS-EDGE-002: create name 50 字符', async () => {
      await req.post('/screener-subscription/create').send({ name: 'a'.repeat(50), filters: {} }).expect(201)
    })

    it('SS-EDGE-003: create name 51 字符应 400', async () => {
      await req.post('/screener-subscription/create').send({ name: 'a'.repeat(51), filters: {} }).expect(400)
    })
  })

  // ── 更新 ──────────────────────────────────────────────────────────────────

  describe('更新', () => {
    it('SS-BIZ-005: 更新订阅名称', async () => {
      const res = await req
        .post('/screener-subscription/update')
        .send({ id: 10, name: '更新后订阅' })
        .expect(201)
      expect(res.body.data.name).toBe('更新后订阅')
      expect(mockService.update).toHaveBeenCalledWith(1, 10, expect.objectContaining({ id: 10, name: '更新后订阅' }))
    })

    it('SS-BIZ-006: 更新订阅频率', async () => {
      await req
        .post('/screener-subscription/update')
        .send({ id: 10, frequency: SubscriptionFrequency.WEEKLY })
        .expect(201)
      expect(mockService.update).toHaveBeenCalledWith(1, 10, expect.objectContaining({ frequency: SubscriptionFrequency.WEEKLY }))
    })

    it('SS-ERR-010: update 缺 id 应 400', async () => {
      await req.post('/screener-subscription/update').send({ name: 'test' }).expect(400)
    })

    it('SS-ERR-011: update name 超 50 字符应 400', async () => {
      await req.post('/screener-subscription/update').send({ id: 10, name: 'a'.repeat(51) }).expect(400)
    })

    it('SS-ERR-012: update 无效 frequency 应 400', async () => {
      await req.post('/screener-subscription/update').send({ id: 10, frequency: 'INVALID' }).expect(400)
    })
  })

  // ── 删除 ──────────────────────────────────────────────────────────────────

  describe('删除', () => {
    it('SS-BIZ-007: 删除订阅', async () => {
      const res = await req.post('/screener-subscription/delete').send({ id: 10 }).expect(201)
      expect(res.body.data.message).toBe('删除成功')
      expect(mockService.remove).toHaveBeenCalledWith(1, 10)
    })

    it('SS-ERR-013: delete 缺 id 应 400', async () => {
      await req.post('/screener-subscription/delete').send({}).expect(400)
    })
  })

  // ── 暂停/恢复 ────────────────────────────────────────────────────────────

  describe('暂停/恢复', () => {
    it('SS-BIZ-008: 暂停订阅', async () => {
      const res = await req.post('/screener-subscription/pause').send({ id: 10 }).expect(201)
      expect(res.body.data.status).toBe(SubscriptionStatus.PAUSED)
      expect(mockService.pause).toHaveBeenCalledWith(1, 10)
    })

    it('SS-BIZ-009: 恢复订阅', async () => {
      const res = await req.post('/screener-subscription/resume').send({ id: 10 }).expect(201)
      expect(res.body.data.status).toBe(SubscriptionStatus.ACTIVE)
      expect(mockService.resume).toHaveBeenCalledWith(1, 10)
    })

    it('SS-ERR-014: pause 缺 id 应 400', async () => {
      await req.post('/screener-subscription/pause').send({}).expect(400)
    })

    it('SS-ERR-015: resume 缺 id 应 400', async () => {
      await req.post('/screener-subscription/resume').send({}).expect(400)
    })
  })

  // ── 手动执行 ──────────────────────────────────────────────────────────────

  describe('手动执行', () => {
    it('SS-BIZ-010: 手动触发执行', async () => {
      const res = await req.post('/screener-subscription/run').send({ id: 10 }).expect(201)
      expect(res.body.data.jobId).toBe('job-123')
      expect(res.body.data.message).toBe('任务已加入队列')
      expect(mockService.manualRun).toHaveBeenCalledWith(1, 10)
    })

    it('SS-ERR-016: run 缺 id 应 400', async () => {
      await req.post('/screener-subscription/run').send({}).expect(400)
    })
  })

  // ── 日志 ──────────────────────────────────────────────────────────────────

  describe('日志', () => {
    it('SS-BIZ-011: 查询日志（默认分页）', async () => {
      const res = await req.post('/screener-subscription/logs').send({ id: 10 }).expect(201)
      expect(res.body.data.logs).toHaveLength(1)
      expect(res.body.data.total).toBe(1)
      expect(res.body.data.page).toBe(1)
      expect(res.body.data.pageSize).toBe(20)
      expect(mockService.getLogs).toHaveBeenCalledWith(1, 10, expect.objectContaining({ id: 10 }))
    })

    it('SS-BIZ-012: 查询日志（自定义分页）', async () => {
      await req.post('/screener-subscription/logs').send({ id: 10, page: 2, pageSize: 10 }).expect(201)
      expect(mockService.getLogs).toHaveBeenCalledWith(1, 10, expect.objectContaining({ id: 10, page: 2, pageSize: 10 }))
    })

    it('SS-ERR-017: logs 缺 id 应 400', async () => {
      await req.post('/screener-subscription/logs').send({}).expect(400)
    })

    it('SS-EDGE-004: logs pageSize=50（最大）', async () => {
      await req.post('/screener-subscription/logs').send({ id: 10, pageSize: 50 }).expect(201)
    })
  })

  // ── 校验 ──────────────────────────────────────────────────────────────────

  describe('校验', () => {
    it('SS-BIZ-013: 校验重复订阅', async () => {
      mockService.validate.mockResolvedValue({
        hasDuplicate: true,
        similarSubscriptions: [{ id: 5, name: '已有订阅', similarity: 'SAME_FILTERS' }],
      })
      const res = await req.post('/screener-subscription/validate').send({ filters: { pe: { max: 30 } } }).expect(201)
      expect(res.body.data.hasDuplicate).toBe(true)
      expect(res.body.data.similarSubscriptions).toHaveLength(1)
    })

    it('SS-BIZ-014: 校验无重复', async () => {
      const res = await req.post('/screener-subscription/validate').send({ filters: { pe: { max: 30 } } }).expect(201)
      expect(res.body.data.hasDuplicate).toBe(false)
    })

    it('SS-EDGE-005: validate 传 id 排除自身', async () => {
      await req.post('/screener-subscription/validate').send({ id: 10, filters: { pe: 10 } }).expect(201)
      expect(mockService.validate).toHaveBeenCalledWith(1, expect.objectContaining({ id: 10 }))
    })
  })
})
