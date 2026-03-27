import { IsNotEmpty, IsString, MaxLength, IsEnum, IsOptional, MinLength, IsInt, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { UserRole } from '@prisma/client'

export class CreateUserDto {
  @ApiProperty({ example: 'zhangsan', description: '登录账号' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  account: string

  @ApiProperty({ example: '张三', description: '昵称' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  nickname: string

  @ApiPropertyOptional({ enum: UserRole, description: '用户角色（默认 USER）' })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole

  @ApiProperty({ example: 'Abc12345', description: '初始密码（至少8位）' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string

  @ApiPropertyOptional({ example: 5, description: '回测任务数量限制（-1 为不限）' })
  @IsInt()
  @Min(-1)
  @IsOptional()
  backtestQuota?: number

  @ApiPropertyOptional({ example: 20, description: '监控股票数量限制（-1 为不限）' })
  @IsInt()
  @Min(-1)
  @IsOptional()
  watchlistLimit?: number
}
