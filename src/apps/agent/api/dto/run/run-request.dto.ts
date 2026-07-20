import { AiModelPolicy } from '@prisma/client'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AGENT_CAPABILITIES, type AgentCapability } from '../../../contracts'
import { AgentPageContextDto } from '../common/page-context.dto'

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class SendAgentMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string

  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  conversationId: string

  @ApiProperty({ maxLength: 10_000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content: string

  @ApiPropertyOptional({ type: AgentPageContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentPageContextDto)
  pageContext?: AgentPageContextDto

  @ApiProperty({ enum: AiModelPolicy })
  @IsEnum(AiModelPolicy)
  modelPolicy: AiModelPolicy

  @ApiProperty({ enum: AGENT_CAPABILITIES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AGENT_CAPABILITIES.length)
  @IsIn(AGENT_CAPABILITIES, { each: true })
  allowedCapabilities: AgentCapability[]
}

export class RegenerateAgentMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string

  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  messageId: string

  @ApiProperty({ enum: AiModelPolicy })
  @IsEnum(AiModelPolicy)
  modelPolicy: AiModelPolicy
}

export class AgentRunStatusDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  runId: string
}

export class AgentRunEventsDto extends AgentRunStatusDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  afterSequence: number
}

export class CancelAgentRunDto extends AgentRunStatusDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedStatusVersion: number
}

export class ListAgentToolCallsDto extends AgentRunStatusDto {
  @ApiPropertyOptional({ default: false, description: '普通用户端点始终只返回脱敏摘要' })
  @IsOptional()
  @IsBoolean()
  includePayload = false
}
