/**
 * AuthService — 单元测试
 *
 * 覆盖要点：
 * - generateCaptcha(): 返回 { captchaId, svgImage }；调用 redis.set 存储验证码（含 TTL）
 * - login(): 验证码错误 → INVALID_CAPTCHA；账号锁定 → INVALID_USERNAME_PASSWORD；
 *   用户不存在 / 密码错误 → INVALID_USERNAME_PASSWORD；账号禁用 → USER_DISABLED；
 *   登录成功 → 返回 token 对象，且清空失败计数（调用 redis.del）
 *   [BIZ] 连续失败 LOGIN_MAX_FAIL 次触发账号锁定；低于上限不触发
 *   [BIZ] 验证码大小写不敏感；账号/密码为纯空格等同于未传
 * - refreshToken(): 无效 token → INVALID_REFRESH_TOKEN；用户禁用 → USER_DISABLED；
 *   宽限期 → 只返回新 accessToken；正常轮换 → 返回完整 token 对；
 *   [BIZ] 用户不存在 / 被禁用 → USER_DISABLED（即使在宽限期内）
 * - logout(): 将 accessToken 加入黑名单；如有 refreshToken 则同步撤销
 */

import * as svgCaptcha from 'svg-captcha'
import { UserStatus } from '@prisma/client'
import { AuthService } from '../auth.service'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { LOGIN_MAX_FAIL } from 'src/constant/auth.constant'

// ── 模块级 mock（必须在 import 之前声明，jest.mock 会被提升）─────────────────
jest.mock('svg-captcha', () => ({
  create: jest.fn(() => ({ text: 'abcd', data: '<svg>mock</svg>' })),
}))

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-captcha-id'),
}))

// bcrypt 使用模块级 mock 避免 Node.js 24 的 defineProperty 限制
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  genSalt: jest.fn(),
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

// bcrypt mock accessor（与模块级 jest.mock 配合使用）
import * as bcryptMocked from 'bcrypt'
const bcryptCompare = bcryptMocked.compare as jest.Mock

// ══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════════════════════

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 默认：密码校验通过
    bcryptCompare.mockResolvedValue(true)
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

      bcryptCompare.mockResolvedValue(false) // 密码不匹配

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

      bcryptCompare.mockResolvedValue(true)

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
      bcryptCompare.mockResolvedValue(true)

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
      bcryptCompare.mockResolvedValue(true)

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
      bcryptCompare.mockResolvedValue(true)

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

  // ── login: 账号锁定机制（边界）──────────────────────────────────────────────

  describe('[BIZ] login() 连续失败锁定机制', () => {
    /** 构建验证码正确、账号存在、密码错误的场景 */
    function buildWrongPasswordScenario() {
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
      bcryptCompare.mockResolvedValue(false)
      return { redis, prisma }
    }

    it('[BIZ] 连续失败次数低于上限（LOGIN_MAX_FAIL-1）时不触发锁定', async () => {
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(LOGIN_MAX_FAIL - 1)
      const service = createService(prisma, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      // incr 应被调用
      expect(redis.incr).toHaveBeenCalled()
      // 未达到上限，不应设置锁定 key
      const setCallArgs = (redis.set as jest.Mock).mock.calls.map((c) => c[0] as string)
      expect(setCallArgs.every((k) => !k.includes('lock'))).toBe(true)
    })

    it('[BIZ] 连续失败次数达到 LOGIN_MAX_FAIL 时触发账号锁定（设置 lock key）', async () => {
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(LOGIN_MAX_FAIL)
      const service = createService(prisma, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      // 应设置锁定 key
      const setCallArgs = (redis.set as jest.Mock).mock.calls.map((c) => c[0] as string)
      expect(setCallArgs.some((k) => k.includes('lock'))).toBe(true)
    })

    it('[BIZ] 锁定后同时删除失败计数 key', async () => {
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(LOGIN_MAX_FAIL)
      const service = createService(prisma, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      // lock 触发后应删除 fail key
      const delCallArgs = (redis.del as jest.Mock).mock.calls.map((c) => c[0] as string)
      expect(delCallArgs.some((k) => k.includes('fail'))).toBe(true)
    })

    it('[BIZ] 首次失败时为 fail key 设置过期时间（expire）', async () => {
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(1) // 第一次失败
      const service = createService(prisma, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      expect(redis.expire).toHaveBeenCalled()
    })

    it('[BIZ] 非首次失败（count>1）时不重复设置 expire', async () => {
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(3) // 第三次失败
      const service = createService(prisma, undefined, redis)

      await expect(service.login(buildLoginDto())).rejects.toThrow(BusinessException)
      expect(redis.expire).not.toHaveBeenCalled()
    })

    it('[BUG P1-B1] INCR 成功但 EXPIRE 失败时异常冒泡，failKey 无 TTL 永久存在', async () => {
      // BUG：INCR 与 EXPIRE 是两个独立 Redis 调用，非原子操作。
      // 若 INCR 成功（count=1）后 EXPIRE 前进程超时/崩溃，fail key 将无 TTL 永久累积。
      // 攻击者可利用此特性在 5 分钟窗口结束后仍触发锁定，无限延迟合法用户登录。
      const { redis, prisma } = buildWrongPasswordScenario()
      redis.incr.mockResolvedValue(1)
      redis.expire.mockRejectedValue(new Error('Redis EXPIRE timeout')) // EXPIRE 失败

      const service = createService(prisma, undefined, redis)

      // [BUG] EXPIRE 失败时 Redis 超时异常冒泡至调用方（应返回 BusinessException，实际抛 Redis 错）
      await expect(service.login(buildLoginDto())).rejects.toThrow('Redis EXPIRE timeout')

      // 记录非原子性证据：INCR 已执行成功，EXPIRE 失败 → failKey 无 TTL
      expect(redis.incr).toHaveBeenCalled()
      expect(redis.expire).toHaveBeenCalled()

      // 修复方案：使用 SET failKey 1 NX EX TTL 的原子操作，或 Lua 脚本
    })
  })

  // ── login: 输入规范化边界 ───────────────────────────────────────────────────

  describe('[EDGE] login() 输入规范化', () => {
    it('[EDGE] 账号为纯空格时等同于未传账号 → 抛出 BusinessException', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)
      const service = createService(undefined, undefined, redis)

      await expect(service.login(buildLoginDto({ account: '   ' }))).rejects.toThrow(BusinessException)
    })

    it('[EDGE] 密码为空字符串时 → 抛出 BusinessException', async () => {
      const redis = buildRedisMock()
      redis.getDel.mockResolvedValue('abcd')
      redis.exists.mockResolvedValue(0)
      const service = createService(undefined, undefined, redis)

      await expect(service.login(buildLoginDto({ password: '' }))).rejects.toThrow(BusinessException)
    })

    it('[BIZ] 验证码大小写不敏感：提交大写仍通过（Redis 存小写）', async () => {
      const redis = buildRedisMock()
      // Redis 存储的是小写 'abcd'
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
      bcryptCompare.mockResolvedValue(true)

      const service = createService(prisma, undefined, redis)
      // 提交大写 'ABCD'，应与存储的 'abcd' 匹配
      const result = await service.login(buildLoginDto({ captchaCode: 'ABCD' }))
      expect(result).toHaveProperty('accessToken')
    })

    it('[EDGE] captchaId 含前后空格时被 trim 处理', async () => {
      const redis = buildRedisMock()
      // 模拟 getDel 对 trimmed key 返回值
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
      bcryptCompare.mockResolvedValue(true)

      const service = createService(prisma, undefined, redis)
      // captchaId 有前后空格
      const result = await service.login(buildLoginDto({ captchaId: '  mock-captcha-id  ' }))
      expect(result).toHaveProperty('accessToken')
    })
  })

  // ── refreshToken: 用户状态边界 ──────────────────────────────────────────────

  describe('[BIZ] refreshToken() 用户状态边界', () => {
    it('[BIZ] 用户已从数据库删除（findUnique 返回 null）→ 抛出 USER_DISABLED', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue(null)

      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)
      tokenService.isRefreshTokenValid.mockResolvedValue('valid' as never)

      const service = createService(prisma, tokenService)
      await expect(service.refreshToken('valid-token')).rejects.toThrow(BusinessException)
    })

    it('[BIZ] 宽限期内用户账号被禁用 → 也应抛出 BusinessException（不允许续签）', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        account: 'admin',
        status: UserStatus.DEACTIVATED,
        nickname: 'Admin',
        role: 'ADMIN',
      } as never)

      const tokenService = buildTokenServiceMock()
      tokenService.verifyRefreshToken.mockResolvedValue({ id: 1, account: 'admin', jti: 'jti1' } as never)
      tokenService.isRefreshTokenValid.mockResolvedValue('grace' as never)

      const service = createService(prisma, tokenService)
      // 宽限期内但用户已被禁用，不得返回新 token
      await expect(service.refreshToken('grace-token')).rejects.toThrow(BusinessException)
    })
  })

  // ── logout: 边界场景 ────────────────────────────────────────────────────────

  describe('[EDGE] logout() 边界场景', () => {
    it('[EDGE] 仅传入 accessToken（无 refreshToken）→ 只调用 blacklistAccessToken，不尝试撤销 RT', async () => {
      const tokenService = buildTokenServiceMock()
      const service = createService(undefined, tokenService)

      await service.logout('only-access-token')

      expect(tokenService.blacklistAccessToken).toHaveBeenCalledWith('only-access-token')
      expect(tokenService.deleteRefreshToken).not.toHaveBeenCalled()
      expect(tokenService.verifyRefreshToken).not.toHaveBeenCalled()
    })
  })
})
