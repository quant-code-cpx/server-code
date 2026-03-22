import { Inject, Injectable, Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import * as svgCaptcha from 'svg-captcha'
import { nanoid } from 'nanoid'
import * as bcrypt from 'bcrypt'
import { UserStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  CAPTCHA_TTL,
  LOGIN_FAIL_WINDOW,
  LOGIN_LOCK_DURATION,
  LOGIN_MAX_FAIL,
  REDIS_KEY,
} from 'src/constant/auth.constant'
import { LoginDto } from './dto/login.dto'
import { CaptchaResponseDto } from './dto/captcha-response.dto'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  // ── 验证码 ──────────────────────────────────────────────────────────────

  /** 生成图片验证码，结果存入 Redis（TTL 60s），返回 captchaId 与 SVG 图片 */
  async generateCaptcha(): Promise<CaptchaResponseDto> {
    const captcha = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1iIlL',
      noise: 3,
      color: true,
      background: '#f0f0f0',
    })

    const captchaId = nanoid()
    await this.redis.set(REDIS_KEY.CAPTCHA(captchaId), captcha.text.toLowerCase(), { EX: CAPTCHA_TTL })

    return { captchaId, svgImage: captcha.data }
  }

  /** 验证验证码（不区分大小写），验证后立即从 Redis 删除（一次性） */
  private async validateCaptcha(captchaId: string, captchaCode: string): Promise<void> {
    const stored = await this.redis.getDel(REDIS_KEY.CAPTCHA(captchaId))
    if (!stored || stored !== captchaCode.toLowerCase()) {
      throw new BusinessException(ErrorEnum.INVALID_CAPTCHA)
    }
  }

  // ── 登录 ────────────────────────────────────────────────────────────────

  /**
   * 账号密码登录（含验证码校验 + 连续失败锁定）。
   * 登录成功后返回 accessToken 与 refreshToken，调用方需将 refreshToken 写入 HttpOnly Cookie。
   */
  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string; refreshTokenTTL: number }> {
    const { account, password, captchaId, captchaCode } = this.normalizeLoginPayload(dto)

    // 1. 验证码校验（先于密码，避免暴力破解绕过验证码）
    await this.validateCaptcha(captchaId, captchaCode)

    // 2. 检查账号是否被锁定
    const isLocked = await this.redis.exists(REDIS_KEY.LOGIN_LOCK(account))
    if (isLocked) {
      this.logger.warn(`账号 [${account}] 当前处于登录锁定状态，统一返回账号或密码错误`)
      throw new BusinessException(ErrorEnum.INVALID_USERNAME_PASSWORD)
    }

    // 3. 查询用户
    const user = await this.prisma.user.findUnique({ where: { account } })

    // 4. 校验密码（故意不区分「账号不存在」与「密码错误」，防止账号枚举攻击）
    const passwordValid = user ? await bcrypt.compare(password, user.password) : false
    if (!user || !passwordValid) {
      // 仅在账号存在时才记录失败次数，防止无效账号消耗 Redis 资源
      if (user) {
        await this.handleLoginFail(account)
      }
      throw new BusinessException(ErrorEnum.INVALID_USERNAME_PASSWORD)
    }

    // 5. 账号状态检查
    if (user.status !== UserStatus.ACTIVE) {
      throw new BusinessException(ErrorEnum.USER_DISABLED)
    }

    // 6. 登录成功：清除失败计数，更新最后登录时间，生成 Token
    await Promise.all([this.redis.del(REDIS_KEY.LOGIN_FAIL(account)), this.updateLastLoginAt(user.id)])

    return this.tokenService.generateTokens({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
      role: user.role,
    })
  }

  private normalizeLoginPayload(dto: LoginDto): {
    account: string
    password: string
    captchaId: string
    captchaCode: string
  } {
    const account = this.readLoginField(dto.account, { trim: true })
    const password = this.readLoginField(dto.password)
    const captchaId = this.readLoginField(dto.captchaId, { trim: true })
    const captchaCode = this.readLoginField(dto.captchaCode, { trim: true })

    if (!captchaId || !captchaCode) {
      throw new BusinessException(ErrorEnum.INVALID_CAPTCHA)
    }

    if (!account || !password) {
      throw new BusinessException(ErrorEnum.INVALID_USERNAME_PASSWORD)
    }

    return { account, password, captchaId, captchaCode }
  }

  /** 记录登录失败次数；达到上限则锁定账号 */
  private async handleLoginFail(account: string): Promise<void> {
    const failKey = REDIS_KEY.LOGIN_FAIL(account)
    const count = await this.redis.incr(failKey)
    if (count === 1) {
      // 首次失败时设置窗口过期
      await this.redis.expire(failKey, LOGIN_FAIL_WINDOW)
    }
    if (count >= LOGIN_MAX_FAIL) {
      await this.redis.set(REDIS_KEY.LOGIN_LOCK(account), '1', { EX: LOGIN_LOCK_DURATION })
      await this.redis.del(failKey)
      this.logger.warn(`账号 [${account}] 连续失败 ${LOGIN_MAX_FAIL} 次，已锁定 ${LOGIN_LOCK_DURATION / 60} 分钟`)
    }
  }

  // ── Refresh Token ────────────────────────────────────────────────────────

  /**
   * 使用 Refresh Token 换取新的 Access Token（Token 轮换：旧 Refresh 作废，签发新 Refresh）。
   * 调用方需将新 refreshToken 重新写入 HttpOnly Cookie。
   */
  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenTTL: number }> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken).catch(() => {
      throw new BusinessException(ErrorEnum.INVALID_REFRESH_TOKEN)
    })

    // 校验 Redis 中是否存在该 Refresh Token（防止重放攻击）
    const valid = await this.tokenService.isRefreshTokenValid(payload.id, payload.jti)
    if (!valid) {
      throw new BusinessException(ErrorEnum.INVALID_REFRESH_TOKEN)
    }

    // Token 轮换：撤销旧 Refresh Token
    await this.tokenService.revokeRefreshToken(payload.id, payload.jti)

    // 从数据库获取最新用户信息（角色可能已更新）
    const user = await this.prisma.user.findUnique({ where: { id: payload.id } })
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BusinessException(ErrorEnum.USER_DISABLED)
    }

    // 签发新的 Token 对
    return this.tokenService.generateTokens({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
      role: user.role,
    })
  }

  // ── 登出 ────────────────────────────────────────────────────────────────

  /**
   * 登出：将 Access Token 加入黑名单，并撤销 Refresh Token。
   * @param accessToken  Authorization 头中的原始 Bearer token
   * @param refreshToken 来自 HttpOnly Cookie 的 Refresh Token（可选）
   */
  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    // 将 Access Token 加入黑名单（剩余有效期内不可用）
    await this.tokenService.blacklistAccessToken(accessToken)

    // 撤销 Refresh Token（如存在）
    if (refreshToken) {
      const payload = await this.tokenService.verifyRefreshToken(refreshToken).catch((err) => {
        this.logger.warn(`登出时 Refresh Token 验证失败（已过期或无效），跳过撤销：${err?.message}`)
        return null
      })
      if (payload) {
        await this.tokenService.revokeRefreshToken(payload.id, payload.jti)
      }
    }
  }

  // ── 工具方法 ─────────────────────────────────────────────────────────────

  private async updateLastLoginAt(userId: number): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  }

  private readLoginField(value: unknown, options?: { trim?: boolean }): string | null {
    if (typeof value !== 'string') {
      return null
    }

    const normalized = options?.trim ? value.trim() : value
    if (!normalized || normalized.trim().length === 0) {
      return null
    }

    return normalized
  }
}
