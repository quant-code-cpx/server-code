import { IsEnum, IsOptional } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class HsgtTrendQueryDto {
  @ApiPropertyOptional({
    description: '时间周期，默认 3m',
    enum: ['1m', '3m', '6m', '1y'],
    default: '3m',
  })
  @IsOptional()
  @IsEnum(['1m', '3m', '6m', '1y'])
  period?: '1m' | '3m' | '6m' | '1y' = '3m'
}
