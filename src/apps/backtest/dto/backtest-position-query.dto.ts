import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Matches } from 'class-validator'

export class BacktestPositionQueryDto {
  @ApiPropertyOptional({ description: '交易日期 YYYYMMDD，不传则返回最新持仓' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate?: string
}
