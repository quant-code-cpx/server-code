import { ApiProperty } from '@nestjs/swagger'

export class AccessTokenResponseDto {
  @ApiProperty({
    description: '访问令牌（Bearer Token）',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsInVzZXJuYW1lIjoiYWRtaW4iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.abc123',
  })
  accessToken: string
}

export class EmptyResponseDto {
  @ApiProperty({ description: '空对象（无业务数据）', type: 'object', additionalProperties: false })
  readonly _?: never
}
