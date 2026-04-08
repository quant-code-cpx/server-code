import { IsOptional, IsString, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class IndexDailyQueryDto {
  @ApiProperty({ description: '指数代码', example: '000001.SH' })
  @IsString()
  ts_code: string

  @ApiPropertyOptional({ description: '开始日期（YYYYMMDD）', example: '20260101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'start_date 格式应为 YYYYMMDD，例如 20240101' })
  start_date?: string

  @ApiPropertyOptional({ description: '结束日期（YYYYMMDD）', example: '20260401' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'end_date 格式应为 YYYYMMDD，例如 20240101' })
  end_date?: string

  @ApiPropertyOptional({ description: '单日查询（YYYYMMDD），优先于 start_date/end_date', example: '20260401' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string
}
