import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsOptional,
  Matches,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator'
import { Type } from 'class-transformer'

export class MomentumRankingQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({ description: '动量评分方法', enum: ['weighted', 'simple'], default: 'weighted' })
  @IsOptional()
  @IsEnum(['weighted', 'simple'])
  method?: 'weighted' | 'simple'

  @ApiPropertyOptional({
    description: '加权系数 [短期, 中期, 长期]，仅 method=weighted 时生效，默认 [0.3, 0.4, 0.3]',
    example: [0.3, 0.4, 0.3],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsNumber({}, { each: true })
  @Min(0.01, { each: true })
  weights?: number[]

  @ApiPropertyOptional({ description: '返回 Top N，默认全部', example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc'
}
