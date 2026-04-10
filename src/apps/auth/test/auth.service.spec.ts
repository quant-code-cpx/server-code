/**
 * AuthService — 单元测试
 *
 * 覆盖要点：
 * - generateCaptcha(): 返回 { captchaId, svgImage }；调用 redis.set 存储验证码（含 TTL）
 * - login(): 验证码错误 → INVALID_CAPTCHA；账号锁定 → INVALID_USERNAME_PASSWORD；
 *   用户不存在 / 密码错误 → INVALID_USERNAME_PASSWORD；账号禁用 → USER_DISABLED；
 *   登录成功 → 返回 token 对象，且清空失败计数（调用 redis.del）
 * - refreshToken(): 无效 token → INVALID_REFRESH_TOKEN；用户禁用 → USER_DISABLED；
 *   宽限期 → 只返回新 accessToken；正常轮换 → 返回完整 token 对
 * - logout(): 将 accessToken 加入黑名单；如有 refreshToken 则同步撤销
 */

import * as svgCaptcha from 'svg-captcha'
import * as bcrypt from 'bcrypt'
import { UserStatus } from '@prisma/client'
import { AuthService } from '../auth.service'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'

// ── 模块级 mock（必须在 import 之前声明，但 jest.mock 会被提升）─────────────────
jest.mock('svg-captcha', () => ({
  create: jest.fn(() => ({ text: 'abcd', data: '<svg>mock</svg>' })),
}))

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-captcha-id'),
}))

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
  }
}

function buildTokenServiceMock() {
  return {
    generateTokens: jest.fn(async () => ({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      refreshTokenTTL: 604800,
    })),
    generateAccessToken: jest.fn(async () => 'mock-access-token'),
    verifyRefreshToken: jest.fn(async () => ({ id: 1, account: 'admin', jti: 'mock-jti' })),
    revokeRefreshToken: jest.fn(async () => undefined),
    deleteRefreshToken: jest.fn(async () => undefined),
    blacklistAccessToken: jest.fn(async () => undefined),
    isRefreshTokenValid: jest.fn(async () => 'valid' as const),
  }
}

function buildRedisMock() {
  return {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    getDel: jest.fn(async () => null),
    exists: jest.fn(async () => 0),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
  }
}

function createService(
  prisma = buildPrismaMock(),
  tokenService = buildTokenServiceMock(),
  redis = buildRedisMock(),
): AuthService {
  // @ts-ignore 局部 mock，跳过 DI
  return new AuthService(prisma as PrismaService, tokenService as TokenService, redis)
}

/** 构建合法的登录 DTO */
function buildLoginDto(overrides: Record<string, string> = {}) {
  return {
    account: 'admin',
    password: 'Password123!',
    captchaId: 'mock-captcha-id',
    captchaCode: 'abcd',
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════════════════════

describe('AuthService', () => {
  let bcryptCompareSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    // 默认：密码校验通过
    bcryptCompareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never)
  })

  afterEach(() => {
    bcryptCompareSpy.mockRestore()
  })

  // ── generateCaptcha ────────────────────────────────────────────────────────

  describe('generateCaptcha()', () => {
    it('返回包含 captchaId 和 svgImage 的对象', async () => {
      const service = createService()
      const result = await service.generateCaptcha()
      expect(result).toHaveProperty('captchaId')
      expect(result).toHaveProperty('svgImage')
      expect(result.captchaId).toBeTruthy()
      expect(result.svgImage).toContain('<svg>')
    })

    it('将验证码文本存入 Redis（带 TTL）', async () => {
      const redis = buildRedisMock()
      const service = createService(undefined, undefined, redis)
      const result = await service.generateCaptcha()
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('captcha'),
        expect.any(String),
        expect.objectContaining({ EX: expect.any(Number) }),
      )
      // captchaId 用于构造 Redis key
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining(result.captchaId),
        expect.any(String),
        expect.anything(),
      )
    })

    it('svgCaptcha.create 被调用', async () => {
      const service = createService()
      await service.generateCaptcha()
      expect(svgCaptcha.create).toHaveBeenCalled()
    })
  })

  // ── login: 验证码校验 ──────────────────────────────────────────────────────

  describe('login() 验证码校验', () => {
    it('验证码 ID 为空 → 抛出 INVALID_CAPTCHA', async () => {
      const service = createService()
      await expect(service.login(buildLoginDto({ captchaId: '' }))).rejects.toThrow(BusinessException)
    })

    it('验证码不匹配 → 抛出 INVALID_CAPTCHA', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('wxyz') // Redis 中存储的是 'wxyz'
      const service = createService(undefined, undefined, redis)
      // 提交的是 'abcd'，不匹配
      await expect(service.login(buildLoginDto({ captchaCode: 'abcd' }))).rejects.toThrow(BusinessException)
    })

    it('验证码 Redis 中不存在（已过期）→ 抛出 BusinessException', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue(null) // 不存在
      const service = createService(undefined, undefined, redis)
      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
    })
  })

  // ── login: 账号锁定 ────────────────────────────────────────────────────────

  describe('login() 账号锁定', () => {
    it('账号已锁定 → 抛出 INVALID_USERNAME_PASSWORD', async () => {
      const redis = buildRedisMock()
      // 验证码正确
      redis.getDel.mockResolvedValue('abcd')
      // 账号锁定
      redis.exists.mockResolvedValue(1)
      const service = createService(undefined, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
    })
  })

  // ── login: 用户查询与密码校验 ──────────────────────────────────────────────

  describe('login() 用户与密码', () => {
    it('用户不存在 → 抛出 BusinessException（不暴露账号是否存在）', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null)

      const service = createService(prisma, undefined, redis)
      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
    })

    it('密码错误 → 抛出 BusinessException，并记录失败次数（调用 redis.incr）', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        account: 'admin',
        password: '$2b$10$hashedpassword',
        status: UserStatus.ACTIVE,
        nickname: 'Admin',
        role: 'ADMIN',
        lastLoginAt: null,
      } as never)

      bcryptCompareSpy.mockResolvedValue(false as never) // 密码不匹配

      const service = createService(prisma, undefined, redis)
      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      // 密码错误时应记录失败次数
      expect(redis.incr).toHaveBeenCalled()
    })

    it('账号禁用（status=DISABLED）→ 抛出 USER_DISABLED 异常', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        account: 'admin',
        password: '$2b$10$hashedpassword',
        status: UserStatus.DEACTIVATED,
        nickname: 'Admin',
        role: 'ADMIN',
        lastLoginAt: null,
      } as never)

      bcryptCompareSpy.mockResolvedValue(true as never)

      const service = createService(prisma, undefined, redis)

      try {
        await service.login(buildLoginDto())
        fail('应当抛出异常')
      } catch (err) {
        expect(err).toBeInstanceOf(BusinessException)
        expect((err as BusinessException).message).toContain('禁用')
      }
    })
  })

  // ── login: 登录成功 ────────────────────────────────────────────────────────

  describe('login() 成功路径', () => {
    function buildActiveUser() {
      return {
        id: 1,
        account: 'admin',
        password: '$2b$10$hashedpassword',
        status: UserStatus.ACTIVE,
        nickname: 'Admin',
        role: 'ADMIN',
        lastLoginAt: null,
      }
    }

    it('验证码正确 + 密码正确 + 账号正常 → 返回 token 对象', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildActiveUser() as never)
      bcryptCompareSpy.mockResolvedValue(true as never)

      const service = createService(prisma, undefined, redis)
      const result = await service.login(buildLoginDto())

      expect(result).toHaveProperty('accessToken')
      expect(result).toHaveProperty('refreshToken')
      expect(result).toHaveProperty('refreshTokenTTL')
      expect(result.accessToken).toBeTruthy()
      expect(result.refreshToken).toBeTruthy()
      expect(result.refreshTokenTTL).toBeGreaterThan(0)
    })

    it('登录成功 → 调用 redis.del 清除失败计数', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildActiveUser() as never)
      bcryptCompareSpy.mockResolvedValue(true as never)

      const service = createService(prisma, undefined, redis)
      await service.login(buildLoginDto())

      // 应调用 del 清除 login:fail key
      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('login:fail'))
    })

    it('登录成功 → 更新最后登录时间（调用 prisma.user.update）', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)

      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(buildActiveUser() as never)
      bcryptCompareSpy.mockResolvedValue(true as never)

      const service = createService(prisma, undefined, redis)
      await service.login(buildLoginDto())

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      )
    })
  })

  // ── refreshToken ───────────────────────────────────────────────────────────

  describe('refreshToken()', () => {
    it('无效 Refresh Token → 抛出 BusinessException', async () => {
      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockRejectedValue(new Error('invalid token'))
      const service = createService(undefined, tokenService)

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(BusinessException)
    })

    it('Redis 中 token 无效（invalid）→ 抛出 INVALID_REFRESH_TOKEN', async () => {
      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)
      tokenService.isRefreshTokenValid.mockResolvedValue('invalid' as never)

      const service = createService(undefined, tokenService)
      await expect(service.refreshToken('old-token')).rejects.toThrow(BusinessException)
    })

    it('宽限期内（grace）→ 只返回新 accessToken，refreshToken 为 null', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue({
        id: 1, account: 'admin', status: UserStatus.ACTIVE,
        nickname: 'Admin', role: 'ADMIN',
      } as never)

      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)
      tokenService.isRefreshTokenValid.mockResolvedValue('grace' as never)

      const service = createService(prisma, tokenService)
      const result = await service.refreshToken('grace-token')

      expect(result.accessToken).toBeTruthy()
      expect(result.refreshToken).toBeNull()
      expect(result.refreshTokenTTL).toBe(0)
    })

    it('正常 token → 轮换：撤销旧 RT 并返回新 token 对', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue({
        id: 1, account: 'admin', status: UserStatus.ACTIVE,
        nickname: 'Admin', role: 'ADMIN',
      } as never)

      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)
      tokenService.isRefreshTokenValid.mockResolvedValue('valid' as never)

      const service = createService(prisma, tokenService)
      const result = await service.refreshToken('valid-refresh-token')

      expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith(1, 'jti1')
      expect(result.accessToken).toBeTruthy()
      expect(result.refreshToken).toBeTruthy()
    })
  })

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('传入 accessToken → 调用 blacklistAccessToken', async () => {
      const tokenService = buildTokenServiceMock()
      const service = createService(undefined, tokenService)

      await service.logout('bearer-access-token')
      expect(tokenService.blacklistAccessToken).toHaveBeenCalledWith('bearer-access-token')
    })

    it('同时传入 refreshToken → 额外调用 deleteRefreshToken', async () => {
      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)

      const service = createService(undefined, tokenService)
      await service.logout('access-token', 'refresh-token')

      expect(tokenService.deleteRefreshToken).toHaveBeenCalledWith(1, 'jti1')
    })

    it('refreshToken 无效（已过期）→ 不抛异常，仍完成 accessToken 黑名单操作', async () => {
      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockRejectedValue(new Error('expired'))

      const service = createService(undefined, tokenService)
      await expect(service.logout('access-token', 'expired-refresh-token')).resolves.toBeUndefined()
      expect(tokenService.blacklistAccessToken).toHaveBeenCalled()
      expect(tokenService.deleteRefreshToken).not.toHaveBeenCalled()
    })
  })
})
