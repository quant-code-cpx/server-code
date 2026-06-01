/**
 * User 模块 API 测试 — 业务优先
 *
 * 覆盖：用户 CRUD、个人资料、密码、偏好、审计日志、统计、搜索、角色管理
 * 方法：Test.createTestingModule + overrideGuard(RolesGuard) + mock services
 */
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { UserRole, UserStatus } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { LoggerService } from 'src/shared/logger/logger.service'
import { UserController } from '../user.controller'
import { UserService } from '../user.service'

function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { id: 1, account: 'admin', nickname: 'Admin', role: UserRole.ADMIN, jti: 'test-jti', ...overrides }
}

function buildSuperAdmin(): TokenPayload {
  return { id: 99, account: 'superadmin', nickname: 'SuperAdmin', role: UserRole.SUPER_ADMIN, jti: 'sa-jti' }
}

function createMockLoggerService(): LoggerService {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn() } as unknown as LoggerService
}

const sampleUser = {
  id: 2,
  account: 'zhangsan',
  nickname: '张三',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  email: null,
  wechat: null,
  lastLoginAt: null,
  backtestQuota: 5,
  watchlistLimit: 20,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

describe('User API 测试', () => {
  let app: INestApplication
  let req: ReturnType<typeof request>
  let mockUserService: Record<string, jest.Mock>

  const adminUser = buildTestUser()
  const superAdminUser = buildSuperAdmin()

  async function createAppWithUser(user: TokenPayload) {
    const mockRolesGuard: CanActivate = {
      canActivate(ctx: ExecutionContext): boolean {
        const reflector = app?.get(Reflector) ?? new Reflector()
        const req = ctx.switchToHttp().getRequest()
        req.user = user
        // Check roles manually
        const handler = ctx.getHandler()
        const classRef = ctx.getClass()
        const requiredRoles = reflector.getAllAndOverride<UserRole[]>('roles', [handler, classRef])
        if (!requiredRoles || requiredRoles.length === 0) return true
        const ROLE_LEVEL: Record<UserRole, number> = { [UserRole.USER]: 1, [UserRole.ADMIN]: 2, [UserRole.SUPER_ADMIN]: 3 }
        const userLevel = ROLE_LEVEL[user.role] ?? 0
        const meets = requiredRoles.some((role) => userLevel >= ROLE_LEVEL[role])
        if (!meets) {
          const { ForbiddenException } = require('@nestjs/common')
          throw new ForbiddenException('权限不足')
        }
        return true
      },
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockUserService }],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile()

    const reflector = moduleRef.get(Reflector)
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
    await app.init()
    req = request(app.getHttpServer())
  }

  beforeEach(() => {
    mockUserService = {
      create: jest.fn().mockResolvedValue({ ...sampleUser, initialPassword: 'Abc12345' }),
      findAll: jest.fn().mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [sampleUser] }),
      getProfile: jest.fn().mockResolvedValue(sampleUser),
      updateProfile: jest.fn().mockResolvedValue({ ...sampleUser, nickname: '李四' }),
      changePassword: jest.fn().mockResolvedValue(null),
      findOne: jest.fn().mockResolvedValue(sampleUser),
      adminUpdateUser: jest.fn().mockResolvedValue({ ...sampleUser, nickname: '管理员改' }),
      updateStatus: jest.fn().mockResolvedValue(null),
      resetPassword: jest.fn().mockResolvedValue({ newPassword: 'NewPass88' }),
      remove: jest.fn().mockResolvedValue(null),
      listAuditLog: jest.fn().mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [] }),
      getPreferences: jest.fn().mockResolvedValue({ stockListColumns: ['tsCode', 'name'] }),
      updatePreferences: jest.fn().mockResolvedValue({ stockListColumns: ['tsCode', 'name', 'peTtm'] }),
      updateRole: jest.fn().mockResolvedValue({ ...sampleUser, role: UserRole.ADMIN }),
      restore: jest.fn().mockResolvedValue({ ...sampleUser, status: UserStatus.ACTIVE }),
      getStats: jest.fn().mockResolvedValue({ total: 10, todayNew: 2, active30d: 8, deactivated: 1 }),
      search: jest.fn().mockResolvedValue({ items: [{ id: 2, account: 'zhangsan', nickname: '张三', role: UserRole.USER }] }),
    }
  })

  afterEach(async () => {
    if (app) await app.close()
  })

  // ── 用户创建 ─────────────────────────────────────────────────────────────

  describe('用户创建', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-001: 管理员创建用户', async () => {
      const res = await req
        .post('/user/create')
        .send({ account: 'zhangsan', nickname: '张三', password: 'Abc12345' })
        .expect(201)
      expect(res.body.data.account).toBe('zhangsan')
      expect(res.body.data.initialPassword).toBe('Abc12345')
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'zhangsan', nickname: '张三', password: 'Abc12345' }),
        expect.objectContaining({ id: 1 }),
      )
    })

    it('US-BIZ-002: 创建带配额的用户', async () => {
      await req
        .post('/user/create')
        .send({ account: 'lisi', nickname: '李四', password: 'Abc12345', backtestQuota: 10, watchlistLimit: 50 })
        .expect(201)
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ backtestQuota: 10, watchlistLimit: 50 }),
        expect.anything(),
      )
    })

    it('US-ERR-001: create 缺 account 应 400', async () => {
      await req.post('/user/create').send({ nickname: '张三', password: 'Abc12345' }).expect(400)
    })

    it('US-ERR-002: create 缺 nickname 应 400', async () => {
      await req.post('/user/create').send({ account: 'zhangsan', password: 'Abc12345' }).expect(400)
    })

    it('US-ERR-003: create 缺 password 应 400', async () => {
      await req.post('/user/create').send({ account: 'zhangsan', nickname: '张三' }).expect(400)
    })

    it('US-ERR-004: create password 不足 8 位应 400', async () => {
      await req.post('/user/create').send({ account: 'zhangsan', nickname: '张三', password: 'Abc1234' }).expect(400)
    })

    it('US-ERR-005: create 无效 role 应 400', async () => {
      await req.post('/user/create').send({ account: 'zhangsan', nickname: '张三', password: 'Abc12345', role: 'INVALID' }).expect(400)
    })

    it('US-ERR-006: create backtestQuota < -1 应 400', async () => {
      await req.post('/user/create').send({ account: 'zhangsan', nickname: '张三', password: 'Abc12345', backtestQuota: -2 }).expect(400)
    })

    it('US-EDGE-001: create account 64 字符', async () => {
      await req.post('/user/create').send({ account: 'a'.repeat(64), nickname: '张三', password: 'Abc12345' }).expect(201)
    })

    it('US-EDGE-002: create account 65 字符应 400', async () => {
      await req.post('/user/create').send({ account: 'a'.repeat(65), nickname: '张三', password: 'Abc12345' }).expect(400)
    })
  })

  // ── 用户列表 ─────────────────────────────────────────────────────────────

  describe('用户列表', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-003: 查询用户列表', async () => {
      const res = await req.post('/user/list').send({}).expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(res.body.data.total).toBe(1)
    })

    it('US-BIZ-004: 带分页参数查询', async () => {
      await req.post('/user/list').send({ page: 2, pageSize: 10 }).expect(201)
      expect(mockUserService.findAll).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10 }))
    })

    it('US-ERR-007: list page=0 应 400', async () => {
      await req.post('/user/list').send({ page: 0 }).expect(400)
    })

    it('US-ERR-008: list pageSize=101 应 400', async () => {
      await req.post('/user/list').send({ pageSize: 101 }).expect(400)
    })

    it('US-ERR-009: list 无效 sortBy 应 400', async () => {
      await req.post('/user/list').send({ sortBy: 'invalidField' }).expect(400)
    })
  })

  // ── 个人资料 ─────────────────────────────────────────────────────────────

  describe('个人资料', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-005: 获取个人详情', async () => {
      const res = await req.post('/user/profile/detail').send({}).expect(201)
      expect(res.body.data.id).toBe(2)
      expect(res.body.data.account).toBe('zhangsan')
    })

    it('US-BIZ-006: 修改个人资料', async () => {
      const res = await req.post('/user/profile/update').send({ nickname: '李四' }).expect(201)
      expect(res.body.data.nickname).toBe('李四')
      expect(mockUserService.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ nickname: '李四' }),
      )
    })

    it('US-BIZ-007: 修改密码', async () => {
      await req.post('/user/profile/change-password').send({ oldPassword: 'OldPass123', newPassword: 'NewPass88' }).expect(201)
      expect(mockUserService.changePassword).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ oldPassword: 'OldPass123', newPassword: 'NewPass88' }),
      )
    })

    it('US-ERR-010: change-password 缺 oldPassword 应 400', async () => {
      await req.post('/user/profile/change-password').send({ newPassword: 'NewPass88' }).expect(400)
    })

    it('US-ERR-011: change-password newPassword 不足 8 位应 400', async () => {
      await req.post('/user/profile/change-password').send({ oldPassword: 'OldPass123', newPassword: 'short' }).expect(400)
    })

    it('US-ERR-012: update-profile email 格式错误应 400', async () => {
      await req.post('/user/profile/update').send({ email: 'not-an-email' }).expect(400)
    })

    it('US-EDGE-003: update-profile nickname 64 字符', async () => {
      await req.post('/user/profile/update').send({ nickname: 'a'.repeat(64) }).expect(201)
    })
  })

  // ── 管理员操作 ───────────────────────────────────────────────────────────

  describe('管理员操作', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-008: 获取指定用户详情', async () => {
      const res = await req.post('/user/detail').send({ id: 2 }).expect(201)
      expect(res.body.data.account).toBe('zhangsan')
      expect(mockUserService.findOne).toHaveBeenCalledWith(2)
    })

    it('US-BIZ-009: 管理员更新用户信息', async () => {
      const res = await req.post('/user/update').send({ id: 2, nickname: '管理员改' }).expect(201)
      expect(res.body.data.nickname).toBe('管理员改')
      expect(mockUserService.adminUpdateUser).toHaveBeenCalledWith(2, { nickname: '管理员改' }, expect.objectContaining({ id: 1 }))
    })

    it('US-BIZ-010: 修改用户状态', async () => {
      await req.post('/user/update-status').send({ id: 2, status: 'DEACTIVATED' }).expect(201)
      expect(mockUserService.updateStatus).toHaveBeenCalledWith(2, { status: 'DEACTIVATED' }, expect.objectContaining({ id: 1 }))
    })

    it('US-BIZ-011: 重置用户密码', async () => {
      const res = await req.post('/user/reset-password').send({ id: 2, newPassword: 'NewPass88' }).expect(201)
      expect(res.body.data.newPassword).toBe('NewPass88')
    })

    it('US-BIZ-012: 删除用户', async () => {
      await req.post('/user/delete').send({ id: 2 }).expect(201)
      expect(mockUserService.remove).toHaveBeenCalledWith(2, expect.objectContaining({ id: 1 }))
    })

    it('US-ERR-013: detail 缺 id 应 400', async () => {
      await req.post('/user/detail').send({}).expect(400)
    })

    it('US-ERR-014: detail id=0 应 400', async () => {
      await req.post('/user/detail').send({ id: 0 }).expect(400)
    })

    it('US-ERR-015: update 缺 id 应 400', async () => {
      await req.post('/user/update').send({ nickname: 'test' }).expect(400)
    })

    it('US-ERR-016: update-status 缺 id 应 400', async () => {
      await req.post('/user/update-status').send({ status: 'ACTIVE' }).expect(400)
    })

    it('US-ERR-017: update-status 缺 status 应 400', async () => {
      await req.post('/user/update-status').send({ id: 2 }).expect(400)
    })

    it('US-ERR-018: reset-password 缺 id 应 400', async () => {
      await req.post('/user/reset-password').send({ newPassword: 'NewPass88' }).expect(400)
    })

    it('US-ERR-019: reset-password newPassword 不足 8 位应 400', async () => {
      await req.post('/user/reset-password').send({ id: 2, newPassword: 'short' }).expect(400)
    })
  })

  // ── 审计日志 ─────────────────────────────────────────────────────────────

  describe('审计日志', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-013: 查询审计日志', async () => {
      const res = await req.post('/user/audit-log/list').send({}).expect(201)
      expect(res.body.data.total).toBe(1)
      expect(res.body.data.items).toBeDefined()
    })
  })

  // ── 用户偏好 ─────────────────────────────────────────────────────────────

  describe('用户偏好', () => {
    beforeEach(async () => {
      await createAppWithUser(adminUser)
    })

    it('US-BIZ-014: 获取全部偏好', async () => {
      const res = await req.post('/user/preferences/get').send({}).expect(201)
      expect(res.body.data.preferences).toHaveProperty('stockListColumns')
    })

    it('US-BIZ-015: 按 key 获取偏好', async () => {
      const res = await req.post('/user/preferences/get').send({ key: 'stockListColumns' }).expect(201)
      expect(res.body.data.preferences).toHaveProperty('stockListColumns')
    })

    it('US-BIZ-016: 更新偏好', async () => {
      const res = await req.post('/user/preferences/update').send({ key: 'stockListColumns', value: ['tsCode', 'name', 'peTtm'] }).expect(201)
      expect(res.body.data.preferences).toHaveProperty('stockListColumns')
      expect(mockUserService.updatePreferences).toHaveBeenCalledWith(1, 'stockListColumns', ['tsCode', 'name', 'peTtm'])
    })

    it('US-ERR-020: preferences/update 缺 key 应 400', async () => {
      await req.post('/user/preferences/update').send({ value: ['tsCode'] }).expect(400)
    })
  })

  // ── 高级管理 ─────────────────────────────────────────────────────────────

  describe('高级管理', () => {
    beforeEach(async () => {
      await createAppWithUser(superAdminUser)
    })

    it('US-BIZ-017: 修改用户角色', async () => {
      const res = await req.post('/user/update-role').send({ id: 2, role: 'ADMIN' }).expect(201)
      expect(res.body.data.role).toBe('ADMIN')
      expect(mockUserService.updateRole).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, role: 'ADMIN' }),
        expect.objectContaining({ id: 99 }),
      )
    })

    it('US-BIZ-018: 恢复已注销用户', async () => {
      const res = await req.post('/user/restore').send({ id: 2 }).expect(201)
      expect(res.body.data.status).toBe('ACTIVE')
    })

    it('US-BIZ-019: 用户统计', async () => {
      const res = await req.post('/user/stats').send({}).expect(201)
      expect(res.body.data.total).toBe(10)
      expect(res.body.data.todayNew).toBe(2)
    })

    it('US-BIZ-020: 用户搜索', async () => {
      const res = await req.post('/user/search').send({ keyword: 'zhangsan' }).expect(201)
      expect(res.body.data.items).toHaveLength(1)
      expect(mockUserService.search).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'zhangsan' }))
    })

    it('US-ERR-021: update-role 缺 id 应 400', async () => {
      await req.post('/user/update-role').send({ role: 'ADMIN' }).expect(400)
    })

    it('US-ERR-022: update-role 缺 role 应 400', async () => {
      await req.post('/user/update-role').send({ id: 2 }).expect(400)
    })

    it('US-ERR-023: search 缺 keyword 应 400', async () => {
      await req.post('/user/search').send({}).expect(400)
    })

    it('US-ERR-024: restore 缺 id 应 400', async () => {
      await req.post('/user/restore').send({}).expect(400)
    })
  })

  // ── 安全 ─────────────────────────────────────────────────────────────────

  describe('安全', () => {
    it('US-SEC-001: 无 Token 应 401', async () => {
      const noAuthGuard: CanActivate = {
        canActivate(): boolean {
          const { UnauthorizedException } = require('@nestjs/common')
          throw new UnauthorizedException()
        },
      }

      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [UserController],
        providers: [{ provide: UserService, useValue: mockUserService }],
      })
        .overrideGuard(RolesGuard)
        .useValue(noAuthGuard)
        .compile()

      const unauthApp = moduleRef.createNestApplication()
      unauthApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      unauthApp.useGlobalInterceptors(new TransformInterceptor())
      unauthApp.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))
      await unauthApp.init()

      await request(unauthApp.getHttpServer())
        .post('/user/create')
        .send({ account: 'test', nickname: 'test', password: 'Abc12345' })
        .expect(401)
      await unauthApp.close()
    })

    it('US-SEC-002: USER 角色访问 create 应 403', async () => {
      await createAppWithUser(buildTestUser({ role: UserRole.USER }))
      await req.post('/user/create').send({ account: 'test', nickname: 'test', password: 'Abc12345' }).expect(403)
    })

    it('US-SEC-003: ADMIN 角色访问 update-role 应 403', async () => {
      await createAppWithUser(adminUser)
      await req.post('/user/update-role').send({ id: 2, role: 'ADMIN' }).expect(403)
    })
  })
})
