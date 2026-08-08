import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { UserStatus } from '@prisma/client'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { ITokenConfig, TOKEN_CONFIG_TOKEN } from 'src/config/token.config'
import { TokenPayload } from 'src/shared/token.interface'
import { TokenService } from 'src/shared/token.service'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @Inject(TokenService) private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {
    const { accessTokenOptions } = configService.get<ITokenConfig>(TOKEN_CONFIG_TOKEN)
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessTokenOptions.secret,
    })
  }

  async validate(payload: TokenPayload): Promise<TokenPayload> {
    if (!Number.isSafeInteger(payload.authVersion) || payload.authVersion < 0) {
      throw new UnauthorizedException('Token 已失效，请重新登录')
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.id },
      select: { status: true, authVersion: true },
    })
    if (!user || user.status !== UserStatus.ACTIVE || user.authVersion !== payload.authVersion) {
      throw new UnauthorizedException('Token 已失效，请重新登录')
    }
    if (payload.jti && (await this.tokenService.isAccessTokenBlacklisted(payload.jti))) {
      throw new UnauthorizedException('Token 已失效，请重新登录')
    }
    return payload
  }
}
