import { ApiProperty } from '@nestjs/swagger'

export class StrategyDraftDto {
  @ApiProperty() id: number
  @ApiProperty() userId: number
  @ApiProperty() name: string
  @ApiProperty({ type: 'object', additionalProperties: true }) config: Record<string, unknown>
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class StrategyDraftListResponseDto {
  @ApiProperty({ type: [StrategyDraftDto] }) drafts: StrategyDraftDto[]
}

export class DraftMessageResponseDto {
  @ApiProperty() message: string
}
