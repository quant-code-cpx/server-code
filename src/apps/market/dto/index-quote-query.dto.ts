import { IsArray, IsOptional, IsString, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class IndexQuoteQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认为最新交易日', example: '20260407' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20260407' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '指定查询的指数代码列表；为空时返回全部已同步的指数',
    example: ['000300.SH', '000016.SH', '399001.SZ'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ts_codes?: string[]
}
