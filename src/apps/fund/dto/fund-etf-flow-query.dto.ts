import { IsOptional, IsInt, Min, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class FundEtfFlowQueryDto {
  @ApiPropertyOptional({ description: 'ETF 基金代码，例如 510300.SH；缺省返回全部 ETF', example: '510300.SH' })
  @IsOptional()
  ts_code?: string

  @ApiPropertyOptional({ description: '查询天数，缺省 7 天', example: 7, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number

  @ApiPropertyOptional({ description: '起始日期（YYYYMMDD），与 days 二选一；优先使用此字段', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'start_date 格式应为 YYYYMMDD，例如 20240101' })
  start_date?: string
}
