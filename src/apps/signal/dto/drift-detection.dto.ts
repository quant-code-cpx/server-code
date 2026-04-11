import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Request ───────────────────────────────────────────────────────────────────

export class DriftDetectionDto {
  @ApiProperty({ description: '组合 ID' })
  @IsString()
  portfolioId: string

  @ApiPropertyOptional({ description: '策略 ID（不传则从关联的 SignalActivation 获取）' })
  @IsOptional()
  @IsString()
  strategyId?: string

  @ApiPropertyOptional({ description: '告警阈值（默认 0.3，范围 0~1）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  alertThreshold?: number
}

// ── Response ──────────────────────────────────────────────────────────────────

export class DriftItemDto {
  @ApiProperty()
  tsCode: string

  @ApiProperty()
  stockName: string

  @ApiPropertyOptional()
  actualWeight: number | null

  @ApiPropertyOptional()
  targetWeight: number | null

  @ApiPropertyOptional()
  weightDiff: number | null

  @ApiProperty({ enum: ['MISSING_IN_PORTFOLIO', 'EXTRA_IN_PORTFOLIO', 'WEIGHT_DRIFT', 'ALIGNED'] })
  driftType: 'MISSING_IN_PORTFOLIO' | 'EXTRA_IN_PORTFOLIO' | 'WEIGHT_DRIFT' | 'ALIGNED'
}

export class IndustryDriftItemDto {
  @ApiProperty()
  industry: string

  @ApiProperty()
  actualWeight: number

  @ApiProperty()
  targetWeight: number

  @ApiProperty()
  diff: number
}

export class DriftDetectionResponseDto {
  @ApiProperty()
  portfolioId: string

  @ApiProperty()
  strategyId: string

  @ApiProperty()
  tradeDate: string

  @ApiProperty()
  totalDriftScore: number

  @ApiProperty()
  isAlert: boolean

  @ApiProperty()
  alertThreshold: number

  @ApiProperty()
  positionDrift: number

  @ApiProperty()
  weightDrift: number

  @ApiProperty()
  industryDrift: number

  @ApiProperty({ type: [DriftItemDto] })
  items: DriftItemDto[]

  @ApiProperty({ type: [IndustryDriftItemDto] })
  industryItems: IndustryDriftItemDto[]
}
