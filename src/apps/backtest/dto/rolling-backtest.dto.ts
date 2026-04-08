import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { BacktestStrategyType, RebalanceFrequency, Universe } from '../types/backtest-engine.types'
import { ParamSearchSpaceItemDto } from './walk-forward.dto'

export class CreateRollingBacktestDto {
  @ApiPropertyOptional({ description: '滚动回测名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string

  @ApiProperty({ enum: ['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'] })
  @IsEnum(['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'])
  strategyType: BacktestStrategyType

  @ApiProperty({ description: '策略基础配置（滚动参数以外的固定参数）' })
  @IsObject()
  strategyConfig: Record<string, unknown>

  @ApiProperty({ description: '滚动优化的参数搜索空间' })
  @IsObject()
  rollingParamSpace: Record<string, ParamSearchSpaceItemDto>

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiProperty({ description: '回望窗口天数（最少 60 天）' })
  @IsNumber()
  @Min(60)
  @Type(() => Number)
  lookbackDays: number

  @ApiProperty({ description: '持有期天数（最少 20 天）' })
  @IsNumber()
  @Min(20)
  @Type(() => Number)
  holdingPeriodDays: number

  @ApiPropertyOptional({ default: 'sharpeRatio' })
  @IsOptional()
  @IsString()
  optimizeMetric?: string = 'sharpeRatio'

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

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'], default: 'MONTHLY' })
  @IsOptional()
  @IsEnum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
  rebalanceFrequency?: RebalanceFrequency = 'MONTHLY'
}
