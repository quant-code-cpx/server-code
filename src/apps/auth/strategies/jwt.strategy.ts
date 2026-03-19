import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { ITokenConfig, TOKEN_CONFIG_TOKEN } from 'src/config/token.config'
import { TokenPayload } from 'src/shared/token.interface'
import { TokenService } from 'src/shared/token.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @Inject(TokenService) private readonly tokenService: TokenService,
  ) {
    const { accessTokenOptions } = configService.get<ITokenConfig>(TOKEN_CONFIG_TOKEN)
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessTokenOptions.secret,
    })
  }

  async validate(payload: TokenPayload): Promise<TokenPayload> {
    if (payload.jti && (await this.tokenService.isAccessTokenBlacklisted(payload.jti))) {
      throw new UnauthorizedException('Token 已失效，请重新登录')
    }
    return payload
  }
}
