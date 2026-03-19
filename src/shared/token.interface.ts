import { UserRole } from '@prisma/client'

export interface TokenPayload {
  id: number
  account: string
  nickname: string
  role: UserRole
  /** JWT 唯一标识符，用于 Token 黑名单和 Refresh Token 绑定 */
  jti: string
  iat?: number
  exp?: number
}
