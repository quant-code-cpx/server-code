/**
 * TokenService — 单元测试
 *
 * 覆盖场景：
 * - blacklistAccessToken: 有效 Token TTL > 0 → 写入 Redis 黑名单（含正确 TTL）
 * - blacklistAccessToken: 已过期 Token → verifyAccessToken 抛出 → catch → 不写黑名单，不报错
 * - [E2E-B3 验证] remainingTTL = 0（exp = now）→ redis.set 不被调用（代码已正确处理）
 * - [BUG Real-B1] Token 缺少 exp 字段 → remainingTTL = 0 → 无法加黑名单（安全隐患）
 * - isAccessTokenBlacklisted: redis 返回 '1' → true；返回 null → false
 */

import { TokenService } from '../token.service'
import { REDIS_KEY } from 'src/constant/auth.constant'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildService() {
  const jwtMock = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  }
  const configMock = {
    get: jest.fn(() => ({
      accessTokenOptions: { expiresIn: 1800, secret: 'test-secret-32-chars-long-enough' },
      refreshTokenOptions: { expiresIn: 43200, secret: 'test-secret-32-chars-long-enough' },
    })),
  }
  const redisMock = {
    set: jest.fn(async () => 'OK' as const),
    get: jest.fn(async () => null as string | null),
    del: jest.fn(async () => 1),
  }
  const service = new TokenService(jwtMock as any, configMock as any, redisMock as any)
  return { service, jwtMock, redisMock }
}

// ── 测试 ───────────────────────────────────────────────────────────────────────

describe('TokenService', () => {
  // ── blacklistAccessToken ───────────────────────────────────────────────────

  describe('blacklistAccessToken()', () => {
    it('[BIZ] 有效 Token 且 TTL > 0 → redis.set 以正确 TTL 写入黑名单', async () => {
      const { service, jwtMock, redisMock } = buildService()
      const now = Math.floor(Date.now() / 1000)
      jwtMock.verifyAsync.mockResolvedValue({ jti: 'test-jti', exp: now + 1800 })

      await service.blacklistAccessToken('valid.token.here')

      expect(redisMock.set).toHaveBeenCalledWith(
        REDIS_KEY.TOKEN_BLACKLIST('test-jti'),
        '1',
        expect.objectContaining({ EX: expect.any(Number) }),
      )
      // TTL 应约为 1800s（允许 ±2s 的时间误差）
      const callArgs = redisMock.set.mock.calls[0] as unknown as [string, string, { EX: number }]
      expect(callArgs[2].EX).toBeGreaterThan(1797)
      expect(callArgs[2].EX).toBeLessThanOrEqual(1800)
    })

    it('[BIZ] 已过期 Token → verifyAccessToken 抛出 → catch → 不写黑名单，不抛错', async () => {
      const { service, jwtMock, redisMock } = buildService()
      jwtMock.verifyAsync.mockRejectedValue(new Error('jwt expired'))

      // 不应抛出异常
      await expect(service.blacklistAccessToken('expired.token.here')).resolves.toBeUndefined()
      expect(redisMock.set).not.toHaveBeenCalled()
    })

    it('[EDGE] E2E-B3 验证：remainingTTL = 0 时 redis.set 不被调用（符合 if(remainingTTL > 0) 条件）', async () => {
      // 设计文档中 E2E-B3 担心「SET EX 0 导致黑名单写入失效」
      // 实际代码用 if (remainingTTL > 0) 保护，remainingTTL=0 直接跳过写入
      // → E2E-B3 不存在：代码已正确处理此边界
      const { service, jwtMock, redisMock } = buildService()
      const now = Math.floor(Date.now() / 1000)
      // exp = now 时 remainingTTL = 0，不满足 > 0 条件
      jwtMock.verifyAsync.mockResolvedValue({ jti: 'test-jti', exp: now })

      await service.blacklistAccessToken('just-expired.token')

      expect(redisMock.set).not.toHaveBeenCalled()
    })

    it('[BUG Real-B1] Token 缺少 exp 字段 → remainingTTL = 0 → redis.set 不被调用（永不过期 Token 无法加黑名单）', async () => {
      // 安全隐患分析：
      //   payload.exp 为 undefined 时
      //   remainingTTL = (undefined ?? now) - now = now - now = 0
      //   if (remainingTTL > 0) 条件不满足 → 不写 Redis
      // 结果：没有 exp 字段的 Token（永不过期）即使调用 logout 也不会被加入黑名单，
      //       随时可以继续访问受保护接口。
      // 修复建议：
      //   方案A：对缺少 exp 的 token 写入 this.accessTokenTTL 作为 TTL（保守保护）
      //   方案B：在 verifyAccessToken 层面拒绝缺少 exp 的 payload
      const { service, jwtMock, redisMock } = buildService()
      // 返回没有 exp 字段的 payload（模拟手工签发的无过期 Token）
      jwtMock.verifyAsync.mockResolvedValue({ jti: 'test-jti' /* no exp */ })

      await service.blacklistAccessToken('no-exp.token')

      // 当前（有 bug 的）行为：不写黑名单
      // 修复后此断言应反转为：expect(redisMock.set).toHaveBeenCalled()
      expect(redisMock.set).not.toHaveBeenCalled()
    })
  })

  // ── isAccessTokenBlacklisted ───────────────────────────────────────────────

  describe('isAccessTokenBlacklisted()', () => {
    it('[BIZ] redis 返回 "1" → true', async () => {
      const { service, redisMock } = buildService()
      redisMock.get.mockResolvedValue('1')

      const result = await service.isAccessTokenBlacklisted('some-jti')

      expect(redisMock.get).toHaveBeenCalledWith(REDIS_KEY.TOKEN_BLACKLIST('some-jti'))
      expect(result).toBe(true)
    })

    it('[BIZ] redis 返回 null（未在黑名单）→ false', async () => {
      const { service, redisMock } = buildService()
      redisMock.get.mockResolvedValue(null)

      const result = await service.isAccessTokenBlacklisted('some-jti')

      expect(result).toBe(false)
    })
  })
})
