import { IsBoolean, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'

export type MainFlowSortBy = 'main_net_inflow' | 'elg_net_inflow' | 'lg_net_inflow' | 'pct_chg'

export class MainFlowRankingQueryDto {
  @ApiPropertyOptional({ description: '查询日期（YYYYMMDD），默认最新交易日', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string

  @ApiPropertyOptional({
    description: '排序维度',
    enum: ['main_net_inflow', 'elg_net_inflow', 'lg_net_inflow', 'pct_chg'],
    default: 'main_net_inflow',
  })
  @IsOptional()
  @IsEnum(['main_net_inflow', 'elg_net_inflow', 'lg_net_inflow', 'pct_chg'])
  sort_by?: MainFlowSortBy = 'main_net_inflow'

  @ApiPropertyOptional({
    description: '排序方向（dual=false 时生效）：desc=净流入最多，asc=净流出最多',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({
    description: 'true 时单次返回 topInflow（降序）+ topOutflow（升序）双榜',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dual?: boolean = false

  @ApiPropertyOptional({ description: 'Top N，默认 20', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
