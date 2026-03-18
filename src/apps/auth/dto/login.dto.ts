import { IsNotEmpty, IsString, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'admin', description: '登录账号' })
  @IsString()
  @IsNotEmpty()
  account: string

  @ApiProperty({ example: '123456', description: '密码' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string
}
