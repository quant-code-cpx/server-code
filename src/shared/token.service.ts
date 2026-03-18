import { Injectable } from '@nestjs/common'
import { JwtService, JwtSignOptions } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { ITokenConfig, TOKEN_CONFIG_TOKEN } from 'src/config/token.config'

export interface TokenPayload {
  id: number
  account: string
  nickname: string
  iat?: number
  exp?: number
}

@Injectable()
export class TokenService {
  private readonly accessTokenOptions: JwtSignOptions
  private readonly refreshTokenOptions: JwtSignOptions

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const { accessTokenOptions, refreshTokenOptions } = this.configService.get<ITokenConfig>(TOKEN_CONFIG_TOKEN)
    // expiresIn 已是 number（秒），居向 JwtSignOptions 无需强转
    this.accessTokenOptions = accessTokenOptions
    this.refreshTokenOptions = refreshTokenOptions
  }

  async generateAccessToken(payload: TokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, this.accessTokenOptions)
  }

  async generateTokens(payload: TokenPayload): Promise<{ accessToken: string; refreshToken: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, this.accessTokenOptions),
      this.jwtService.signAsync(payload, this.refreshTokenOptions),
    ])
    return { accessToken, refreshToken }
  }

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.accessTokenOptions.secret,
    })
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    return this.jwtService.verifyAsync<TokenPayload>(token, {
      secret: this.refreshTokenOptions.secret,
    })
  }
}
