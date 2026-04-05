import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class HeatmapHistoryQueryDto {
  @ApiProperty({ description: '查询日期（YYYYMMDD）', example: '20260404' })
  @IsNotEmpty()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD' })
  trade_date: string

  @ApiPropertyOptional({
    description: '分组维度：industry / 指数代码（如 000300.SH）/ concept',
    examples: {
      industry: { value: 'industry' },
      index_hs300: { value: '000300.SH' },
    },
    default: 'industry',
  })
  @IsOptional()
  @IsString()
  @IsIn(['industry', 'concept', '000300.SH', '000905.SH', '000016.SH', '399006.SZ', '000852.SH'])
  group_by?: string = 'industry'
}
