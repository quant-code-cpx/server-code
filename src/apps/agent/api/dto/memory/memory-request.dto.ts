import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiMemoryCategory, AiMemorySensitivity } from '@prisma/client'
import { Transform } from 'class-transformer'
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'
import { MEMORY_POLICY_TOPICS, type MemoryPolicyTopic } from '../../../memory/memory-policy'

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/

export class ListMemoriesDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(512)
  cursor: string | null = null

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeInactive: boolean = false
}

export class CreateMemoryDto {
  @ApiProperty({ enum: AiMemoryCategory })
  @IsEnum(AiMemoryCategory)
  category: AiMemoryCategory

  @ApiProperty({ minLength: 2, maxLength: 128, example: 'response.style' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(MEMORY_KEY_PATTERN)
  key: string

  @ApiProperty({
    oneOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  @IsDefined()
  value: unknown

  @ApiPropertyOptional({ enum: AiMemorySensitivity, default: AiMemorySensitivity.NORMAL })
  @IsOptional()
  @IsEnum(AiMemorySensitivity)
  sensitivity: AiMemorySensitivity = AiMemorySensitivity.NORMAL

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  sourceConversationId: string | null = null

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  sourceMessageId: string | null = null

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 1 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidence: number = 1

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsDateString({ strict: true })
  expiresAt: string | null = null

  @ApiProperty({ enum: MEMORY_POLICY_TOPICS })
  @IsIn(MEMORY_POLICY_TOPICS)
  topic: MemoryPolicyTopic

  @ApiProperty({ enum: [true], description: '长期记忆写入必须由用户明确确认' })
  @IsBoolean()
  @Equals(true)
  confirmation: boolean
}

export class UpdateMemoryDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  memoryId: string

  @ApiProperty({
    oneOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  @IsDefined()
  value: unknown

  @ApiPropertyOptional({ enum: AiMemorySensitivity })
  @IsOptional()
  @IsEnum(AiMemorySensitivity)
  sensitivity?: AiMemorySensitivity

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  sourceConversationId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  sourceMessageId?: string | null

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidence?: number

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsDateString({ strict: true })
  expiresAt?: string | null

  @ApiProperty({ enum: MEMORY_POLICY_TOPICS })
  @IsIn(MEMORY_POLICY_TOPICS)
  topic: MemoryPolicyTopic

  @ApiProperty({ enum: [true], description: '记忆纠错必须由用户明确确认' })
  @IsBoolean()
  @Equals(true)
  confirmation: boolean
}

export class DeleteMemoryDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  memoryId: string
}
