import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { Public } from 'src/common/decorators/public.decorator'
import { REFRESH_TOKEN_COOKIE } from 'src/constant/auth.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { ApiSuccessResponse, ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CaptchaResponseDto } from './dto/captcha-response.dto'
import { AccessTokenResponseDto } from './dto/auth-response.dto'

@ApiTags('Auth - 认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 获取图片验证码
   * 返回 captchaId（用于登录时提交）和 SVG 图片字符串。
   * 验证码有效期 60 秒，验证后即失效（一次性）。
   */
  @Public()
  @Post('captcha')
  @ApiOperation({ summary: '获取图片验证码' })
  @ApiSuccessResponse(CaptchaResponseDto)
  async captcha() {
    return this.authService.generateCaptcha()
  }

  /**
   * 用户登录
   * 推荐鉴权方案：双 Token + HttpOnly Cookie
   *   - Access Token（短效，30 分钟）：在响应体中返回，由客户端附加到 Authorization: Bearer 请求头
   *   - Refresh Token（长效）：写入 HttpOnly Secure Cookie，浏览器自动携带，防止 XSS 窃取
   *   - Refresh Token 同时写入 Redis 与 Token 绑定，支持主动登出和重放攻击检测
   *   - Access Token 黑名单机制（Redis）：登出后立即失效，无需等待 TTL 过期
   */
  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录（验证码 + 账号密码）' })
  @ApiSuccessResponse(AccessTokenResponseDto)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, refreshTokenTTL } = await this.authService.login(dto)
    this.setRefreshTokenCookie(res, refreshToken, refreshTokenTTL)
    return { accessToken }
  }

  /**
   * 刷新 Access Token
   * Refresh Token 优先从 HttpOnly Cookie 中读取；不存在时回退到请求体（兼容非浏览器客户端）。
   * 采用 Token 轮换策略：旧 Refresh Token 作废，同时签发新的 Refresh Token 写入 Cookie。
   * 标记为 @Public()：此端点本身用于在 Access Token 过期后换新 Token，不依赖 Access Token，
   * 安全性由内部的 HttpOnly Cookie → verifyRefreshToken → Redis 校验 → Token 轮换保障。
   */
  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新 AccessToken' })
  @ApiSuccessResponse(AccessTokenResponseDto)
  async refresh(
    @Req() req: Request,
    @Body('refreshToken') bodyRefreshToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = (req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? bodyRefreshToken
    if (!refreshToken) {
      throw new BusinessException(ErrorEnum.INVALID_REFRESH_TOKEN)
    }
    const result = await this.authService.refreshToken(refreshToken)
    this.setRefreshTokenCookie(res, result.refreshToken, result.refreshTokenTTL)
    return { accessToken: result.accessToken }
  }

  /**
   * 登出
   * - 将 Access Token 加入 Redis 黑名单（剩余有效期内不可用；已过期则静默跳过）
   * - 撤销 Refresh Token（从 Redis 删除，防止再次使用；无效 Token 静默跳过）
   * - 清除 Refresh Token Cookie
   * 标记为 @Public()：Access Token 可能已过期，服务端仍需完成 Cookie 清除和 Refresh Token 撤销。
   * blacklistAccessToken / logout 内部已通过 try/catch 容忍过期或无效 Token，无需有效 Access Token。
   */
  @Public()
  @Post('logout')
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: '登出' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async logout(
    @Headers('authorization') authorization: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = authorization?.replace(/^Bearer\s+/i, '') ?? ''
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined
    await this.authService.logout(accessToken, refreshToken)
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' })
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  private setRefreshTokenCookie(res: Response, token: string, ttlSeconds: number): void {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ttlSeconds * 1000,
      path: '/api/auth',
    })
  }
}
