import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class MoneyFlowTrendQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({ description: '历史天数，默认 20，最大 60', minimum: 5, maximum: 60, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
