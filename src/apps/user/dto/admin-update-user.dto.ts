import { IsInt, IsOptional, IsPositive, IsString, MaxLength, Min, IsEmail } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class AdminUpdateUserDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  @IsPositive()
  id: number

  @ApiPropertyOptional({ example: '张三', description: '昵称' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  nickname?: string

  @ApiPropertyOptional({ example: 'user@example.com', description: '邮箱' })
  @IsEmail()
  @IsOptional()
  @MaxLength(128)
  email?: string

  @ApiPropertyOptional({ example: 'wx_12345', description: '微信号' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  wechat?: string

  @ApiPropertyOptional({ example: 5, description: '回测任务数量限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  backtestQuota?: number

  @ApiPropertyOptional({ example: 20, description: '监控股票数量限制' })
  @IsInt()
  @Min(1)
  @IsOptional()
  watchlistLimit?: number
}
