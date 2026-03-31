import { IsEnum, IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export type IndexTrendPeriod = '1m' | '3m' | '6m' | '1y' | '3y'

export class IndexTrendQueryDto {
  @ApiPropertyOptional({ description: '指数代码，默认上证指数', default: '000001.SH', example: '000001.SH' })
  @IsOptional()
  @IsString()
  ts_code?: string = '000001.SH'

  @ApiPropertyOptional({ description: '时间周期', enum: ['1m', '3m', '6m', '1y', '3y'], default: '3m' })
  @IsOptional()
  @IsEnum(['1m', '3m', '6m', '1y', '3y'])
  period?: IndexTrendPeriod = '3m'
}
