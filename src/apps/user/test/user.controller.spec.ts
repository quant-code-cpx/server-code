import { INestApplication, ExecutionContext, ValidationPipe, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { UserController } from '../user.controller'
import { UserService } from '../user.service'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { TokenPayload } from 'src/shared/token.interface'

const mockService = {
  create: jest.fn(async () => ({ id: 2, account: 'newuser' })),
  findAll: jest.fn(async () => ({ users: [], total: 0 })),
  getProfile: jest.fn(async () => ({ id: 1, account: 'test' })),
  updateProfile: jest.fn(async () => ({ id: 1, nickname: '新昵称' })),
  changePassword: jest.fn(async () => ({ message: '密码修改成功' })),
  findOne: jest.fn(async () => ({ id: 2, account: 'other' })),
  adminUpdateUser: jest.fn(async () => ({ id: 2, nickname: 'updated' })),
  updateStatus: jest.fn(async () => ({ message: '状态已更新' })),
  resetPassword: jest.fn(async () => ({ password: 'newPass123!' })),
  remove: jest.fn(async () => ({ message: '删除成功' })),
  listAuditLog: jest.fn(async () => ({ logs: [], total: 0 })),
}

/** 构建测试用 TokenPayload */
function buildUser(role: UserRole): TokenPayload {
  return { id: 1, account: 'test', nickname: 'Test', role, jti: 'test-jti' }
}

/** 创建一个可配置用户的测试应用（user.controller 使用 @UseGuards(RolesGuard)） */
async function buildApp(user: TokenPayload | null): Promise<INestApplication> {
  // We override RolesGuard so we can inject any user we want
  const customRolesGuard = {
    canActivate(ctx: ExecutionContext): boolean {
      if (!user) throw new UnauthorizedException('用户未登录')
      const req = ctx.switchToHttp().getRequest()
      req.user = user

      const reflector = new Reflector()
      const required = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()])
      if (!required || required.length === 0) return true

      const level = ROLE_LEVEL[user.role] ?? 0
      const meets = required.some((r) => level >= ROLE_LEVEL[r])
      if (!meets) throw new ForbiddenException('权限不足')
      return true
    },
  }

  const module: TestingModule = await Test.createTestingModule({
    controllers: [UserController],
    providers: [{ provide: UserService, useValue: mockService }, Reflector],
  })
    .overrideGuard(RolesGuard)
    .useValue(customRolesGuard)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.init()
  return app
}

// ── USER 身份 ─────────────────────────────────────────────────────────────────

describe('UserController (USER role — 普通用户)', () => {
  let app: INestApplication

  beforeAll(async () => { app = await buildApp(buildUser(UserRole.USER)) })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('POST /user/profile/detail → 200 (自己可访问)', () =>
    request(app.getHttpServer())
      .post('/user/profile/detail')
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.getProfile).toHaveBeenCalled()
      }))

  it('POST /user/profile/update → 200', () =>
    request(app.getHttpServer())
      .post('/user/profile/update')
      .send({ nickname: '新昵称' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.updateProfile).toHaveBeenCalled()
      }))

  it('POST /user/profile/change-password → 201', () =>
    request(app.getHttpServer())
      .post('/user/profile/change-password')
      .send({ oldPassword: 'oldpass1', newPassword: 'newpass123' })
      .expect(201))

  it('POST /user/create → 403 (USER 无权创建)', () =>
    request(app.getHttpServer())
      .post('/user/create')
      .send({ account: 'newuser', password: 'pass123', role: UserRole.USER })
      .expect(403))

  it('POST /user/list → 403 (USER 无权查看列表)', () =>
    request(app.getHttpServer())
      .post('/user/list')
      .send({})
      .expect(403))

  it('POST /user/detail → 403 (USER 无权查看他人)', () =>
    request(app.getHttpServer())
      .post('/user/detail')
      .send({ id: 2 })
      .expect(403))
})

// ── ADMIN 身份 ────────────────────────────────────────────────────────────────

describe('UserController (ADMIN role — 管理员)', () => {
  let app: INestApplication

  beforeAll(async () => { app = await buildApp(buildUser(UserRole.ADMIN)) })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('POST /user/list → 200 (管理员可查看列表)', () =>
    request(app.getHttpServer())
      .post('/user/list')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.findAll).toHaveBeenCalled()
      }))

  it('POST /user/create → 201', () =>
    request(app.getHttpServer())
      .post('/user/create')
      .send({ account: 'newuser', password: 'pass1234', nickname: '新用户', role: UserRole.USER })
      .expect(201)
      .expect((res) => {
        expect(mockService.create).toHaveBeenCalled()
      }))

  it('POST /user/detail → 201', () =>
    request(app.getHttpServer())
      .post('/user/detail')
      .send({ id: 2 })
      .expect(201))

  it('POST /user/update → 200', () =>
    request(app.getHttpServer())
      .post('/user/update')
      .send({ id: 2, nickname: 'updated' })
      .expect(201)
      .expect((res) => {
        expect(mockService.adminUpdateUser).toHaveBeenCalled()
      }))

  it('POST /user/update-status → 201', () =>
    request(app.getHttpServer())
      .post('/user/update-status')
      .send({ id: 2, status: 'ACTIVE' })
      .expect(201))

  it('POST /user/reset-password → 201', () =>
    request(app.getHttpServer())
      .post('/user/reset-password')
      .send({ id: 2, newPassword: 'newPass123!' })
      .expect(201)
      .expect((res) => {
        expect(mockService.resetPassword).toHaveBeenCalled()
      }))

  it('POST /user/delete → 200', () =>
    request(app.getHttpServer())
      .post('/user/delete')
      .send({ id: 2 })
      .expect(201)
      .expect((res) => {
        expect(mockService.remove).toHaveBeenCalled()
      }))

  it('POST /user/audit-log/list → 200', () =>
    request(app.getHttpServer())
      .post('/user/audit-log/list')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(0)
        expect(mockService.listAuditLog).toHaveBeenCalled()
      }))
})

// ── 未登录 ────────────────────────────────────────────────────────────────────

describe('UserController (unauthenticated)', () => {
  let app: INestApplication

  beforeAll(async () => { app = await buildApp(null) })
  afterAll(() => app.close())

  it('POST /user/profile/detail → 401', () =>
    request(app.getHttpServer()).post('/user/profile/detail').expect(401))
})

