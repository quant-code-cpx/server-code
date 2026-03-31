import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class MainFlowRankingQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '排序方向：desc=主力净流入最多，asc=主力净流出最多',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ description: 'Top N，默认 20', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
