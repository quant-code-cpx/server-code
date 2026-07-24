import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiModelPolicy, AiScheduledTaskStatus, AiScheduledTaskTrigger, AiTaskExecutionStatus } from '@prisma/client'

export class ScheduledResearchTaskResponseDto {
  @ApiProperty()
  taskId: string

  @ApiProperty()
  name: string

  @ApiProperty({ enum: AiScheduledTaskStatus })
  status: AiScheduledTaskStatus

  @ApiProperty()
  version: number

  @ApiProperty({ enum: AiScheduledTaskTrigger })
  trigger: AiScheduledTaskTrigger

  @ApiPropertyOptional({ nullable: true })
  cronExpression: string | null

  @ApiProperty()
  timeZone: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  oneTimeAt: string | null

  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  condition: Record<string, unknown> | null

  @ApiProperty()
  tradingDayOnly: boolean

  @ApiProperty({ type: 'object', additionalProperties: true })
  input: Record<string, unknown>

  @ApiProperty({ type: 'array', items: { type: 'string' } })
  allowedCapabilities: string[]

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  requiredWatermarks: Record<string, unknown>[]

  @ApiProperty()
  workflowKey: string

  @ApiProperty()
  workflowVersion: number

  @ApiProperty({ enum: AiModelPolicy })
  modelPolicy: AiModelPolicy

  @ApiPropertyOptional({ nullable: true })
  preferredModel: string | null

  @ApiProperty()
  maxCostCny: number

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextRunAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pausedAt: string | null

  @ApiProperty({ format: 'date-time' })
  createdAt: string

  @ApiProperty({ format: 'date-time' })
  updatedAt: string
}

export class ScheduledResearchTaskListResponseDto {
  @ApiProperty({ type: ScheduledResearchTaskResponseDto, isArray: true })
  items: ScheduledResearchTaskResponseDto[]

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null
}

export class ScheduledResearchExecutionResponseDto {
  @ApiProperty()
  executionId: string

  @ApiProperty()
  taskId: string

  @ApiProperty({ enum: AiTaskExecutionStatus })
  status: AiTaskExecutionStatus

  @ApiProperty()
  requestKey: string

  @ApiProperty({ format: 'date-time' })
  scheduledFor: string

  @ApiProperty({ type: 'object', additionalProperties: true })
  gateEvidence: Record<string, unknown>

  @ApiPropertyOptional({ nullable: true })
  runId: string | null

  @ApiPropertyOptional({ nullable: true })
  errorCode: number | null

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null

  @ApiPropertyOptional({ nullable: true })
  costCny: number | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  queuedAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  startedAt: string | null

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  endedAt: string | null

  @ApiProperty({ format: 'date-time' })
  createdAt: string
}

export class ScheduledResearchExecutionListResponseDto {
  @ApiProperty({ type: ScheduledResearchExecutionResponseDto, isArray: true })
  items: ScheduledResearchExecutionResponseDto[]

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null
}

export class RunScheduledResearchResponseDto {
  @ApiProperty()
  executionId: string

  @ApiProperty({ enum: AiTaskExecutionStatus })
  status: AiTaskExecutionStatus

  @ApiPropertyOptional({ nullable: true })
  runId: string | null
}
