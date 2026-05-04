import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class GetPreferencesDto {
  @ApiPropertyOptional({ description: '偏好 key；不传则返回全部偏好对象', example: 'stockListColumns' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string
}

export class UpdatePreferenceDto {
  @ApiProperty({ description: '偏好 key，如 stockListColumns', example: 'stockListColumns' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key: string

  @ApiProperty({
    description: '偏好值（任意 JSON 可序列化数据）',
    example: ['tsCode', 'name', 'peTtm', 'totalMv'],
  })
  value: unknown
}
