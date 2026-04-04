import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class FlowAnalysisQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date?: string

  @ApiPropertyOptional({ description: '分析周期（天数），默认 5', minimum: 1, maximum: 60, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number = 5

  @ApiPropertyOptional({
    description: '排序维度',
    enum: ['cumulative_net', 'avg_daily_net', 'flow_momentum'],
    default: 'cumulative_net',
  })
  @IsOptional()
  @IsEnum(['cumulative_net', 'avg_daily_net', 'flow_momentum'])
  sort_by?: 'cumulative_net' | 'avg_daily_net' | 'flow_momentum' = 'cumulative_net'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ description: 'Top N，默认全部', minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
