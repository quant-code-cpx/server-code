/**
 * StrategyDraft 模块 API 测试 -- 业务优先
 *
 * 覆盖：草稿 CRUD、提交回测、DTO 校验、错误处理、安全
 * 方法：Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { StrategyDraftController } from '../strategy-draft.controller'
import { StrategyDraftService } from '../strategy-draft.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'test-jti', ...overrides }
}

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
}

describe('StrategyDraft API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockDraftService: Record<string, jest.Mock>

  const user = buildTestUser()

  const sampleDraft = {
    id: 1,
    userId: 1,
    name: '均线交叉草稿',
    config: { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { shortWindow: 5, longWindow: 20 } },
    createdAt: new Date('2026-05-20'),
    updatedAt: new Date('2026-05-24'),
  }

  const sampleDraftB = {
    id: 2,
    userId: 1,
    name: '因子排名草稿',
    config: { strategyType: 'FACTOR_RANKING', strategyConfig: { factorName: 'pe_ttm' } },
    createdAt: new Date('2026-05-21'),
    updatedAt: new Date('2026-05-23'),
  }

  beforeEach(async () => {
    mockDraftService = {
      getDrafts: jest.fn().mockResolvedValue({ drafts: [sampleDraftB, sampleDraft] }),
      getDraft: jest.fn().mockResolvedValue(sampleDraft),
      createDraft: jest.fn().mockResolvedValue(sampleDraft),
      updateDraft: jest.fn().mockResolvedValue({ ...sampleDraft, name: '更新后的草稿' }),
      deleteDraft: jest.fn().mockResolvedValue({ message: '删除成功' }),
      submitDraft: jest.fn().mockResolvedValue({ id: 'run-1', status: 'PENDING' }),
    }

    const mockJwtGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        ctx.switchToHttp().getRequest().user = user
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StrategyDraftController],
      providers: [{ provide: StrategyDraftService, useValue: mockDraftService }],
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

  // -- 草稿列表 ----------------------------------------------------------------

  describe('草稿列表', () => {
    it('SD-BIZ-001: 查询草稿列表', async () => {
      const res = await req.post('/strategy-draft/list').expect(201)
      expect(res.body.data.drafts).toHaveLength(2)
      expect(res.body.data.drafts[0].id).toBe(2) // 按 updatedAt 倒序
      expect(mockDraftService.getDrafts).toHaveBeenCalledWith(1)
    })

    it('SD-BIZ-002: 空列表', async () => {
      mockDraftService.getDrafts.mockResolvedValueOnce({ drafts: [] })
      const res = await req.post('/strategy-draft/list').expect(201)
      expect(res.body.data.drafts).toHaveLength(0)
    })
  })

  // -- 草稿详情 ----------------------------------------------------------------

  describe('草稿详情', () => {
    it('SD-BIZ-003: 获取存在的草稿详情', async () => {
      const res = await req.post('/strategy-draft/detail').send({ id: 1 }).expect(201)
      expect(res.body.data.id).toBe(1)
      expect(res.body.data.name).toBe('均线交叉草稿')
      expect(res.body.data.config).toHaveProperty('strategyType')
    })

    it('SD-ERR-001: 草稿不存在应 404', async () => {
      const { NotFoundException } = require('@nestjs/common')
      mockDraftService.getDraft.mockRejectedValueOnce(new NotFoundException('草稿不存在'))
      await req.post('/strategy-draft/detail').send({ id: 999 }).expect(404)
    })
  })

  // -- 创建草稿 ----------------------------------------------------------------

  describe('创建草稿', () => {
    it('SD-BIZ-004: 正常创建草稿', async () => {
      const res = await req
        .post('/strategy-draft/create')
        .send({ name: '均线交叉草稿', config: { strategyType: 'MA_CROSS_SINGLE' } })
        .expect(201)
      expect(res.body.data.id).toBe(1)
      expect(res.body.data.name).toBe('均线交叉草稿')
      expect(mockDraftService.createDraft).toHaveBeenCalledWith(1, {
        name: '均线交叉草稿',
        config: { strategyType: 'MA_CROSS_SINGLE' },
      })
    })

    it('SD-ERR-002: 创建缺 name 应 400', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ config: { strategyType: 'MA_CROSS_SINGLE' } })
        .expect(400)
      expect(mockDraftService.createDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-003: 创建缺 config 应 400', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: 'test' })
        .expect(400)
      expect(mockDraftService.createDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-004: 创建 name 空字符串应 400', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: '', config: {} })
        .expect(400)
      expect(mockDraftService.createDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-005: 创建 name 超 100 字符应 400', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: 'a'.repeat(101), config: {} })
        .expect(400)
      expect(mockDraftService.createDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-006: 创建 config 非对象应 400', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: 'test', config: 'not-an-object' })
        .expect(400)
      expect(mockDraftService.createDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-007: 创建重名草稿应 409', async () => {
      const { ConflictException } = require('@nestjs/common')
      mockDraftService.createDraft.mockRejectedValueOnce(new ConflictException('同名草稿已存在'))
      await req
        .post('/strategy-draft/create')
        .send({ name: 'dup', config: {} })
        .expect(409)
    })

    it('SD-ERR-008: 超过 20 个草稿上限应 400', async () => {
      const { BadRequestException } = require('@nestjs/common')
      mockDraftService.createDraft.mockRejectedValueOnce(
        new BadRequestException('草稿数量已达上限（最多 20 个）'),
      )
      await req
        .post('/strategy-draft/create')
        .send({ name: 'new', config: {} })
        .expect(400)
    })

    it('SD-EDGE-001: name 恰好 100 字符应 201', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: 'a'.repeat(100), config: {} })
        .expect(201)
    })

    it('SD-EDGE-002: name 恰好 1 字符应 201', async () => {
      await req
        .post('/strategy-draft/create')
        .send({ name: 'x', config: {} })
        .expect(201)
    })
  })

  // -- 更新草稿 ----------------------------------------------------------------

  describe('更新草稿', () => {
    it('SD-BIZ-005: 更新草稿名称', async () => {
      const res = await req
        .post('/strategy-draft/update')
        .send({ id: 1, name: '更新后的草稿' })
        .expect(201)
      expect(res.body.data.name).toBe('更新后的草稿')
      expect(mockDraftService.updateDraft).toHaveBeenCalledWith(1, 1, expect.objectContaining({ id: 1, name: '更新后的草稿' }))
    })

    it('SD-BIZ-006: 更新草稿配置', async () => {
      mockDraftService.updateDraft.mockResolvedValueOnce({
        ...sampleDraft,
        config: { strategyType: 'FACTOR_RANKING' },
      })
      const res = await req
        .post('/strategy-draft/update')
        .send({ id: 1, config: { strategyType: 'FACTOR_RANKING' } })
        .expect(201)
      expect(res.body.data.config.strategyType).toBe('FACTOR_RANKING')
    })

    it('SD-ERR-009: 更新不存在的草稿应 404', async () => {
      const { NotFoundException } = require('@nestjs/common')
      mockDraftService.updateDraft.mockRejectedValueOnce(new NotFoundException('草稿不存在'))
      await req
        .post('/strategy-draft/update')
        .send({ id: 999, name: 'x' })
        .expect(404)
    })

    it('SD-ERR-010: 更新 name 超 100 字符应 400', async () => {
      await req
        .post('/strategy-draft/update')
        .send({ id: 1, name: 'a'.repeat(101) })
        .expect(400)
      expect(mockDraftService.updateDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-011: 更新 config 非对象应 400', async () => {
      await req
        .post('/strategy-draft/update')
        .send({ id: 1, config: 'bad' })
        .expect(400)
      expect(mockDraftService.updateDraft).not.toHaveBeenCalled()
    })

    it('SD-ERR-012: 更新重名草稿应 409', async () => {
      const { ConflictException } = require('@nestjs/common')
      mockDraftService.updateDraft.mockRejectedValueOnce(new ConflictException('同名草稿已存在'))
      await req
        .post('/strategy-draft/update')
        .send({ id: 1, name: 'dup' })
        .expect(409)
    })
  })

  // -- 删除草稿 ----------------------------------------------------------------

  describe('删除草稿', () => {
    it('SD-BIZ-007: 删除存在的草稿', async () => {
      const res = await req
        .post('/strategy-draft/delete')
        .send({ id: 1 })
        .expect(201)
      expect(res.body.data.message).toBe('删除成功')
      expect(mockDraftService.deleteDraft).toHaveBeenCalledWith(1, 1)
    })

    it('SD-ERR-013: 删除不存在的草稿应 404', async () => {
      const { NotFoundException } = require('@nestjs/common')
      mockDraftService.deleteDraft.mockRejectedValueOnce(new NotFoundException('草稿不存在'))
      await req
        .post('/strategy-draft/delete')
        .send({ id: 999 })
        .expect(404)
    })
  })

  // -- 提交回测 ----------------------------------------------------------------

  describe('提交回测', () => {
    it('SD-BIZ-008: 正常提交草稿回测', async () => {
      const res = await req
        .post('/strategy-draft/submit')
        .send({ id: 1 })
        .expect(201)
      expect(res.body.data.id).toBe('run-1')
      expect(res.body.data.status).toBe('PENDING')
      expect(mockDraftService.submitDraft).toHaveBeenCalledWith(1, 1, expect.objectContaining({ id: 1 }))
    })

    it('SD-BIZ-009: 提交时指定回测名称', async () => {
      mockDraftService.submitDraft.mockResolvedValueOnce({ id: 'run-2', status: 'PENDING' })
      const res = await req
        .post('/strategy-draft/submit')
        .send({ id: 1, name: '自定义回测名称' })
        .expect(201)
      expect(res.body.data.id).toBe('run-2')
      expect(mockDraftService.submitDraft).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({ id: 1, name: '自定义回测名称' }),
      )
    })

    it('SD-ERR-014: 提交不存在的草稿应 404', async () => {
      const { NotFoundException } = require('@nestjs/common')
      mockDraftService.submitDraft.mockRejectedValueOnce(new NotFoundException('草稿不存在'))
      await req
        .post('/strategy-draft/submit')
        .send({ id: 999 })
        .expect(404)
    })

    it('SD-ERR-015: 提交缺 strategyType 应 400', async () => {
      const { BadRequestException } = require('@nestjs/common')
      mockDraftService.submitDraft.mockRejectedValueOnce(
        new BadRequestException('草稿中未指定 strategyType，无法提交回测'),
      )
      await req
        .post('/strategy-draft/submit')
        .send({ id: 2 })
        .expect(400)
    })

    it('SD-ERR-016: 提交 name 超 128 字符应 400', async () => {
      await req
        .post('/strategy-draft/submit')
        .send({ id: 1, name: 'a'.repeat(129) })
        .expect(400)
      expect(mockDraftService.submitDraft).not.toHaveBeenCalled()
    })
  })

  // -- 安全 -------------------------------------------------------------------

  describe('安全', () => {
    it('SD-SEC-001: 无 Token 访问 list 应 401', async () => {
      const mockJwtGuardNoAuth: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [StrategyDraftController],
        providers: [{ provide: StrategyDraftService, useValue: mockDraftService }],
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
        .post('/strategy-draft/list')
        .expect(401)
      await unauthApp.close()
    })
  })
})
