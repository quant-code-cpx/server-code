import { Inject, Injectable } from '@nestjs/common'
import { JwtService, JwtSignOptions } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { RedisClientType } from 'redis'
import { nanoid } from 'nanoid'
import { ITokenConfig, TOKEN_CONFIG_TOKEN } from 'src/config/token.config'
import { REDIS_CLIENT } from './redis.provider'
import { REDIS_KEY, REFRESH_TOKEN_GRACE } from 'src/constant/auth.constant'
import { TokenPayload } from './token.interface'

const CONSUME_REFRESH_TOKEN_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value == '1' then
  redis.call('SET', KEYS[1], 'used', 'EX', ARGV[1])
  return 'valid'
end
if value == 'used' then
  return 'grace'
end
return 'invalid'
`

/**
 * TokenService — JWT Token 的生命周期管理。
 *
 * 责责以下职责：
 *   1. 签发 Access Token / Refresh Token（二者共享同一 jti，支持一锟消双剥）
 *   2. 将 Refresh Token jti 写入 Redis，实现服务端主动吹销
 *   3. Access Token 自成为一体，过期则失效；登出时可将其 jti 列入 Redis 黑名单
 *   4. Refresh Token 轮换：每次刷新时撤销旧 Token、签发新 Token，防止重放攻击
 *
 * Token 过期时间由 token.config.ts 配置注入：
 *   - ACCESS_TOKEN_EXPIRE   (s)，默认 1800s（30 分钟）
 *   - REFRESH_TOKEN_EXPIRE  (s)，默认 43200s（12 小时）
 */
@Injectable()
export class TokenService {
  private readonly accessTokenOptions: JwtSignOptions
  private readonly refreshTokenOptions: JwtSignOptions
  private readonly accessTokenTTL: number
  private readonly refreshTokenTTL: number

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {
    const { accessTokenOptions, refreshTokenOptions } = this.configService.get<ITokenConfig>(TOKEN_CONFIG_TOKEN)
    this.accessTokenOptions = accessTokenOptions
    this.refreshTokenOptions = refreshTokenOptions
    this.accessTokenTTL = accessTokenOptions.expiresIn as number
    this.refreshTokenTTL = refreshTokenOptions.expiresIn as number
  }

  /**
   * 仅签发 Access Token（不写 Redis，通常不对外暴露）。
   * 适用于内部剛新推送下签发新 Token 的场景。
   */
  async generateAccessToken(payload: Omit<TokenPayload, 'jti'>): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload, authVersion: this.normalizeAuthVersion(payload.authVersion), jti: nanoid() },
      this.accessTokenOptions,
    )
  }

  /**
   * 生成 Access Token + Refresh Token（共享同一 jti），并将 Refresh Token 写入 Redis。
   * @returns accessToken（在响应体中返回）、refreshToken（写入 HttpOnly Cookie）
   */
  async generateTokens(
    payload: Omit<TokenPayload, 'jti'>,
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenTTL: number }> {
    const jti = nanoid()
    const tokenPayload: TokenPayload = {
      ...payload,
      authVersion: this.normalizeAuthVersion(payload.authVersion),
      jti,
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(tokenPayload, this.accessTokenOptions),
      this.jwtService.signAsync(tokenPayload, this.refreshTokenOptions),
    ])

    // 将 Refresh Token jti 写入 Redis，绑定到用户
    await this.redis.set(REDIS_KEY.REFRESH_TOKEN(payload.id, jti), '1', { EX: this.refreshTokenTTL })

    return { accessToken, refreshToken, refreshTokenTTL: this.refreshTokenTTL }
  }

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.accessTokenOptions.secret as string,
    })
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.refreshTokenOptions.secret as string,
    })
  }

  /**
   * 原子消费 Refresh Token：首次请求把状态从 1 改为 used；并发重复请求进入宽限路径。
   * 检查与写入必须在同一段 Lua 中完成，避免两个标签同时看见 valid 并各自轮换一份新 Token。
   */
  async consumeRefreshToken(userId: number, jti: string): Promise<'valid' | 'grace' | 'invalid'> {
    const result = await this.redis.eval(CONSUME_REFRESH_TOKEN_SCRIPT, {
      keys: [REDIS_KEY.REFRESH_TOKEN(userId, jti)],
      arguments: [String(REFRESH_TOKEN_GRACE)],
    })

    if (result === 'valid' || result === 'grace') return result
    return 'invalid'
  }

  /** 立即删除 Refresh Token（用于登出，确保无法再次使用） */
  async deleteRefreshToken(userId: number, jti: string): Promise<void> {
    await this.redis.del(REDIS_KEY.REFRESH_TOKEN(userId, jti))
  }

  /**
   * 将 Access Token 加入黑名单。
   * @param token 原始 Access Token 字符串
   */
  async blacklistAccessToken(token: string): Promise<void> {
    try {
      const payload = await this.verifyAccessToken(token)
      const now = Math.floor(Date.now() / 1000)
      // 若 payload 缺少 exp（理论上不应发生，但防御性兜底），使用 accessTokenTTL 作为黑名单存活时间
      const remainingTTL = payload.exp != null ? payload.exp - now : this.accessTokenTTL
      if (remainingTTL > 0) {
        await this.redis.set(REDIS_KEY.TOKEN_BLACKLIST(payload.jti), '1', { EX: remainingTTL })
      }
    } catch {
      // Token 已过期则无需加入黑名单
    }
  }

  /** 检查 Access Token jti 是否已被列入黑名单 */
  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    const val = await this.redis.get(REDIS_KEY.TOKEN_BLACKLIST(jti))
    return val === '1'
  }

  private normalizeAuthVersion(value: number | undefined): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  }
}
