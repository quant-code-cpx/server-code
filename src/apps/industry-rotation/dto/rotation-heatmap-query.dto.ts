import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class RotationHeatmapQueryDto {
  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '时间窗口列表（天数），默认 [1, 5, 10, 20, 60]',
    type: [Number],
    default: [1, 5, 10, 20, 60],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60, { each: true })
  @Type(() => Number)
  periods?: number[] = [1, 5, 10, 20, 60]
}
