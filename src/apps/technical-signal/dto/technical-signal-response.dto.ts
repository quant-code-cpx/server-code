import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { TechnicalSignalEvidence } from '../domain'
import { TechnicalSignalEntryMode, TechnicalSignalPeriod } from './technical-signal-request.dto'

export class TechnicalSignalDefinitionDto {
  @ApiProperty() signalKey: string
  @ApiProperty() semanticsVersion: string
  @ApiProperty({ description: '定义的 SHA-256 内容哈希' }) definitionHash: string
  @ApiProperty() displayName: string
  @ApiProperty({ enum: ['BULLISH', 'BEARISH', 'CONTEXTUAL'] }) direction: string
  @ApiProperty({ enum: ['LOCAL_QFQ_OHLCV'] }) source: string
  @ApiProperty() description: string
  @ApiProperty({ type: 'object', additionalProperties: true }) parameters: Record<string, string | number | boolean>
  @ApiProperty() stable: boolean
  @ApiPropertyOptional({ nullable: true }) deprecatedAt: string | null
}

export class TechnicalSignalDefinitionListResponseDto {
  @ApiProperty({ type: [TechnicalSignalDefinitionDto] }) definitions: TechnicalSignalDefinitionDto[]
}

export class ReturnDistributionDto {
  @ApiProperty() sampleCount: number
  @ApiProperty() upCount: number
  @ApiProperty() downCount: number
  @ApiProperty() flatCount: number
  @ApiPropertyOptional({ nullable: true }) upRatio: number | null
  @ApiPropertyOptional({ nullable: true }) downRatio: number | null
  @ApiPropertyOptional({ nullable: true }) flatRatio: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) medianReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) minimumReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) maximumReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) stdDevPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) p25ReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) p75ReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) meanConfidenceLowerPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) meanConfidenceUpperPct: number | null
}

export class DirectionalDistributionDto {
  @ApiProperty() sampleCount: number
  @ApiProperty() successCount: number
  @ApiProperty() failureCount: number
  @ApiProperty() flatCount: number
  @ApiPropertyOptional({ nullable: true }) successRatio: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageDirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) medianDirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) minimumDirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) maximumDirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) stdDevDirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) p25DirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) p75DirectionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) meanDirectionalConfidenceLowerPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) meanDirectionalConfidenceUpperPct: number | null
  @ApiPropertyOptional({ nullable: true }) successConfidenceLower: number | null
  @ApiPropertyOptional({ nullable: true }) successConfidenceUpper: number | null
}

export class ExcursionDistributionDto {
  @ApiProperty() completePathCount: number
  @ApiProperty() partialPathCount: number
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageMfePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) medianMfePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageMaePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) medianMaePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageDirectionalMfePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) averageDirectionalMaePct: number | null
}

export class SignalHorizonStatisticsDto {
  @ApiProperty() horizon: number
  @ApiProperty() eligibleOutcomeCount: number
  @ApiProperty() validOutcomeCount: number
  @ApiProperty() immatureCount: number
  @ApiProperty() missingCount: number
  @ApiProperty() overlappingOccurrenceCount: number
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) missingReasons: Record<string, number>
  @ApiProperty() benchmarkMissingCount: number
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) benchmarkMissingReasons: Record<
    string,
    number
  >
  @ApiProperty({ type: () => ReturnDistributionDto }) raw: ReturnDistributionDto
  @ApiProperty({ type: () => DirectionalDistributionDto }) directional: DirectionalDistributionDto
  @ApiPropertyOptional({ type: () => ReturnDistributionDto, nullable: true }) excess: ReturnDistributionDto | null
  @ApiProperty({ type: () => ExcursionDistributionDto }) excursion: ExcursionDistributionDto
  @ApiPropertyOptional({ nullable: true }) minSampleDate: string | null
  @ApiPropertyOptional({ nullable: true }) maxSampleDate: string | null
}

export class SignalPeriodStatisticsDto {
  @ApiProperty({ enum: TechnicalSignalPeriod }) period: TechnicalSignalPeriod
  @ApiProperty() requestedStartDate: string
  @ApiPropertyOptional({ nullable: true }) actualStartDate: string | null
  @ApiProperty() endDate: string
  @ApiProperty() signalKey: string
  @ApiProperty() semanticsVersion: string
  @ApiProperty() definitionHash: string
  @ApiProperty({ enum: ['BULLISH', 'BEARISH', 'CONTEXTUAL'] }) direction: string
  @ApiProperty() evaluable: boolean
  @ApiPropertyOptional({ nullable: true }) notEvaluableReason: 'INSUFFICIENT_HISTORY' | null
  @ApiProperty() requiredValidRows: number
  @ApiProperty() actualValidRows: number
  @ApiProperty() occurrenceCount: number
  @ApiProperty({ type: [SignalHorizonStatisticsDto] }) horizons: SignalHorizonStatisticsDto[]
}

export class TechnicalSignalStatisticsResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) meta: Record<string, unknown>
  @ApiProperty({ type: [SignalPeriodStatisticsDto] }) groups: SignalPeriodStatisticsDto[]
}

export class TechnicalSignalOutcomeDto {
  @ApiProperty() horizon: number
  @ApiProperty() expectedEntryDate: string
  @ApiProperty() expectedTargetDate: string
  @ApiProperty({ enum: ['VALID', 'IMMATURE', 'MISSING'] }) qualityStatus: string
  @ApiPropertyOptional({ nullable: true }) missingReason: string | null
  @ApiPropertyOptional({ nullable: true }) entryRawPrice: number | null
  @ApiPropertyOptional({ nullable: true }) entryAdjFactor: number | null
  @ApiPropertyOptional({ nullable: true }) targetRawPrice: number | null
  @ApiPropertyOptional({ nullable: true }) targetAdjFactor: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) rawReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) directionalReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) benchmarkReturnPct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) excessReturnPct: number | null
  @ApiPropertyOptional({ nullable: true }) benchmarkMissingReason: string | null
  @ApiProperty({ enum: ['COMPLETE', 'PARTIAL', 'NOT_APPLICABLE'] }) pathCoverageStatus: string
  @ApiProperty({ type: [String] }) pathMissingDates: string[]
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) rawMfePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) rawMaePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) directionalMfePct: number | null
  @ApiPropertyOptional({ nullable: true, description: '百分数' }) directionalMaePct: number | null
}

export class TechnicalSignalOccurrenceItemDto {
  @ApiProperty() signalId: string
  @ApiProperty() tsCode: string
  @ApiProperty() signalKey: string
  @ApiProperty() semanticsVersion: string
  @ApiProperty() definitionHash: string
  @ApiProperty() source: string
  @ApiProperty() indicatorAlgorithmVersion: string
  @ApiProperty() signalDate: string
  @ApiProperty({ enum: ['BULLISH', 'BEARISH', 'CONTEXTUAL'] }) direction: string
  @ApiProperty({ type: 'object', additionalProperties: true }) evidence: TechnicalSignalEvidence
  @ApiProperty({ type: [TechnicalSignalOutcomeDto] }) outcomes: TechnicalSignalOutcomeDto[]
}

export class TechnicalSignalOccurrenceListResponseDto {
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty({ type: [TechnicalSignalOccurrenceItemDto] }) items: TechnicalSignalOccurrenceItemDto[]
}
