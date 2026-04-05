import { IsIn, IsOptional, IsString, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class HeatmapQueryDto {
  @ApiPropertyOptional({
    description: '查询日期（YYYYMMDD），默认为最新交易日',
    example: '20260404',
  })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20260404' })
  trade_date?: string

  /**
   * 分组维度：
   * - industry：按 stock_basic_profiles.industry 分组（全市场，约 5000 只股票）
   * - index：按指数成分股分组，需配合 index_code 参数使用
   * - concept：按概念板块分组（Phase 4 实现，目前退化为板块聚合）
   */
  @ApiPropertyOptional({
    description: '分组维度：industry（行业）/ index（指数成分）/ concept（概念板块，Phase 4）',
    enum: ['industry', 'index', 'concept'],
    default: 'industry',
  })
  @IsOptional()
  @IsString()
  @IsIn(['industry', 'index', 'concept'])
  group_by?: 'industry' | 'index' | 'concept' = 'industry'

  /**
   * 指数代码，仅在 group_by='index' 时有效。
   * 留空时默认返回沪深300（000300.SH）成分股。
   * 支持多个常见指数：000300.SH / 000905.SH / 000016.SH / 399006.SZ / 000852.SH
   */
  @ApiPropertyOptional({
    description: '指数代码（group_by=index 时有效），默认 000300.SH（沪深300）',
    example: '000300.SH',
  })
  @IsOptional()
  @IsString()
  index_code?: string = '000300.SH'
}
