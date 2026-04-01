import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { UserRole, UserStatus } from '@prisma/client'
import { Type } from 'class-transformer'

export const USER_SORT_FIELDS = ['createdAt', 'updatedAt', 'lastLoginAt', 'account'] as const
export type UserSortField = (typeof USER_SORT_FIELDS)[number]

export class UserListQueryDto {
  @ApiPropertyOptional({ description: '页码，从1开始', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  page: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 20

  @ApiPropertyOptional({ description: '账号模糊搜索' })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  account?: string

  @ApiPropertyOptional({ enum: UserStatus, description: '用户状态筛选' })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus

  @ApiPropertyOptional({ enum: UserRole, description: '用户角色筛选' })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    description: '排序字段（默认 createdAt）',
    example: 'createdAt',
  })
  @IsIn(USER_SORT_FIELDS)
  @IsOptional()
  sortBy?: UserSortField

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '排序方向（默认 desc）', example: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc'
}
