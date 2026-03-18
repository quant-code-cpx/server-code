import { IsIn, IsOptional, IsString, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class HeatmapQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认为最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({ description: '分组维度：industry（行业）/ concept（概念板块）', default: 'industry' })
  @IsOptional()
  @IsString()
  @IsIn(['industry', 'concept'])
  group_by?: string = 'industry'
}
