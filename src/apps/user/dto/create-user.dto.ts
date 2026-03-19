import { IsNotEmpty, IsString, MaxLength, IsEnum, IsOptional } from 'class-validator'
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
}

