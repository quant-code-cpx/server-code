import { Allow } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'admin', description: '登录账号' })
  @Allow()
  account: string

  @ApiProperty({ example: '123456', description: '密码' })
  @Allow()
  password: string

  @ApiProperty({ example: 'abc123', description: '验证码 ID（由 GET /auth/captcha 获取）' })
  @Allow()
  captchaId: string

  @ApiProperty({ example: 'A8K2', description: '验证码文本（不区分大小写）' })
  @Allow()
  captchaCode: string
}
