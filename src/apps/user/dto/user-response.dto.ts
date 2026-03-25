import { UserRole, UserStatus } from '@prisma/client'
import { ApiProperty } from '@nestjs/swagger'

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
