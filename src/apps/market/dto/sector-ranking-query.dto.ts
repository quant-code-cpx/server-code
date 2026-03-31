import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class SectorRankingQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({ description: '排序方式', enum: ['pct_change', 'net_amount'], default: 'pct_change' })
  @IsOptional()
  @IsEnum(['pct_change', 'net_amount'])
  sort_by?: 'pct_change' | 'net_amount' = 'pct_change'

  @ApiPropertyOptional({ description: 'Top N 返回数量，默认全量', minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
