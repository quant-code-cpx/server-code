import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { BACKTEST_STRATEGY_TYPES } from 'src/apps/backtest/types/backtest-engine.types'

export class CreateStrategyDto {
  @ApiProperty({ description: '策略名称', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @ApiPropertyOptional({ description: '策略描述', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiProperty({
    description: '策略类型',
    enum: BACKTEST_STRATEGY_TYPES,
  })
  @IsString()
  @IsIn(BACKTEST_STRATEGY_TYPES)
  strategyType: string

  @ApiProperty({ description: '策略参数（与回测 strategyConfig 同构）' })
  @IsObject()
  strategyConfig: Record<string, unknown>

  @ApiPropertyOptional({ description: '回测默认参数（发起回测时的预设值）' })
  @IsOptional()
  @IsObject()
  backtestDefaults?: Record<string, unknown>

  @ApiPropertyOptional({ description: '标签列表（最多 10 个，每个不超过 30 字）', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[]
}
