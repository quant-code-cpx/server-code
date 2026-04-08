import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { BacktestStrategyType, RebalanceFrequency, Universe } from '../types/backtest-engine.types'

export class ComparisonStrategyItemDto {
  @ApiPropertyOptional({ description: '策略标签，用于前端区分' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string

  @ApiProperty({ enum: ['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'] })
  @IsEnum(['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'])
  strategyType: BacktestStrategyType

  @ApiProperty()
  @IsObject()
  strategyConfig: Record<string, unknown>

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'], default: 'MONTHLY' })
  @IsOptional()
  @IsEnum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
  rebalanceFrequency?: RebalanceFrequency = 'MONTHLY'
}

export class CreateBacktestComparisonDto {
  @ApiPropertyOptional({ description: '对比组名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string

  @ApiProperty({ type: [ComparisonStrategyItemDto], description: '参与对比的策略列表（2~10 个）' })
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ComparisonStrategyItemDto)
  strategies: ComparisonStrategyItemDto[]

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiPropertyOptional({ default: '000300.SH' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string = '000300.SH'

  @ApiPropertyOptional({ enum: ['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'], default: 'ALL_A' })
  @IsOptional()
  @IsEnum(['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'])
  universe?: Universe = 'ALL_A'

  @ApiProperty()
  @IsNumber()
  @Min(1000)
  @Type(() => Number)
  initialCapital: number
}

export class CreateBacktestComparisonResponseDto {
  @ApiProperty() groupId: string
  @ApiProperty() jobId: string
  @ApiProperty() status: string
}

export class ComparisonMetricsRowDto {
  @ApiProperty() runId: string
  @ApiPropertyOptional({ nullable: true }) label: string | null
  @ApiProperty() strategyType: string
  @ApiPropertyOptional({ nullable: true }) totalReturn: number | null
  @ApiPropertyOptional({ nullable: true }) annualizedReturn: number | null
  @ApiPropertyOptional({ nullable: true }) benchmarkReturn: number | null
  @ApiPropertyOptional({ nullable: true }) excessReturn: number | null
  @ApiPropertyOptional({ nullable: true }) maxDrawdown: number | null
  @ApiPropertyOptional({ nullable: true }) sharpeRatio: number | null
  @ApiPropertyOptional({ nullable: true }) sortinoRatio: number | null
  @ApiPropertyOptional({ nullable: true }) calmarRatio: number | null
  @ApiPropertyOptional({ nullable: true }) volatility: number | null
  @ApiPropertyOptional({ nullable: true }) alpha: number | null
  @ApiPropertyOptional({ nullable: true }) beta: number | null
  @ApiPropertyOptional({ nullable: true }) informationRatio: number | null
  @ApiPropertyOptional({ nullable: true }) winRate: number | null
  @ApiPropertyOptional({ nullable: true }) turnoverRate: number | null
  @ApiPropertyOptional({ nullable: true }) tradeCount: number | null
}

export class BacktestComparisonGroupDetailDto {
  @ApiProperty() groupId: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() status: string
  @ApiProperty() startDate: string
  @ApiProperty() endDate: string
  @ApiProperty() benchmarkTsCode: string
  @ApiProperty({ type: [ComparisonMetricsRowDto] }) metrics: ComparisonMetricsRowDto[]
  @ApiProperty() createdAt: string
  @ApiPropertyOptional({ nullable: true }) completedAt: string | null
}

export class ComparisonEquitySeriesDto {
  @ApiProperty() runId: string
  @ApiPropertyOptional({ nullable: true }) label: string | null
  @ApiProperty({ type: [Object] }) points: Array<{ tradeDate: string; nav: number }>
}

export class BacktestComparisonEquityDto {
  @ApiProperty({ type: [ComparisonEquitySeriesDto] }) series: ComparisonEquitySeriesDto[]
}
