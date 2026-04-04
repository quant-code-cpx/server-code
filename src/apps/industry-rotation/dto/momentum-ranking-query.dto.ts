import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class MomentumRankingQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date?: string

  @ApiPropertyOptional({ description: '动量评分方法', enum: ['weighted', 'simple'], default: 'weighted' })
  @IsOptional()
  @IsEnum(['weighted', 'simple'])
  method?: 'weighted' | 'simple' = 'weighted'

  @ApiPropertyOptional({
    description: '加权系数 [短期权重, 中期权重, 长期权重]，默认 [0.3, 0.4, 0.3]',
    type: [Number],
    default: [0.3, 0.4, 0.3],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsNumber({}, { each: true })
  @Min(0.01, { each: true })
  @Type(() => Number)
  weights?: number[] = [0.3, 0.4, 0.3]

  @ApiPropertyOptional({ description: '返回 Top N，默认全部', minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'
}
