import { UserRole } from '@prisma/client'

/** 用户角色等级映射（数字越大权限越高） */
export const ROLE_LEVEL: Record<UserRole, number> = {
  [UserRole.USER]: 1,
  [UserRole.ADMIN]: 2,
  [UserRole.SUPER_ADMIN]: 3,
}

/** 管理员以上不受监控股票数量限制的占位值 */
export const ADMIN_WATCHLIST_UNLIMITED = -1

/** 超级管理员初始化环境变量 Key */
export const SUPER_ADMIN_ENV = {
  ACCOUNT: 'SUPER_ADMIN_ACCOUNT',
  PASSWORD: 'SUPER_ADMIN_PASSWORD',
  NICKNAME: 'SUPER_ADMIN_NICKNAME',
} as const

/** 随机初始密码长度 */
export const RANDOM_PASSWORD_LENGTH = 8
