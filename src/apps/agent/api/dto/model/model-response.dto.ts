import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class AgentModelListItemResponseDto {
  @ApiProperty()
  model: string

  @ApiProperty()
  displayName: string

  @ApiProperty()
  provider: string

  @ApiProperty({ type: String, isArray: true })
  capabilities: string[]

  @ApiProperty()
  contextWindow: number

  @ApiProperty()
  maxOutputTokens: number

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  costTier: string

  @ApiProperty({ enum: ['AVAILABLE', 'UNAVAILABLE'] })
  status: string

  @ApiPropertyOptional({ nullable: true })
  reason: string | null
}

export class AgentModelListResponseDto {
  @ApiProperty({ type: AgentModelListItemResponseDto, isArray: true })
  items: AgentModelListItemResponseDto[]
}
