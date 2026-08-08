import { UserRole } from '@prisma/client'

export interface TokenPayload {
  id: number
  account: string
  nickname: string
  role: UserRole
  /** 用户认证版本；旧版/缺失版本的 JWT 会被服务端拒绝。 */
  authVersion?: number
  /** JWT 唯一标识符，用于 Token 黑名单和 Refresh Token 绑定 */
  jti: string
  iat?: number
  exp?: number
}
