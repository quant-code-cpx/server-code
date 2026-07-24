import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiMemoryCategory, AiMemorySensitivity, AiMemoryStatus } from '@prisma/client'

export class AgentMemoryResponseDto {
  @ApiProperty()
  memoryId: string

  @ApiProperty({ enum: AiMemoryCategory })
  category: AiMemoryCategory

  @ApiProperty()
  key: string

  @ApiProperty({
    oneOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  value: unknown

  @ApiProperty({ enum: AiMemorySensitivity })
  sensitivity: AiMemorySensitivity

  @ApiProperty({ enum: AiMemoryStatus })
  status: AiMemoryStatus

  @ApiPropertyOptional({ nullable: true })
  sourceConversationId: string | null

  @ApiPropertyOptional({ nullable: true })
  sourceMessageId: string | null

  @ApiProperty()
  confidence: number

  @ApiProperty()
  version: number

  @ApiProperty({ format: 'date-time' })
  validFrom: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  confirmedAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  expiresAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  revokedAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deletedAt: string | null

  @ApiProperty({ format: 'date-time' })
  createdAt: string

  @ApiProperty({ format: 'date-time' })
  updatedAt: string
}

export class AgentMemoryListResponseDto {
  @ApiProperty({ type: AgentMemoryResponseDto, isArray: true })
  items: AgentMemoryResponseDto[]

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null
}

export class DeleteAgentMemoryResponseDto {
  @ApiProperty()
  memoryId: string

  @ApiProperty({ enum: [AiMemoryStatus.REVOKED] })
  status: AiMemoryStatus

  @ApiProperty({ format: 'date-time' })
  deletedAt: string
}
