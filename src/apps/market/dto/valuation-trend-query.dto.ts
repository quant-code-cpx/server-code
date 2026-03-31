import { IsEnum, IsOptional } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export type ValuationTrendPeriod = '3m' | '6m' | '1y' | '3y' | '5y'

export class ValuationTrendQueryDto {
  @ApiPropertyOptional({
    description: '时间周期，默认 1y',
    enum: ['3m', '6m', '1y', '3y', '5y'],
    default: '1y',
  })
  @IsOptional()
  @IsEnum(['3m', '6m', '1y', '3y', '5y'])
  period?: ValuationTrendPeriod = '1y'
}
