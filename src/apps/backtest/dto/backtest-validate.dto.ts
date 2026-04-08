import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { BacktestStrategyType, PriceMode, RebalanceFrequency, Universe } from '../types/backtest-engine.types'

export class ValidateBacktestRunDto {
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

  @ApiPropertyOptional({ enum: ['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'] })
  @IsOptional()
  @IsEnum(['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'])
  universe?: Universe = 'ALL_A'

  @ApiProperty()
  @IsNumber()
  @Min(1000)
  @Type(() => Number)
  initialCapital: number

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'] })
  @IsOptional()
  @IsEnum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
  rebalanceFrequency?: RebalanceFrequency = 'MONTHLY'

  @ApiPropertyOptional({ enum: ['NEXT_OPEN', 'NEXT_CLOSE'] })
  @IsOptional()
  @IsEnum(['NEXT_OPEN', 'NEXT_CLOSE'])
  priceMode?: PriceMode = 'NEXT_OPEN'

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enableTradeConstraints?: boolean = true
}
