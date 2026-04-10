/**
 * create-test-app.ts — 可复用的 NestJS 测试应用工厂
 *
 * 用法：
 *   const { app, request } = await createTestApp({
 *     controllers: [AuthController],
 *     providers: [{ provide: AuthService, useValue: mockAuthService }],
 *   })
 *   await request.post('/auth/login').send({...}).expect(200)
 *   await app.close()
 */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ModuleMetadata,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { Reflector } from '@nestjs/core'
import * as request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { TokenPayload } from 'src/shared/token.interface'
import { LoggerService } from 'src/shared/logger/logger.service'
import { UserRole } from '@prisma/client'

export function buildTestUser(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    id: 1,
    account: 'test',
    nickname: 'Test',
    role: UserRole.USER,
    jti: 'test-jti',
    ...overrides,
  }
}

export interface CreateTestAppOptions extends Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> {
  /**
   * Authenticated user injected into request.user on non-Public routes.
   * Pass `null` to simulate an unauthenticated request (guard throws UnauthorizedException).
   * Defaults to `buildTestUser()` when omitted.
   */
  user?: TokenPayload | null
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

export async function createTestApp(options: CreateTestAppOptions = {}) {
  const { controllers = [], providers = [], imports = [] } = options
  // undefined → use default user; null → unauthenticated; TokenPayload → specific user
  const user: TokenPayload | null = options.user !== undefined ? options.user : buildTestUser()

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports,
    controllers,
    providers,
  }).compile()

  const app: INestApplication = moduleRef.createNestApplication()
  const reflector = moduleRef.get(Reflector)

  // Mock JWT guard: honours @Public(), injects user into request.user, or throws UnauthorizedException
  const mockJwtGuard: CanActivate = {
    canActivate(ctx: ExecutionContext): boolean {
      const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])
      if (isPublic) return true
      if (!user) throw new UnauthorizedException('用户未登录或 Token 已失效')
      ctx.switchToHttp().getRequest().user = user
      return true
    },
  }

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  // JWT guard must run before RolesGuard so request.user is populated
  app.useGlobalGuards(mockJwtGuard, new RolesGuard(reflector))
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

  await app.init()

  return {
    app,
    request: request(app.getHttpServer()),
  }
}
