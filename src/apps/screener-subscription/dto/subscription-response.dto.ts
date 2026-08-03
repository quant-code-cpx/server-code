import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { SubscriptionRuleType, SubscriptionRunStatus } from '@prisma/client'

export class LastRunResultDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() matchCount: number
  @ApiProperty() newEntryCount: number
  @ApiProperty() exitCount: number
  @ApiPropertyOptional() runKey?: string
  @ApiPropertyOptional() ruleVersion?: number
}

export class SubscriptionDto {
  @ApiProperty() id: number
  @ApiProperty() name: string
  @ApiPropertyOptional({ nullable: true }) strategyId?: number | null
  @ApiPropertyOptional({ nullable: true }) strategyName?: string | null
  @ApiPropertyOptional({ nullable: true }) strategyStatus?: string | null
  @ApiProperty({ type: 'object', additionalProperties: true }) filters: Record<string, unknown>
  @ApiPropertyOptional({ nullable: true }) sortBy?: string | null
  @ApiPropertyOptional({ nullable: true }) sortOrder?: string | null
  @ApiProperty({ enum: SubscriptionRuleType }) ruleType: SubscriptionRuleType
  @ApiProperty() ruleVersion: number
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) ruleSpec?: Record<
    string,
    unknown
  > | null
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) triggerSpec?: Record<
    string,
    unknown
  > | null
  @ApiPropertyOptional({ nullable: true }) ruleFingerprint?: string | null
  @ApiProperty() frequency: string
  @ApiProperty() status: string
  @ApiPropertyOptional({ nullable: true }) lastRunAt?: Date | null
  @ApiPropertyOptional({ nullable: true }) lastEvaluatedTradeDate?: string | null
  @ApiPropertyOptional({ type: () => LastRunResultDto, nullable: true }) lastRunResult?: LastRunResultDto | null
  @ApiProperty({ type: [String] }) lastMatchCodes: string[]
  @ApiProperty() consecutiveFails: number
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class SubscriptionListResponseDto {
  @ApiProperty({ type: [SubscriptionDto] }) subscriptions: SubscriptionDto[]
}

export class ManualRunResponseDto {
  @ApiPropertyOptional({ nullable: true }) jobId?: string | null
  @ApiProperty() message: string
}

export class CooldownErrorDto {
  @ApiProperty({ example: 'COOLDOWN' }) code: string
  @ApiProperty() message: string
  @ApiProperty() nextAllowedRunAt: string
  @ApiProperty() remainingSeconds: number
}

export class StockEntryItemDto {
  @ApiProperty() tsCode: string
  @ApiPropertyOptional({ nullable: true }) name?: string | null
  @ApiPropertyOptional({ nullable: true }) industry?: string | null
  @ApiPropertyOptional({ nullable: true }) close?: number | null
  @ApiPropertyOptional({ nullable: true }) pctChg?: number | null
}

export class SubscriptionLogDto {
  @ApiProperty() id: number
  @ApiProperty() subscriptionId: number
  @ApiPropertyOptional({ nullable: true }) runKey?: string | null
  @ApiPropertyOptional({ nullable: true }) jobId?: string | null
  @ApiProperty() tradeDate: string
  @ApiProperty() ruleVersion: number
  @ApiProperty({ enum: SubscriptionRunStatus }) status: SubscriptionRunStatus
  @ApiProperty() matchCount: number
  @ApiProperty() triggerCount: number
  @ApiProperty() newEntryCount: number
  @ApiProperty() exitCount: number
  @ApiProperty({ type: [String] }) newEntryCodes: string[]
  @ApiProperty({ type: [String] }) exitCodes: string[]
  @ApiPropertyOptional({ type: [StockEntryItemDto] }) newEntries?: StockEntryItemDto[]
  @ApiPropertyOptional({ type: [StockEntryItemDto] }) exits?: StockEntryItemDto[]
  @ApiProperty() executionMs: number
  @ApiProperty() success: boolean
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) dataVersions?: Record<
    string,
    string
  > | null
  @ApiProperty() warningCount: number
  @ApiPropertyOptional({ nullable: true }) errorCode?: string | null
  @ApiPropertyOptional({ nullable: true }) errorMessage?: string | null
  @ApiPropertyOptional({ nullable: true }) startedAt?: Date | null
  @ApiPropertyOptional({ nullable: true }) finishedAt?: Date | null
  @ApiProperty() createdAt: Date
}

export class SubscriptionLogListResponseDto {
  @ApiProperty({ type: [SubscriptionLogDto] }) logs: SubscriptionLogDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
}

export class SubscriptionMessageResponseDto {
  @ApiProperty() message: string
}

export class ValidateSubscriptionResponseDto {
  @ApiProperty() hasDuplicate: boolean
  @ApiPropertyOptional({ type: [Object] }) similarSubscriptions?: Array<{
    id: number
    name: string
    similarity: string
  }>
}
