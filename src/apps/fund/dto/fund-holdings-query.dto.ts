import { IsOptional, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class FundHoldingsQueryDto {
  @ApiPropertyOptional({ description: '基金代码，例如 510300.SH；缺省返回所有基金', example: '510300.SH' })
  @IsOptional()
  ts_code?: string

  @ApiPropertyOptional({ description: '报告期（YYYYMMDD），缺省取最新报告期', example: '20231231' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'end_date 格式应为 YYYYMMDD，例如 20231231' })
  end_date?: string
}
