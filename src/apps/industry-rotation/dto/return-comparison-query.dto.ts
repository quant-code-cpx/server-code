import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class ReturnComparisonQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date?: string

  @ApiPropertyOptional({ description: '收益率计算窗口（天数），默认 [5, 20, 60]', type: [Number], default: [5, 20, 60] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60, { each: true })
  @Type(() => Number)
  periods?: number[] = [5, 20, 60]

  @ApiPropertyOptional({ description: '排序依据的窗口天数，默认 20', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_period?: number = 20

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'
}
