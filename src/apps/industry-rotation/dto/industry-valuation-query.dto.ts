import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator'

export class IndustryValuationQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date?: string

  @ApiPropertyOptional({ description: '筛选特定行业（行业名称），不传则返回全部', example: '银行' })
  @IsOptional()
  @IsString()
  industry?: string

  @ApiPropertyOptional({
    description: '排序字段',
    enum: ['pe_ttm', 'pb', 'pe_percentile_1y', 'pb_percentile_1y'],
    default: 'pe_percentile_1y',
  })
  @IsOptional()
  @IsEnum(['pe_ttm', 'pb', 'pe_percentile_1y', 'pb_percentile_1y'])
  sort_by?: 'pe_ttm' | 'pb' | 'pe_percentile_1y' | 'pb_percentile_1y' = 'pe_percentile_1y'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc'
}
