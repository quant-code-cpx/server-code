import { IsInt, IsOptional, IsString, MaxLength, Min, IsEmail } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class AdminUpdateUserDto {
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
