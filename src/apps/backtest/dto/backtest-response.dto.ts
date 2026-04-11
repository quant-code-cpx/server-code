import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class DataReadinessDto {
  @ApiProperty({ example: true }) hasDaily: boolean
  @ApiProperty({ example: true }) hasAdjFactor: boolean
  @ApiProperty({ example: true }) hasTradeCal: boolean
  @ApiProperty({ example: true }) hasIndexDaily: boolean
  @ApiProperty({ example: false }) hasStkLimit: boolean
  @ApiProperty({ example: false }) hasSuspendD: boolean
  @ApiProperty({ example: false }) hasIndexWeight: boolean
}

export class ValidateStatsDto {
  @ApiProperty({ example: 242 }) tradingDays: number
  @ApiPropertyOptional({ example: 1850, nullable: true }) estimatedUniverseSize: number | null
  @ApiPropertyOptional({ example: '2023-01-03', nullable: true }) earliestAvailableDate: string | null
  @ApiPropertyOptional({ example: '2023-12-29', nullable: true }) latestAvailableDate: string | null
}

export class ValidateBacktestRunResponseDto {
  @ApiProperty({ example: true }) isValid: boolean
  @ApiProperty({ type: [String], example: [] }) warnings: string[]
  @ApiProperty({ type: [String], example: [] }) errors: string[]
  @ApiProperty({ type: DataReadinessDto }) dataReadiness: DataReadinessDto
  @ApiProperty({ type: ValidateStatsDto }) stats: ValidateStatsDto
}

export class CreateBacktestRunResponseDto {
  @ApiProperty({ example: 'cld1a2b3c4d5e6f7g8h9i0jk' }) runId: string
  @ApiProperty({ example: 'bull:backtest:cld1a2b3c4d5e6f7g8h9i0jk' }) jobId: string
  @ApiProperty({ example: 'PENDING' }) status: string
}

export class BacktestRunSummaryDto {
  @ApiProperty({ example: 'cld1a2b3c4d5e6f7g8h9i0jk' }) runId: string
  @ApiPropertyOptional({ example: '低估值价值策略', nullable: true }) name: string | null
  @ApiProperty({ example: 'VALUE_FACTOR' }) strategyType: string
  @ApiProperty({ example: 'COMPLETED' }) status: string
  @ApiProperty({ example: '2023-01-01' }) startDate: string
  @ApiProperty({ example: '2023-12-31' }) endDate: string
  @ApiProperty({ example: '000300.SH' }) benchmarkTsCode: string
  @ApiPropertyOptional({ example: 0.2341, nullable: true, description: '总收益率' }) totalReturn: number | null
  @ApiPropertyOptional({ example: 0.2341, nullable: true, description: '年化收益率' }) annualizedReturn: number | null
  @ApiPropertyOptional({ example: -0.1523, nullable: true, description: '最大回撤' }) maxDrawdown: number | null
  @ApiPropertyOptional({ example: 1.42, nullable: true, description: '夏普比率' }) sharpeRatio: number | null
  @ApiProperty({ example: 100 }) progress: number
  @ApiProperty({ example: '2024-01-15T08:00:00.000Z' }) createdAt: string
  @ApiPropertyOptional({ example: '2024-01-15T08:05:32.000Z', nullable: true }) completedAt: string | null
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
