import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiAgentRunStatus, AiAgentStepKind, AiAgentStepStatus, AiToolCallStatus } from '@prisma/client'

export class AgentRunCreatedResponseDto {
  @ApiProperty()
  conversationId: string

  @ApiProperty()
  userMessageId: string

  @ApiProperty()
  assistantMessageId: string

  @ApiProperty()
  runId: string

  @ApiProperty({ enum: AiAgentRunStatus })
  runStatus: AiAgentRunStatus

  @ApiProperty({ enum: ['/api/agent/runs/events'] })
  streamEndpoint: '/api/agent/runs/events'
}

export class AgentRunRegeneratedResponseDto {
  @ApiProperty()
  conversationId: string

  @ApiProperty()
  sourceMessageId: string

  @ApiProperty()
  assistantMessageId: string

  @ApiProperty()
  runId: string

  @ApiProperty({ enum: AiAgentRunStatus })
  runStatus: AiAgentRunStatus

  @ApiProperty({ enum: ['/api/agent/runs/events'] })
  streamEndpoint: '/api/agent/runs/events'
}

export class AgentRunCurrentStepDto {
  @ApiProperty()
  stepId: string

  @ApiProperty()
  stepKey: string

  @ApiProperty({ enum: AiAgentStepKind })
  kind: AiAgentStepKind

  @ApiProperty({ enum: AiAgentStepStatus })
  status: AiAgentStepStatus

  @ApiProperty()
  ordinal: number
}

export class AgentRunStatusResponseDto {
  @ApiProperty()
  runId: string

  @ApiProperty()
  conversationId: string

  @ApiProperty({ enum: AiAgentRunStatus })
  status: AiAgentRunStatus

  @ApiProperty()
  statusVersion: number

  @ApiPropertyOptional({ nullable: true, type: AgentRunCurrentStepDto })
  currentStep: AgentRunCurrentStepDto | null

  @ApiPropertyOptional({ nullable: true })
  finalMessageId: string | null

  @ApiProperty()
  latestEventSequence: number

  @ApiProperty()
  canCancel: boolean

  @ApiPropertyOptional({ nullable: true })
  errorCode: number | null

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null

  @ApiProperty({ format: 'date-time' })
  queuedAt: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  startedAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  endedAt: string | null
}

export class CancelAgentRunResponseDto {
  @ApiProperty()
  runId: string

  @ApiProperty({ enum: AiAgentRunStatus })
  status: AiAgentRunStatus

  @ApiProperty()
  statusVersion: number

  @ApiProperty()
  cancellationAccepted: boolean
}

export class AgentToolCallResponseDto {
  @ApiProperty()
  toolCallId: string

  @ApiProperty()
  toolName: string

  @ApiProperty()
  toolVersion: string

  @ApiProperty({ enum: AiToolCallStatus })
  status: AiToolCallStatus

  @ApiProperty()
  attemptCount: number

  @ApiProperty({ type: 'object', additionalProperties: true })
  inputSummary: Record<string, unknown>

  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  outputSummary: Record<string, unknown> | null

  @ApiPropertyOptional({ nullable: true })
  errorCode: number | null

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null

  @ApiPropertyOptional({ nullable: true })
  durationMs: number | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataAsOf: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataThrough: string | null

  @ApiProperty({ format: 'date-time' })
  startedAt: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  finishedAt: string | null
}

export class AgentToolCallListResponseDto {
  @ApiProperty({ type: AgentToolCallResponseDto, isArray: true })
  items: AgentToolCallResponseDto[]

  @ApiProperty({ default: false })
  payloadIncluded: false
}
