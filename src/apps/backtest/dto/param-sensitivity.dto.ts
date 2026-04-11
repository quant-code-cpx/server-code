import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Sub-DTO ───────────────────────────────────────────────────────────────────

export class ParamSweepRange {
  @ApiProperty({ description: '参数在 strategyConfig 中的 key（如 shortWindow）' })
  @IsString()
  paramKey: string

  @ApiPropertyOptional({ description: '参数显示名称（如 短均线窗口）' })
  @IsOptional()
  @IsString()
  label?: string

  @ApiProperty({ description: '扫描值列表（如 [5, 10, 15, 20]）', type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  values: number[]
}

// ── Request DTO ───────────────────────────────────────────────────────────────

export class ParamSensitivityDto {
  @ApiProperty({ description: '基准回测任务 ID（作为配置模板）' })
  @IsString()
  runId: string

  @ApiProperty({ description: '参数 X 轴扫描配置' })
  @ValidateNested()
  @Type(() => ParamSweepRange)
  paramX: ParamSweepRange

  @ApiProperty({ description: '参数 Y 轴扫描配置' })
  @ValidateNested()
  @Type(() => ParamSweepRange)
  paramY: ParamSweepRange

  @ApiPropertyOptional({
    description: '评价指标（默认 sharpeRatio）',
    enum: ['totalReturn', 'annualizedReturn', 'sharpeRatio', 'maxDrawdown', 'sortinoRatio'],
    default: 'sharpeRatio',
  })
  @IsOptional()
  @IsIn(['totalReturn', 'annualizedReturn', 'sharpeRatio', 'maxDrawdown', 'sortinoRatio'])
  metric?: 'totalReturn' | 'annualizedReturn' | 'sharpeRatio' | 'maxDrawdown' | 'sortinoRatio'
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class ParamSensitivityCreateResponseDto {
  @ApiProperty({ description: '扫描任务 ID' })
  sweepId: string

  @ApiProperty({ description: '总参数组合数（|X| × |Y|）' })
  totalCombinations: number

  @ApiProperty({ description: '任务状态' })
  status: string

  @ApiProperty({ description: '评价指标名称' })
  metric: string
}

export class ParamSensitivityResultDto {
  @ApiProperty({ description: '扫描任务 ID' })
  sweepId: string

  @ApiProperty({ description: '基准回测 ID' })
  baseRunId: string

  @ApiProperty({ description: '任务状态', enum: ['PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'] })
  status: string

  @ApiProperty({ description: '总组合数' })
  totalCombinations: number

  @ApiProperty({ description: '已完成数' })
  completedCount: number

  @ApiProperty({ description: '评价指标名称' })
  metric: string

  @ApiProperty({ description: 'X 轴参数信息' })
  paramX: { key: string; label: string; values: number[] }

  @ApiProperty({ description: 'Y 轴参数信息' })
  paramY: { key: string; label: string; values: number[] }

  @ApiProperty({
    description: '热力图矩阵 heatmap[xIdx][yIdx]，未完成位置为 null',
  })
  heatmap: (number | null)[][]

  @ApiPropertyOptional({ description: '最优参数组合' })
  best: { xValue: number; yValue: number; metricValue: number } | null
}
