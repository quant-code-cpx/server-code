import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { BacktestStrategyType, PriceMode, RebalanceFrequency, Universe } from '../types/backtest-engine.types'

export class CreateBacktestRunDto {
  @ApiPropertyOptional({ description: '回测名称' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ description: '关联策略 ID（从策略模块发起回测时传入）' })
  @IsOptional()
  @IsString()
  strategyId?: string

  @ApiProperty({ enum: ['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'] })
  @IsEnum(['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'])
  strategyType: BacktestStrategyType

  @ApiProperty()
  @IsObject()
  strategyConfig: Record<string, unknown>

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  customUniverseTsCodes?: string[]

  @ApiProperty()
  @IsNumber()
  @Min(1000)
  @Type(() => Number)
  initialCapital: number

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'], default: 'MONTHLY' })
  @IsOptional()
  @IsEnum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
  rebalanceFrequency?: RebalanceFrequency = 'MONTHLY'

  @ApiPropertyOptional({ enum: ['NEXT_OPEN', 'NEXT_CLOSE'], default: 'NEXT_OPEN' })
  @IsOptional()
  @IsEnum(['NEXT_OPEN', 'NEXT_CLOSE'])
  priceMode?: PriceMode = 'NEXT_OPEN'

  @ApiPropertyOptional({ default: 0.0003 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  commissionRate?: number = 0.0003

  @ApiPropertyOptional({ default: 0.0005 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  stampDutyRate?: number = 0.0005

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minCommission?: number = 5

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  slippageBps?: number = 5

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  maxPositions?: number = 20

  @ApiPropertyOptional({ default: 0.1 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  @Type(() => Number)
  maxWeightPerStock?: number = 0.1

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minDaysListed?: number = 60

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enableTradeConstraints?: boolean = true

  @ApiPropertyOptional({ default: true, description: '是否启用 T+1 卖出限制' })
  @IsOptional()
  @IsBoolean()
  enableT1Restriction?: boolean = true

  @ApiPropertyOptional({ default: true, description: '资金不足时是否允许部分成交' })
  @IsOptional()
  @IsBoolean()
  partialFillEnabled?: boolean = true
}
