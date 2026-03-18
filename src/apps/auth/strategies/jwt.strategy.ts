import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { ITokenConfig, TOKEN_CONFIG_TOKEN } from 'src/config/token.config'
import { TokenPayload } from 'src/shared/token.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    const { accessTokenOptions } = configService.get<ITokenConfig>(TOKEN_CONFIG_TOKEN)
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessTokenOptions.secret,
    })
  }

  async validate(payload: TokenPayload): Promise<TokenPayload> {
    return payload
  }
}
