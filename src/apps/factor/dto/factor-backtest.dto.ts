import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { FactorCondition } from './factor-screening.dto'

// ── Factor → Backtest submit ─────────────────────────────────────────────────

export class FactorBacktestSubmitDto {
  @ApiProperty({ type: [FactorCondition], description: '因子筛选条件（与 /factor/screening 一致）' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FactorCondition)
  conditions: FactorCondition[]

  @ApiPropertyOptional({ description: '股票池 indexCode（如 000300.SH）' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ description: '回测起始日 YYYYMMDD', example: '20250101' })
  @IsString()
  @Matches(/^\d{8}$/)
  startDate: string

  @ApiProperty({ description: '回测结束日 YYYYMMDD', example: '20260327' })
  @IsString()
  @Matches(/^\d{8}$/)
  endDate: string

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

  @ApiPropertyOptional({ description: '回测任务名称' })
  @IsOptional()
  @IsString()
  name?: string
}

// ── Factor attribution ───────────────────────────────────────────────────────

export class FactorAttributionDto {
  @ApiProperty({ description: '回测任务 ID' })
  @IsString()
  backtestId: string

  @ApiPropertyOptional({
    type: [String],
    description: '分析哪些因子的贡献（默认使用回测时的条件因子）',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  factorNames?: string[]
}
