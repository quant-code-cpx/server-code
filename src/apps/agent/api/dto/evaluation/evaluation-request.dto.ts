import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const AGENT_EVALUATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const AGENT_EVALUATION_CASE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export class RunAgentEvaluationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string

  @ApiPropertyOptional({ enum: ['mvp'], default: 'mvp' })
  @IsOptional()
  @IsIn(['mvp'])
  dataset = 'mvp' as const

  @ApiPropertyOptional({ enum: ['fake'], default: 'fake' })
  @IsOptional()
  @IsIn(['fake'])
  provider = 'fake' as const
}

export class AgentEvaluationStatusDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_EVALUATION_ID_PATTERN)
  evaluationRunId: string
}

export class AgentEvaluationDetailDto extends AgentEvaluationStatusDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_EVALUATION_CASE_PATTERN)
  caseId: string
}
