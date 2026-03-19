import { IsString, IsOptional, MaxLength, IsEmail } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: '李四', description: '昵称' })
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
}
