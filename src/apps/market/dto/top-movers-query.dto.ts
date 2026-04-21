import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class TopMoversQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认为最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiProperty({
    description: '排序维度：gain=涨幅最大 | loss=跌幅最大 | amplitude=振幅最大 | amount=成交额最大',
    enum: ['gain', 'loss', 'amplitude', 'amount'],
  })
  @IsEnum(['gain', 'loss', 'amplitude', 'amount'])
  dim: 'gain' | 'loss' | 'amplitude' | 'amount'

  @ApiPropertyOptional({ description: '返回条数，默认 20，最多 100', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
