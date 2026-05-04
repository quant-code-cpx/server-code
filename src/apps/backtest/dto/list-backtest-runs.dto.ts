import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type, Transform } from 'class-transformer'
import { BacktestStatus, BacktestStrategyType } from '../types/backtest-engine.types'

export class ListBacktestRunsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20

  @ApiPropertyOptional({
    enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    description: '单状态过滤（兼容旧版）',
  })
  @IsOptional()
  @IsEnum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: BacktestStatus

  @ApiPropertyOptional({
    type: [String],
    enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    description: '多状态过滤',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'], { each: true })
  statuses?: BacktestStatus[]

  @ApiPropertyOptional({ enum: ['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'] })
  @IsOptional()
  @IsEnum(['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'])
  strategyType?: BacktestStrategyType

  @ApiPropertyOptional({ description: '按名称模糊搜索', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  keyword?: string

  @ApiPropertyOptional({ description: '仅显示已标星', type: Boolean })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  starred?: boolean

  @ApiPropertyOptional({ description: '是否显示已归档（false=不含归档，true=仅归档，不传=全部）', type: Boolean })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  archived?: boolean

  @ApiPropertyOptional({ description: '创建时间起（ISO 8601）', example: '2026-01-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  createdStart?: string

  @ApiPropertyOptional({ description: '创建时间止（ISO 8601）', example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  createdEnd?: string

  @ApiPropertyOptional({ description: '按策略 ID 过滤（仅返回从该策略发起的回测）' })
  @IsOptional()
  @IsString()
  strategyId?: string
}
