import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max, IsInt, IsPositive } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Activate ──────────────────────────────────────────────────────────────────

export class ActivateSignalDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string

  @ApiPropertyOptional({ description: '关联组合 ID（关联后信号生成时自动做漂移检测）' })
  @IsOptional()
  @IsString()
  portfolioId?: string

  @ApiPropertyOptional({ description: '信号宇宙（默认 ALL_A）' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiPropertyOptional({ description: '基准指数代码（默认 000300.SH）' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string

  @ApiPropertyOptional({ description: '策略所需回看天数（默认 250）' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  lookbackDays?: number

  @ApiPropertyOptional({ description: '漂移告警阈值（默认 0.3，范围 0~1）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  alertThreshold?: number
}

export class DeactivateSignalDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string
}

// ── Query ─────────────────────────────────────────────────────────────────────

export class LatestSignalQueryDto {
  @ApiPropertyOptional({ description: '按策略 ID 筛选（可选）' })
  @IsOptional()
  @IsString()
  strategyId?: string

  @ApiPropertyOptional({ description: '查询指定日期的信号（YYYYMMDD，默认最近一个交易日）' })
  @IsOptional()
  @IsString()
  tradeDate?: string
}

export class SignalHistoryQueryDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string

  @ApiPropertyOptional({ description: '起始日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  startDate?: string

  @ApiPropertyOptional({ description: '截止日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  endDate?: string

  @ApiPropertyOptional({ description: '页码（默认 1）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页条数（默认 20）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}

// ── Response ──────────────────────────────────────────────────────────────────

export class SignalActivationItemDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  strategyId: string

  @ApiProperty()
  strategyName: string

  @ApiPropertyOptional()
  portfolioId: string | null

  @ApiProperty()
  isActive: boolean

  @ApiProperty()
  universe: string

  @ApiProperty()
  benchmarkTsCode: string

  @ApiProperty()
  lookbackDays: number

  @ApiProperty()
  alertThreshold: number

  @ApiPropertyOptional()
  lastSignalDate: string | null

  @ApiProperty()
  createdAt: string

  @ApiProperty()
  updatedAt: string
}

export class TradingSignalItemDto {
  @ApiProperty()
  tsCode: string

  @ApiProperty()
  stockName: string

  @ApiProperty({ enum: ['BUY', 'SELL', 'HOLD'] })
  action: 'BUY' | 'SELL' | 'HOLD'

  @ApiPropertyOptional()
  targetWeight: number | null

  @ApiPropertyOptional()
  confidence: number | null
}

export class LatestSignalResponseDto {
  @ApiProperty()
  strategyId: string

  @ApiProperty()
  strategyName: string

  @ApiProperty()
  tradeDate: string

  @ApiProperty({ type: [TradingSignalItemDto] })
  signals: TradingSignalItemDto[]

  @ApiProperty()
  generatedAt: string
}

export class SignalHistoryGroupDto {
  @ApiProperty()
  tradeDate: string

  @ApiProperty()
  signalCount: number

  @ApiProperty({ type: [TradingSignalItemDto] })
  signals: TradingSignalItemDto[]
}

export class SignalHistoryResponseDto {
  @ApiProperty()
  strategyId: string

  @ApiProperty()
  total: number

  @ApiProperty()
  page: number

  @ApiProperty()
  pageSize: number

  @ApiProperty({ type: [SignalHistoryGroupDto] })
  groups: SignalHistoryGroupDto[]
}
