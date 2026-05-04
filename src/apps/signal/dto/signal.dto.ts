import { Type } from 'class-transformer'
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsPositive, Matches, Max, Min } from 'class-validator'
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
  @Matches(/^\d{8}$/)
  tradeDate?: string
}

export class SignalHistoryQueryDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string

  @ApiPropertyOptional({ description: '起始日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  startDate?: string

  @ApiPropertyOptional({ description: '截止日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  endDate?: string

  @ApiPropertyOptional({ type: [String], enum: ['BUY', 'SELL', 'HOLD'], description: '动作过滤' })
  @IsOptional()
  @IsArray()
  @IsIn(['BUY', 'SELL', 'HOLD'], { each: true })
  actions?: Array<'BUY' | 'SELL' | 'HOLD'>

  @ApiPropertyOptional({ description: '股票代码/名称关键词' })
  @IsOptional()
  @IsString()
  stockKeyword?: string

  @ApiPropertyOptional({ description: '最小置信度' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  confidenceMin?: number

  @ApiPropertyOptional({ description: '最大置信度' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Max(1)
  confidenceMax?: number

  @ApiPropertyOptional({ description: '前瞻收益窗口（交易日）', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  forwardWindow?: number = 5

  @ApiPropertyOptional({ description: '页码（默认 1）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页条数（默认 20）' })
  @IsOptional()
  @Type(() => Number)
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

  @ApiPropertyOptional({ description: '信号交易日 YYYYMMDD' })
  tradeDate?: string | null

  @ApiPropertyOptional({ description: '策略 ID' })
  strategyId?: string

  @ApiPropertyOptional({ description: 'forwardWindow 个交易日后的个股收益率（%）' })
  forwardReturn?: number | null

  @ApiPropertyOptional({ description: '相对基准的超额收益率（%）' })
  excessReturn?: number | null

  @ApiPropertyOptional({ description: '是否为该策略-股票-动作首次出现' })
  isFirstOccurrence?: boolean
}

export class SignalAggregateStatsDto {
  @ApiProperty() total: number
  @ApiProperty() buyCount: number
  @ApiProperty() sellCount: number
  @ApiProperty() holdCount: number
  @ApiPropertyOptional() avgConfidence: number | null
  @ApiPropertyOptional() avgForwardReturn: number | null
  @ApiPropertyOptional() avgExcessReturn: number | null
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

  @ApiProperty({ type: SignalAggregateStatsDto })
  aggregateStats: SignalAggregateStatsDto

  @ApiProperty()
  generatedAt: string

  @ApiProperty({ description: 'OK | STALE（超2天未更新）' })
  status: string

  @ApiProperty({ description: '同 generatedAt，最近一次运行时间' })
  lastRunAt: string
}

export class SignalHistoryGroupDto {
  @ApiProperty()
  tradeDate: string

  @ApiProperty()
  signalCount: number

  @ApiProperty({ type: [TradingSignalItemDto] })
  signals: TradingSignalItemDto[]

  @ApiProperty({ type: SignalAggregateStatsDto })
  aggregateStats: SignalAggregateStatsDto
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

  @ApiProperty({ type: SignalAggregateStatsDto })
  aggregateStats: SignalAggregateStatsDto
}
