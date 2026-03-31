import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class SectorFlowRankingQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '板块类型，默认 INDUSTRY',
    enum: ['INDUSTRY', 'CONCEPT', 'REGION'],
    default: 'INDUSTRY',
  })
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION' = 'INDUSTRY'

  @ApiPropertyOptional({
    description: '排序维度，默认 net_amount',
    enum: ['net_amount', 'pct_change', 'buy_elg_amount'],
    default: 'net_amount',
  })
  @IsOptional()
  @IsEnum(['net_amount', 'pct_change', 'buy_elg_amount'])
  sort_by?: 'net_amount' | 'pct_change' | 'buy_elg_amount' = 'net_amount'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ description: 'Top N，默认 20', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
