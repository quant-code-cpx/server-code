import { IsArray, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Request DTO ───────────────────────────────────────────────────────────────

export class CostSensitivityDto {
  @ApiProperty({ description: '回测任务 ID' })
  @IsString()
  runId: string

  @ApiPropertyOptional({
    description: '佣金率扫描列表（如 [0.0001, 0.0003, 0.001]，默认 5 档）',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  commissionRates?: number[]

  @ApiPropertyOptional({
    description: '滑点扫描列表（单位 bps，如 [0, 5, 10, 20]，默认 5 档）',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  slippageBpsList?: number[]
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class CostSensitivityPointDto {
  @ApiProperty({ description: '佣金率' })
  commissionRate: number

  @ApiProperty({ description: '滑点（bps）' })
  slippageBps: number

  @ApiProperty({ description: '总收益率（decimal）' })
  totalReturn: number

  @ApiProperty({ description: '年化收益率（decimal）' })
  annualizedReturn: number

  @ApiProperty({ description: '年化夏普比率' })
  sharpeRatio: number

  @ApiProperty({ description: '最大回撤（负数，decimal）' })
  maxDrawdown: number

  @ApiProperty({ description: '该参数组合下的总交易费用（绝对值，元）' })
  totalCost: number

  @ApiProperty({ description: '费用占初始资本比例' })
  costCapitalRatio: number
}

export class CostSensitivityResponseDto {
  @ApiProperty({ description: '回测任务 ID' })
  runId: string

  @ApiProperty({ description: '原始佣金率' })
  originalCommissionRate: number

  @ApiProperty({ description: '原始滑点（bps）' })
  originalSlippageBps: number

  @ApiProperty({ description: '原始总收益率（baseline）' })
  baselineTotalReturn: number

  @ApiProperty({ type: [CostSensitivityPointDto] })
  points: CostSensitivityPointDto[]
}
