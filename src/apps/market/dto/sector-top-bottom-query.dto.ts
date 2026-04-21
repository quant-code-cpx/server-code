import { Type } from 'class-transformer'
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class SectorTopBottomQueryDto {
  @ApiPropertyOptional({ description: '交易日期 YYYYMMDD，不传则取最新', example: '20260421' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  @ApiPropertyOptional({ description: '各榜返回条数，默认 5，最大 20', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  top_n?: number = 5
}
