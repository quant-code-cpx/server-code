import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, Matches, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class FlowAnalysisQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({ description: '分析周期（天数），默认 5', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @Type(() => Number)
  days?: number

  @ApiPropertyOptional({
    description: '排序维度',
    enum: ['cumulative_net', 'avg_daily_net', 'flow_momentum'],
    default: 'cumulative_net',
  })
  @IsOptional()
  @IsEnum(['cumulative_net', 'avg_daily_net', 'flow_momentum'])
  sort_by?: 'cumulative_net' | 'avg_daily_net' | 'flow_momentum'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc'

  @ApiPropertyOptional({ description: 'Top N，默认全部', example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number
}
