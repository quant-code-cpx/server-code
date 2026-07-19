import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiConversationStatus, AiMessageRole, AiMessageStatus, AiModelPolicy } from '@prisma/client'

export class CreateConversationResponseDto {
  @ApiProperty()
  conversationId: string

  @ApiProperty({ enum: [AiConversationStatus.ACTIVE, AiConversationStatus.ARCHIVED] })
  status: AiConversationStatus

  @ApiProperty({ format: 'date-time' })
  createdAt: string
}

export class AgentConversationSummaryDto {
  @ApiProperty()
  conversationId: string

  @ApiProperty()
  title: string

  @ApiProperty({ enum: [AiConversationStatus.ACTIVE, AiConversationStatus.ARCHIVED] })
  status: AiConversationStatus

  @ApiProperty({ enum: AiModelPolicy })
  modelPolicy: AiModelPolicy

  @ApiPropertyOptional({ nullable: true })
  preferredModel: string | null

  @ApiProperty()
  messageCount: number

  @ApiProperty({ format: 'date-time' })
  lastMessageAt: string

  @ApiProperty({ format: 'date-time' })
  createdAt: string

  @ApiProperty({ format: 'date-time' })
  updatedAt: string
}

export class AgentConversationListResponseDto {
  @ApiProperty({ type: AgentConversationSummaryDto, isArray: true })
  items: AgentConversationSummaryDto[]

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null
}

export class AgentConversationDetailResponseDto extends AgentConversationSummaryDto {
  @ApiProperty()
  statusVersion: number
}

export class AgentMessageRunSummaryDto {
  @ApiProperty()
  runId: string

  @ApiProperty()
  status: string

  @ApiProperty()
  statusVersion: number

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  endedAt: string | null
}

export class AgentCitationResponseDto {
  @ApiProperty()
  citationId: string

  @ApiProperty()
  blockId: string

  @ApiProperty()
  claimKey: string

  @ApiProperty()
  conclusionLevel: string

  @ApiProperty()
  sourceType: string

  @ApiProperty()
  title: string

  @ApiPropertyOptional({ nullable: true })
  canonicalUrl: string | null

  @ApiPropertyOptional({ nullable: true })
  publisher: string | null

  @ApiProperty({ format: 'date-time' })
  retrievedAt: string

  @ApiProperty({ type: 'object', additionalProperties: true })
  locator: Record<string, unknown>
}

export class AgentMessageResponseDto {
  @ApiProperty()
  messageId: string

  @ApiProperty({ enum: AiMessageRole })
  role: AiMessageRole

  @ApiProperty({ enum: AiMessageStatus })
  status: AiMessageStatus

  @ApiPropertyOptional({ nullable: true })
  contentText: string | null

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  contentBlocks: unknown[]

  @ApiProperty()
  version: number

  @ApiPropertyOptional({ nullable: true })
  parentMessageId: string | null

  @ApiPropertyOptional({ nullable: true })
  modelName: string | null

  @ApiPropertyOptional({ nullable: true, type: AgentMessageRunSummaryDto })
  run: AgentMessageRunSummaryDto | null

  @ApiProperty({ type: AgentCitationResponseDto, isArray: true })
  citations: AgentCitationResponseDto[]

  @ApiProperty({ format: 'date-time' })
  createdAt: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  completedAt: string | null
}

export class AgentMessageListResponseDto {
  @ApiProperty({ type: AgentMessageResponseDto, isArray: true })
  items: AgentMessageResponseDto[]

  @ApiPropertyOptional({ nullable: true })
  nextBeforeMessageId: string | null
}

export class UpdateConversationModelResponseDto {
  @ApiProperty()
  conversationId: string

  @ApiProperty({ enum: AiModelPolicy })
  modelPolicy: AiModelPolicy

  @ApiPropertyOptional({ nullable: true })
  preferredModel: string | null

  @ApiProperty({ format: 'date-time' })
  updatedAt: string
}
