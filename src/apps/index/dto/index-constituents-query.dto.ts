import { IsOptional, IsString, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class IndexConstituentsQueryDto {
  @ApiProperty({ description: '指数代码', example: '000300.SH' })
  @IsString()
  index_code: string

  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认取最新', example: '20260401' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string
}
