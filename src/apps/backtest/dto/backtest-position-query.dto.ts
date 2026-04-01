import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Matches } from 'class-validator'

export class BacktestPositionQueryDto {
  @ApiPropertyOptional({ description: '交易日期 YYYYMMDD，不传则返回最新持仓' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate must be YYYYMMDD' })
  tradeDate?: string
}
