import { UserRole, UserStatus } from '@prisma/client'
import { ApiProperty } from '@nestjs/swagger'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class UserSafeDto {
  @ApiProperty() id: number
  @ApiProperty() account: string
  @ApiProperty({ required: false, nullable: true }) nickname: string | null
  @ApiProperty({ enum: UserRole }) role: UserRole
  @ApiProperty({ enum: UserStatus }) status: UserStatus
  @ApiProperty({ required: false, nullable: true }) email: string | null
  @ApiProperty({ required: false, nullable: true }) wechat: string | null
  @ApiProperty({ required: false, nullable: true }) lastLoginAt: Date | null
  @ApiProperty() backtestQuota: number
  @ApiProperty() watchlistLimit: number
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class CreatedUserDto extends UserSafeDto {
  @ApiProperty({ description: '新建用户初始密码（仅本次返回）' })
  initialPassword: string
}

export class UserListDataDto {
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty({ type: [UserSafeDto] })
  items: UserSafeDto[]
}

export class ResetPasswordDataDto {
  @ApiProperty()
  newPassword: string
}

export class UserPreferencesDataDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '用户偏好键值对（如 stockListColumns 等）',
  })
  preferences: Record<string, unknown>
}

export class UserStatsDataDto {
  @ApiProperty({ description: '有效用户总数（不含已注销）' }) total: number
  @ApiProperty({ description: '今日新增用户数' }) todayNew: number
  @ApiProperty({ description: '近30天活跃用户数（最后登录时间在30天内）' }) active30d: number
  @ApiProperty({ description: '当前禁用用户数' }) deactivated: number
}

export class UserSearchItemDto {
  @ApiProperty() id: number
  @ApiProperty() account: string
  @ApiPropertyOptional({ nullable: true }) nickname: string | null
  @ApiProperty({ enum: UserRole }) role: UserRole
}

export class UserSearchDataDto {
  @ApiProperty({ type: [UserSearchItemDto] })
  items: UserSearchItemDto[]
}
