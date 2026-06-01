import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'admin', description: '登录账号' })
  @IsString()
  @IsNotEmpty()
  account: string

  @ApiProperty({ example: '123456', description: '密码' })
  @IsString()
  @IsNotEmpty()
  password: string

  @ApiProperty({ example: 'abc123', description: '验证码 ID（由 GET /auth/captcha 获取）' })
  @IsString()
  @IsNotEmpty()
  captchaId: string

  @ApiProperty({ example: 'A8K2', description: '验证码文本（不区分大小写）' })
  @IsString()
  @IsNotEmpty()
  captchaCode: string
}
