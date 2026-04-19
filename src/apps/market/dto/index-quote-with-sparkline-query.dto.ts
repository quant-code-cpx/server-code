import { IsEnum, IsOptional, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class IndexQuoteWithSparklineQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），不传取最新交易日', example: '20260418' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20260418' })
  trade_date?: string

  @ApiPropertyOptional({
    description: 'sparkline 时间跨度，默认 1m',
    enum: ['1m', '3m', '6m', '1y', '3y'],
    default: '1m',
  })
  @IsOptional()
  @IsEnum(['1m', '3m', '6m', '1y', '3y'])
  sparkline_period?: '1m' | '3m' | '6m' | '1y' | '3y' = '1m'
}
