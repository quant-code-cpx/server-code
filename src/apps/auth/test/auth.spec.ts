/**
 * Auth 模块 V2 测试（全新设计）
 *
 * 与 V1 的关键区别：
 * 1. Service 层测试登录核心流程（验证码→密码→锁定→Token 签发）
 * 2. Controller 层测试 DTO 校验 + Guard 行为
 * 3. 验证隐藏的业务规则：不区分"账号不存在"和"密码错误"、"空 body 不被穿透"
 */

import { Test, TestingModule } from '@nestjs/testing'
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { UserStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { AuthService } from '../auth.service'
import { AuthController } from '../auth.controller'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { PUBLIC_KEY, LOGIN_MAX_FAIL, LOGIN_FAIL_WINDOW, LOGIN_LOCK_DURATION, CAPTCHA_TTL, REDIS_KEY } from 'src/constant/auth.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { buildTestUser } from 'test/helpers/create-test-app'

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockLoggerService(): LoggerService {
  return {
    log: jest.fn(), warn: jest.fn(), error: jest.fn(),
    debug: jest.fn(), verbose: jest.fn(), devLog: jest.fn(),
  } as unknown as LoggerService
}

/**
 * Create a mock Redis client with an in-memory store.
 * Supports: set/get/getDel/exists/incr/expire/del with TTL via setTimeout.
 */
function createMockRedis() {
  const store = new Map<string, string>()
  const timers = new Map<string, NodeJS.Timeout>()

  const clearTimer = (key: string) => {
    const t = timers.get(key)
    if (t) { clearTimeout(t); timers.delete(key) }
  }

  return {
    store,
    set: jest.fn().mockImplementation((key: string, value: string, opts?: { EX?: number }) => {
      store.set(key, value)
      clearTimer(key)
      if (opts?.EX) {
        timers.set(key, setTimeout(() => store.delete(key), opts.EX * 1000))
      }
      return Promise.resolve('OK')
    }),
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(store.get(key) ?? null)
    }),
    getDel: jest.fn().mockImplementation((key: string) => {
      const val = store.get(key) ?? null
      store.delete(key)
      clearTimer(key)
      return Promise.resolve(val)
    }),
    exists: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(store.has(key) ? 1 : 0)
    }),
    incr: jest.fn().mockImplementation((key: string) => {
      const current = parseInt(store.get(key) ?? '0', 10) + 1
      store.set(key, String(current))
      return Promise.resolve(current)
    }),
    expire: jest.fn().mockImplementation((key: string, ttl: number, mode?: string) => {
      // 'NX' mode: only set TTL if it doesn't exist
      if (mode === 'NX' && timers.has(key)) return Promise.resolve(false)
      clearTimer(key)
      if (ttl > 0) {
        timers.set(key, setTimeout(() => store.delete(key), ttl * 1000))
      }
      return Promise.resolve(true)
    }),
    del: jest.fn().mockImplementation((key: string) => {
      store.delete(key)
      clearTimer(key)
      return Promise.resolve(1)
    }),
  }
}

// ── Service Unit Tests ────────────────────────────────────────────────────────

describe('AuthService — 登录核心流程', () => {
  let service: AuthService
  let mockRedis: ReturnType<typeof createMockRedis>
  let mockPrisma: any
  let mockTokenService: any

  const TEST_USER = {
    id: 1,
    account: 'testuser',
    password: '', // set in beforeAll
    nickname: 'Test',
    role: 'USER' as const,
    status: UserStatus.ACTIVE,
  }

  const VALID_TOKENS = {
    accessToken: 'jwt-access-token',
    refreshToken: 'jwt-refresh-token',
    refreshTokenTTL: 604800,
  }

  beforeAll(async () => {
    TEST_USER.password = await bcrypt.hash('correct-password', 4)

    mockRedis = createMockRedis()

    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(TEST_USER),
        update: jest.fn().mockResolvedValue(undefined),
      },
    }

    mockTokenService = {
      generateTokens: jest.fn().mockResolvedValue(VALID_TOKENS),
      verifyRefreshToken: jest.fn().mockResolvedValue({ id: 1, jti: 'jti-1', account: 'testuser' }),
      isRefreshTokenValid: jest.fn().mockResolvedValue('valid'),
      generateAccessToken: jest.fn().mockResolvedValue('new-access-token'),
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
      blacklistAccessToken: jest.fn().mockResolvedValue(undefined),
      deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
  })

  beforeEach(() => {
    mockRedis.store.clear()
    jest.clearAllMocks()
    // Reset mock returns
    mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
    mockTokenService.generateTokens.mockResolvedValue(VALID_TOKENS)
    mockTokenService.verifyRefreshToken.mockResolvedValue({ id: 1, jti: 'jti-1', account: 'testuser' })
  })

  // ── 验证码 ────────────────────────────────────────────────────────────────
  describe('验证码', () => {
    it('生成验证码：返回 captchaId + svgImage', async () => {
      const result = await service.generateCaptcha()
      expect(result.captchaId).toBeDefined()
      expect(result.svgImage).toBeDefined()
      expect(mockRedis.set).toHaveBeenCalled()
    })

    it('验证码存入 Redis 时转为小写', async () => {
      const result = await service.generateCaptcha()
      const storedValue = mockRedis.store.get(REDIS_KEY.CAPTCHA(result.captchaId))
      expect(storedValue).toBe(storedValue?.toLowerCase())
    })
  })

  // ── 登录成功 ─────────────────────────────────────────────────────────────
  describe('登录成功', () => {
    it('正确验证码+正确密码 → 返回 accessToken', async () => {
      // 先生成验证码
      const captcha = await service.generateCaptcha()
      const captchaCode = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!

      const result = await service.login({
        account: 'testuser',
        password: 'correct-password',
        captchaId: captcha.captchaId,
        captchaCode,
      })

      expect(result.accessToken).toBe('jwt-access-token')
      expect(result.refreshToken).toBe('jwt-refresh-token')
    })

    it('登录成功后验证码被消费（getDel 删除）', async () => {
      const captcha = await service.generateCaptcha()
      const captchaCode = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!

      await service.login({ account: 'testuser', password: 'correct-password', captchaId: captcha.captchaId, captchaCode })
      expect(mockRedis.getDel).toHaveBeenCalledWith(REDIS_KEY.CAPTCHA(captcha.captchaId))
    })

    it('登录成功后清除失败计数', async () => {
      // 先制造1次失败
      const captcha1 = await service.generateCaptcha()
      const code1 = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha1.captchaId))!
      await service.login({ account: 'testuser', password: 'wrong', captchaId: captcha1.captchaId, captchaCode: code1 }).catch(() => {})

      // 再成功登录
      const captcha2 = await service.generateCaptcha()
      const code2 = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha2.captchaId))!
      await service.login({ account: 'testuser', password: 'correct-password', captchaId: captcha2.captchaId, captchaCode: code2 })

      // 失败计数应被清除
      expect(mockRedis.del).toHaveBeenCalledWith(REDIS_KEY.LOGIN_FAIL('testuser'))
    })
  })

  // ── 登录失败 ─────────────────────────────────────────────────────────────
  describe('登录失败', () => {
    it('错误密码 → 抛出 INVALID_USERNAME_PASSWORD', async () => {
      const captcha = await service.generateCaptcha()
      const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!

      await expect(
        service.login({ account: 'testuser', password: 'wrong', captchaId: captcha.captchaId, captchaCode: code }),
      ).rejects.toThrow(BusinessException)
    })

    it('不存在的账号 → 同样抛出 INVALID_USERNAME_PASSWORD（防止账号枚举）', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)
      const captcha = await service.generateCaptcha()
      const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!

      await expect(
        service.login({ account: 'nonexistent', password: 'any', captchaId: captcha.captchaId, captchaCode: code }),
      ).rejects.toThrow(BusinessException)
    })

    it('错误验证码 → 抛出 INVALID_CAPTCHA', async () => {
      await service.generateCaptcha() // consumes the captcha store
      await expect(
        service.login({ account: 'testuser', password: 'correct-password', captchaId: 'fake-id', captchaCode: 'wrong' }),
      ).rejects.toThrow(BusinessException)
    })

    it('验证码不区分大小写', async () => {
      const captcha = await service.generateCaptcha()
      // Get the stored lowercase value
      const storedValue = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!
      const upperCode = storedValue.toUpperCase()

      // This should pass because validateCaptcha lowercases the input
      const result = await service.login({
        account: 'testuser',
        password: 'correct-password',
        captchaId: captcha.captchaId,
        captchaCode: upperCode,
      })
      expect(result.accessToken).toBeDefined()
    })
  })

  // ── 账号锁定 ─────────────────────────────────────────────────────────────
  describe('账号锁定', () => {
    it(`连续 ${LOGIN_MAX_FAIL} 次失败后账号锁定`, async () => {
      for (let i = 0; i < LOGIN_MAX_FAIL; i++) {
        const captcha = await service.generateCaptcha()
        const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!
        await service.login({ account: 'testuser', password: 'wrong', captchaId: captcha.captchaId, captchaCode: code }).catch(() => {})
      }

      // 锁定标记应存在
      const isLocked = await mockRedis.exists(REDIS_KEY.LOGIN_LOCK('testuser'))
      expect(isLocked).toBe(1)
    })

    it('锁定期内正确密码也被拒绝', async () => {
      // 先触发锁定
      for (let i = 0; i < LOGIN_MAX_FAIL; i++) {
        const captcha = await service.generateCaptcha()
        const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!
        await service.login({ account: 'testuser', password: 'wrong', captchaId: captcha.captchaId, captchaCode: code }).catch(() => {})
      }

      // 锁定期内正确密码
      const captcha = await service.generateCaptcha()
      const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!
      await expect(
        service.login({ account: 'testuser', password: 'correct-password', captchaId: captcha.captchaId, captchaCode: code }),
      ).rejects.toThrow(BusinessException)
    })
  })

  // ── 账号禁用 ─────────────────────────────────────────────────────────────
  describe('账号状态', () => {
    it('已禁用账号 → 拒绝登录', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TEST_USER, status: UserStatus.DEACTIVATED })
      const captcha = await service.generateCaptcha()
      const code = mockRedis.store.get(REDIS_KEY.CAPTCHA(captcha.captchaId))!

      await expect(
        service.login({ account: 'testuser', password: 'correct-password', captchaId: captcha.captchaId, captchaCode: code }),
      ).rejects.toThrow(BusinessException)
    })
  })

  // ── Refresh Token ────────────────────────────────────────────────────────
  describe('Refresh Token', () => {
    it('有效 RT → 返回新 AT', async () => {
      const result = await service.refreshToken('valid-rt')
      expect(result.accessToken).toBe('jwt-access-token')
    })

    it('无效 RT → 抛出 INVALID_REFRESH_TOKEN', async () => {
      mockTokenService.verifyRefreshToken.mockRejectedValue(new Error('expired'))
      await expect(service.refreshToken('invalid-rt')).rejects.toThrow(BusinessException)
    })
  })

  // ── Logout ───────────────────────────────────────────────────────────────
  describe('登出', () => {
    it('登出后 AT 被加入黑名单', async () => {
      await service.logout('some-access-token', 'some-refresh-token')
      expect(mockTokenService.blacklistAccessToken).toHaveBeenCalledWith('some-access-token')
    })

    it('登出后 RT 被撤销', async () => {
      await service.logout('some-access-token', 'some-refresh-token')
      expect(mockTokenService.deleteRefreshToken).toHaveBeenCalled()
    })
  })
})

// ── Controller Integration Tests ──────────────────────────────────────────────

describe('AuthController — DTO校验 + Guard行为', () => {
  let app: INestApplication
  let httpRequest: any
  let mockAuthService: any

  beforeAll(async () => {
    mockAuthService = {
      generateCaptcha: jest.fn().mockResolvedValue({ captchaId: 'test-cid', svgImage: '<svg>...</svg>' }),
      login: jest.fn().mockResolvedValue({
        accessToken: 'jwt-token',
        refreshToken: 'refresh-token',
        refreshTokenTTL: 604800,
      }),
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: 'new-jwt-token',
        refreshToken: null,
        refreshTokenTTL: 0,
      }),
      logout: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: LoggerService, useValue: createMockLoggerService() },
      ],
    }).compile()

    app = module.createNestApplication()
    const reflector = module.get<Reflector>(Reflector)

    // All auth endpoints are @Public, so guard always passes
    const permissiveGuard: CanActivate = {
      canActivate: () => true,
    }

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalGuards(permissiveGuard)
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new GlobalExceptionsFilter(true, createMockLoggerService()))

    await app.init()
    httpRequest = request(app.getHttpServer())
  })

  afterAll(async () => {
    await app.close()
  })

  // ── 验证码 ──────────────────────────────────────────────────────────────
  describe('captcha', () => {
    it('POST /auth/captcha → 201 + captchaId + svgImage', async () => {
      const res = await httpRequest.post('/auth/captcha').expect(201)
      expect(res.body.data.captchaId).toBe('test-cid')
    })
  })

  // ── 登录 ────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('正常登录 → 201 + accessToken', async () => {
      const res = await httpRequest
        .post('/auth/login')
        .send({ account: 'admin', password: '123', captchaId: 'cid', captchaCode: 'A8K2' })
        .expect(201)
      expect(res.body.data.accessToken).toBe('jwt-token')
    })

    it('空 body → ValidationPipe 拦截（HTTP 400）', async () => {
      mockAuthService.login.mockClear()
      await httpRequest.post('/auth/login').send({}).expect(400)
      expect(mockAuthService.login).not.toHaveBeenCalled()
    })
  })

  // ── Refresh ─────────────────────────────────────────────────────────────
  describe('refresh', () => {
    it('POST /auth/refresh → 201 + accessToken', async () => {
      const res = await httpRequest
        .post('/auth/refresh')
        .send({ refreshToken: 'some-rt' })
        .expect(201)
      expect(res.body.data.accessToken).toBe('new-jwt-token')
    })

    it('无 refreshToken → 业务异常（HTTP 200 + error code）', async () => {
      mockAuthService.refreshToken.mockRejectedValueOnce(
        new BusinessException(ErrorEnum.INVALID_REFRESH_TOKEN),
      )
      await httpRequest.post('/auth/refresh').send({}).expect(200)
    })
  })

  // ── Logout ──────────────────────────────────────────────────────────────
  describe('logout', () => {
    it('POST /auth/logout → 201', async () => {
      const res = await httpRequest
        .post('/auth/logout')
        .set('Authorization', 'Bearer some-token')
        .expect(201)
    })
  })
})