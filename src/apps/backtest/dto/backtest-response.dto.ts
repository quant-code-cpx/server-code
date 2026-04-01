import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class DataReadinessDto {
  @ApiProperty() hasDaily: boolean
  @ApiProperty() hasAdjFactor: boolean
  @ApiProperty() hasTradeCal: boolean
  @ApiProperty() hasIndexDaily: boolean
  @ApiProperty() hasStkLimit: boolean
  @ApiProperty() hasSuspendD: boolean
  @ApiProperty() hasIndexWeight: boolean
}

export class ValidateStatsDto {
  @ApiProperty() tradingDays: number
  @ApiPropertyOptional({ nullable: true }) estimatedUniverseSize: number | null
  @ApiPropertyOptional({ nullable: true }) earliestAvailableDate: string | null
  @ApiPropertyOptional({ nullable: true }) latestAvailableDate: string | null
}

export class ValidateBacktestRunResponseDto {
  @ApiProperty() isValid: boolean
  @ApiProperty({ type: [String] }) warnings: string[]
  @ApiProperty({ type: [String] }) errors: string[]
  @ApiProperty({ type: DataReadinessDto }) dataReadiness: DataReadinessDto
  @ApiProperty({ type: ValidateStatsDto }) stats: ValidateStatsDto
}

export class CreateBacktestRunResponseDto {
  @ApiProperty() runId: string
  @ApiProperty() jobId: string
  @ApiProperty() status: string
}

export class BacktestRunSummaryDto {
  @ApiProperty() runId: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() strategyType: string
  @ApiProperty() status: string
  @ApiProperty() startDate: string
  @ApiProperty() endDate: string
  @ApiProperty() benchmarkTsCode: string
  @ApiPropertyOptional({ nullable: true }) totalReturn: number | null
  @ApiPropertyOptional({ nullable: true }) annualizedReturn: number | null
  @ApiPropertyOptional({ nullable: true }) maxDrawdown: number | null
  @ApiPropertyOptional({ nullable: true }) sharpeRatio: number | null
  @ApiProperty() progress: number
  @ApiProperty() createdAt: string
  @ApiPropertyOptional({ nullable: true }) completedAt: string | null
}

export class BacktestRunListResponseDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({ type: [BacktestRunSummaryDto] }) items: BacktestRunSummaryDto[]
}

export class BacktestRunSummaryMetricsDto {
  @ApiPropertyOptional({ nullable: true }) totalReturn: number | null
  @ApiPropertyOptional({ nullable: true }) annualizedReturn: number | null
  @ApiPropertyOptional({ nullable: true }) benchmarkReturn: number | null
  @ApiPropertyOptional({ nullable: true }) excessReturn: number | null
  @ApiPropertyOptional({ nullable: true }) maxDrawdown: number | null
  @ApiPropertyOptional({ nullable: true }) sharpeRatio: number | null
  @ApiPropertyOptional({ nullable: true }) sortinoRatio: number | null
  @ApiPropertyOptional({ nullable: true }) calmarRatio: number | null
  @ApiPropertyOptional({ nullable: true }) volatility: number | null
  @ApiPropertyOptional({ nullable: true }) alpha: number | null
  @ApiPropertyOptional({ nullable: true }) beta: number | null
  @ApiPropertyOptional({ nullable: true }) informationRatio: number | null
  @ApiPropertyOptional({ nullable: true }) winRate: number | null
  @ApiPropertyOptional({ nullable: true }) turnoverRate: number | null
  @ApiPropertyOptional({ nullable: true }) tradeCount: number | null
}

export class BacktestRunDetailResponseDto {
  @ApiProperty() runId: string
  @ApiPropertyOptional({ nullable: true }) jobId: string | null
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() status: string
  @ApiProperty() progress: number
  @ApiPropertyOptional({ nullable: true }) failedReason: string | null
  @ApiProperty() strategyType: string
  @ApiProperty() strategyConfig: Record<string, unknown>
  @ApiProperty() startDate: string
  @ApiProperty() endDate: string
  @ApiProperty() benchmarkTsCode: string
  @ApiProperty() universe: string
  @ApiProperty() initialCapital: number
  @ApiProperty() rebalanceFrequency: string
  @ApiProperty() priceMode: string
  @ApiProperty({ type: BacktestRunSummaryMetricsDto }) summary: BacktestRunSummaryMetricsDto
  @ApiProperty() createdAt: string
  @ApiPropertyOptional({ nullable: true }) startedAt: string | null
  @ApiPropertyOptional({ nullable: true }) completedAt: string | null
}

export class EquityPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() nav: number
  @ApiProperty() benchmarkNav: number
  @ApiProperty() drawdown: number
  @ApiProperty() dailyReturn: number
  @ApiProperty() benchmarkReturn: number
  @ApiProperty() exposure: number
  @ApiProperty() cashRatio: number
}

export class BacktestEquityResponseDto {
  @ApiProperty({ type: [EquityPointDto] }) points: EquityPointDto[]
}

export class BacktestTradeItemDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() tsCode: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() side: string
  @ApiProperty() price: number
  @ApiProperty() quantity: number
  @ApiProperty() amount: number
  @ApiProperty() commission: number
  @ApiProperty() stampDuty: number
  @ApiProperty() slippageCost: number
  @ApiPropertyOptional({ nullable: true }) reason: string | null
}

export class BacktestTradeListResponseDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({ type: [BacktestTradeItemDto] }) items: BacktestTradeItemDto[]
}

export class BacktestPositionItemDto {
  @ApiProperty() tsCode: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() quantity: number
  @ApiProperty() costPrice: number
  @ApiProperty() closePrice: number
  @ApiProperty() marketValue: number
  @ApiProperty() weight: number
  @ApiProperty() unrealizedPnl: number
  @ApiProperty() holdingDays: number
}

export class BacktestPositionResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ type: [BacktestPositionItemDto] }) items: BacktestPositionItemDto[]
}

export class CancelBacktestRunResponseDto {
  @ApiProperty() runId: string
  @ApiProperty() status: string
}

export class StrategyParameterSchemaDto {
  @ApiProperty() field: string
  @ApiProperty() label: string
  @ApiProperty() type: string
  @ApiProperty() required: boolean
  @ApiPropertyOptional({ nullable: true }) defaultValue?: unknown
  @ApiPropertyOptional({ type: [Object] }) options?: Array<{ label: string; value: string }>
  @ApiPropertyOptional({ nullable: true }) placeholder?: string
  @ApiPropertyOptional({ nullable: true }) helpText?: string
}

export class StrategyTemplateDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() description: string
  @ApiProperty() category: string
  @ApiProperty({ type: [StrategyParameterSchemaDto] }) parameterSchema: StrategyParameterSchemaDto[]
}

export class StrategyTemplateListResponseDto {
  @ApiProperty({ type: [StrategyTemplateDto] }) templates: StrategyTemplateDto[]
}
