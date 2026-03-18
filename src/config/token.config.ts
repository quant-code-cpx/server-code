import { ConfigType, registerAs } from '@nestjs/config'

export const TOKEN_CONFIG_TOKEN = 'token'

export const TokenConfig = registerAs(TOKEN_CONFIG_TOKEN, () => {
  const { REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRE, ACCESS_TOKEN_SECRET, ACCESS_TOKEN_EXPIRE } = process.env
  return {
    refreshTokenOptions: {
      secret: REFRESH_TOKEN_SECRET || 'refresh_secret',
      // 使用数字（秒）以居向兴 JwtSignOptions 类型（number | StringValue）
      expiresIn: parseInt(REFRESH_TOKEN_EXPIRE, 10) || 43200,
    },
    accessTokenOptions: {
      secret: ACCESS_TOKEN_SECRET || 'access_secret',
      expiresIn: parseInt(ACCESS_TOKEN_EXPIRE, 10) || 1800,
    },
  }
})

export type ITokenConfig = ConfigType<typeof TokenConfig>
