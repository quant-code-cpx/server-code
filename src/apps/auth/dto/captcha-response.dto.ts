import { ApiProperty } from '@nestjs/swagger'

export class CaptchaResponseDto {
  @ApiProperty({ description: '验证码 ID，登录时需要携带' })
  captchaId: string

  @ApiProperty({ description: 'SVG 格式的验证码图片' })
  svgImage: string
}
