import { IsString, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Request ───────────────────────────────────────────────────────────────────

export class PortfolioPerformanceDto {
  @ApiProperty({ description: '组合 ID' })
  @IsString()
  portfolioId: string

  @ApiPropertyOptional({ description: '查询起始日期（YYYYMMDD，默认组合创建日）' })
  @IsOptional()
  @IsString()
  startDate?: string

  @ApiPropertyOptional({ description: '查询终止日期（YYYYMMDD，默认最近交易日）' })
  @IsOptional()
  @IsString()
  endDate?: string

  @ApiPropertyOptional({ description: '基准指数代码（默认 000300.SH）' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string
}

// ── Response ──────────────────────────────────────────────────────────────────

export class PerformanceDailyItemDto {
  @ApiProperty()
  date: string

  @ApiProperty()
  portfolioNav: number

  @ApiProperty()
  benchmarkNav: number

  @ApiProperty()
  dailyReturn: number

  @ApiProperty()
  benchmarkReturn: number

  @ApiProperty()
  excessReturn: number

  @ApiProperty()
  cumulativeExcess: number
}

export class PerformanceMetricsDto {
  @ApiProperty({ description: '组合期间总收益率' })
  totalReturn: number

  @ApiProperty({ description: '基准期间总收益率' })
  benchmarkTotalReturn: number

  @ApiProperty({ description: '累计超额收益' })
  cumulativeExcessReturn: number

  @ApiProperty({ description: '年化收益率' })
  annualizedReturn: number

  @ApiProperty({ description: '年化波动率' })
  annualizedVolatility: number

  @ApiProperty({ description: '跟踪误差（年化）' })
  trackingError: number

  @ApiProperty({ description: '信息比率' })
  informationRatio: number

  @ApiProperty({ description: '最大回撤' })
  maxDrawdown: number

  @ApiProperty({ description: 'Sharpe 比率（Rf=0）' })
  sharpeRatio: number
}

export class PortfolioPerformanceResponseDto {
  @ApiProperty()
  portfolioId: string

  @ApiProperty()
  benchmarkTsCode: string

  @ApiProperty()
  startDate: string

  @ApiProperty()
  endDate: string

  @ApiProperty()
  metrics: PerformanceMetricsDto

  @ApiProperty({ type: [PerformanceDailyItemDto] })
  dailySeries: PerformanceDailyItemDto[]
}
