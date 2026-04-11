import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, Matches, IsArray, ArrayMaxSize, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class ReturnComparisonQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '收益率计算窗口（天数），默认返回 [5, 20, 60]，最多 5 个窗口',
    example: [5, 20, 60],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60, { each: true })
  @Type(() => Number)
  periods?: number[]

  @ApiPropertyOptional({ description: '排序依据的窗口天数，默认 20', example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  sort_period?: number

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc'
}
