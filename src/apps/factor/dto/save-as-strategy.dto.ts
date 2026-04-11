import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { FactorCondition } from './factor-screening.dto'

// ── 请求 DTO ─────────────────────────────────────────────────────────────────

export class SaveAsStrategyDto {
  // ── 因子筛选条件（与 submitBacktest 一致）──────────────────────────────

  @ApiProperty({ type: [FactorCondition], description: '因子筛选条件（与 /factor/screening 一致）' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FactorCondition)
  conditions: FactorCondition[]

  @ApiPropertyOptional({ description: '股票池 indexCode（如 000300.SH）' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiPropertyOptional({
    description: '权重方式',
    enum: ['equal_weight', 'factor_weight'],
    default: 'equal_weight',
  })
  @IsOptional()
  @IsIn(['equal_weight', 'factor_weight'])
  weightMethod?: 'equal_weight' | 'factor_weight'

  @ApiPropertyOptional({ description: '排序因子（用于 topN 选取）' })
  @IsOptional()
  @IsString()
  sortBy?: string

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @ApiPropertyOptional({ description: '取前 N 只', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  topN?: number

  // ── 回测默认参数（存入 backtestDefaults）──────────────────────────────

  @ApiPropertyOptional({ description: '初始资金（默认 100 万）', default: 1000000 })
  @IsOptional()
  @IsNumber()
  @Min(10000)
  initialCapital?: number

  @ApiPropertyOptional({ description: '调仓周期（交易日，默认 5 = 周频）', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  rebalanceDays?: number

  @ApiPropertyOptional({ description: '手续费率（默认万三）', default: 0.0003 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.01)
  commissionRate?: number

  @ApiPropertyOptional({ description: '滑点 bps（默认 5）', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  slippageBps?: number

  @ApiPropertyOptional({ description: '基准指数（默认沪深300）', default: '000300.SH' })
  @IsOptional()
  @IsString()
  benchmarkCode?: string

  // ── 策略元数据 ────────────────────────────────────────────────────────

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

  @ApiPropertyOptional({ description: '标签列表（最多 10 个，每个不超过 30 字）', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[]
}

// ── 响应 DTO ─────────────────────────────────────────────────────────────────

export class SaveAsStrategyResponseDto {
  @ApiProperty({ description: '新建策略 ID' })
  strategyId: string

  @ApiProperty({ description: '策略名称' })
  name: string

  @ApiProperty({ description: '策略类型（固定为 FACTOR_SCREENING_ROTATION）' })
  strategyType: string

  @ApiProperty({ description: '策略参数（因子筛选配置）', type: () => Object })
  strategyConfig: Record<string, unknown>

  @ApiProperty({ description: '回测默认参数', type: () => Object })
  backtestDefaults: Record<string, unknown>

  @ApiProperty({ description: '创建时间' })
  createdAt: Date
}
