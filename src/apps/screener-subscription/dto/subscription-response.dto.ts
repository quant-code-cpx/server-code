import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class SubscriptionDto {
  @ApiProperty() id: number
  @ApiProperty() name: string
  @ApiPropertyOptional({ nullable: true }) strategyId?: number | null
  @ApiProperty({ type: 'object', additionalProperties: true }) filters: Record<string, unknown>
  @ApiPropertyOptional({ nullable: true }) sortBy?: string | null
  @ApiPropertyOptional({ nullable: true }) sortOrder?: string | null
  @ApiProperty() frequency: string
  @ApiProperty() status: string
  @ApiPropertyOptional({ nullable: true }) lastRunAt?: Date | null
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

export class SubscriptionLogDto {
  @ApiProperty() id: number
  @ApiProperty() subscriptionId: number
  @ApiProperty() tradeDate: string
  @ApiProperty() matchCount: number
  @ApiProperty() newEntryCount: number
  @ApiProperty() exitCount: number
  @ApiProperty({ type: [String] }) newEntryCodes: string[]
  @ApiProperty({ type: [String] }) exitCodes: string[]
  @ApiProperty() executionMs: number
  @ApiProperty() success: boolean
  @ApiPropertyOptional({ nullable: true }) errorMessage?: string | null
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
