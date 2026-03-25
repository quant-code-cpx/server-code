import { ApiProperty } from '@nestjs/swagger'

export class AccessTokenResponseDto {
  @ApiProperty({ description: '访问令牌（Bearer Token）' })
  accessToken: string
}

export class EmptyResponseDto {
  @ApiProperty({ description: '空对象（无业务数据）', type: 'object', additionalProperties: false })
  readonly _?: never
}
