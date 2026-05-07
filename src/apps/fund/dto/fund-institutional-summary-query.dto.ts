import { IsOptional, IsInt, Min, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class FundInstitutionalSummaryQueryDto {
  @ApiPropertyOptional({ description: '股票代码，例如 600519.SH；缺省返回全部股票', example: '600519.SH' })
  @IsOptional()
  symbol?: string

  @ApiPropertyOptional({ description: '报告期（YYYYMMDD），缺省取最新报告期', example: '20231231' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'end_date 格式应为 YYYYMMDD，例如 20231231' })
  end_date?: string

  @ApiPropertyOptional({ description: '返回记录数上限；缺省返回全部', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number
}
