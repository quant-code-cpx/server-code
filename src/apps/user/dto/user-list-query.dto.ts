import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { UserRole, UserStatus } from '@prisma/client'
import { Type } from 'class-transformer'

export class UserListQueryDto {
  @ApiPropertyOptional({ description: '页码，从1开始', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
}
