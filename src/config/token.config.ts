import { ConfigType, registerAs } from '@nestjs/config'

export const TOKEN_CONFIG_TOKEN = 'token'

/** JWT Secret 最小长度（字符数） */
const JWT_SECRET_MIN_LENGTH = 32

function requireJwtSecret(envKey: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[Security] 缺少必要环境变量 ${envKey}，应用无法启动。` +
        `请在 .env 中配置，建议使用 openssl rand -base64 48 生成随机值。`,
    )
  }
  if (value.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `[Security] ${envKey} 长度不足（当前 ${value.length} 字符，最小 ${JWT_SECRET_MIN_LENGTH} 字符）。` +
        `请使用 openssl rand -base64 48 重新生成。`,
    )
  }
  return value
}

export const TokenConfig = registerAs(TOKEN_CONFIG_TOKEN, () => {
  const { REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRE, ACCESS_TOKEN_SECRET, ACCESS_TOKEN_EXPIRE } = process.env
  return {
    refreshTokenOptions: {
      secret: requireJwtSecret('REFRESH_TOKEN_SECRET', REFRESH_TOKEN_SECRET),
      // 使用数字（秒）以匹配 JwtSignOptions 类型（number | StringValue）
      expiresIn: parseInt(REFRESH_TOKEN_EXPIRE, 10) || 43200,
    },
    accessTokenOptions: {
      secret: requireJwtSecret('ACCESS_TOKEN_SECRET', ACCESS_TOKEN_SECRET),
      expiresIn: parseInt(ACCESS_TOKEN_EXPIRE, 10) || 1800,
    },
  }
})

export type ITokenConfig = ConfigType<typeof TokenConfig>
