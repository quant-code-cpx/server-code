import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateUserDto {
  @ApiProperty({ example: 'admin', description: '登录账号' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  account: string

  @ApiProperty({ example: '密码至少6位', description: '密码' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string

  @ApiProperty({ example: '张三', description: '昵称' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  nickname: string
}
