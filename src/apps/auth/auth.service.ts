import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { LoginDto } from './dto/login.dto'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: LoginDto) {
    const { account, password } = dto

    const user = await this.prisma.user.findUnique({ where: { account } })
    // 故意不区分「用户不存在」和「密码错误」，防止账号枚举攻击
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new BusinessException(ErrorEnum.INVALID_USERNAME_PASSWORD)
    }

    if (user.status !== 'ACTIVE') throw new BusinessException(ErrorEnum.USER_DISABLED)

    const tokens = await this.tokenService.generateTokens({
      id: user.id,
      account: user.account,
      nickname: user.nickname,
    })

    return tokens
  }

  async refreshToken(token: string) {
    try {
      const payload = await this.tokenService.verifyRefreshToken(token)
      const accessToken = await this.tokenService.generateAccessToken({
        id: payload.id,
        account: payload.account,
        nickname: payload.nickname,
      })
      return { accessToken }
    } catch (err) {
      this.logger.warn(`refreshToken failed: ${err?.message}`)
      throw new UnauthorizedException('刷新令牌已过期，请重新登录')
    }
  }
}
