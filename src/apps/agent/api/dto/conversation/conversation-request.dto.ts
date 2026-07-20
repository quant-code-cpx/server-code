import { AiModelPolicy } from '@prisma/client'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class CreateConversationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string

  @ApiProperty({ maxLength: 200, example: '贵州茅台估值研究' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string

  @ApiProperty({ enum: AiModelPolicy })
  @IsEnum(AiModelPolicy)
  modelPolicy: AiModelPolicy

  @ApiPropertyOptional({ nullable: true, maxLength: 128, example: null })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  preferredModel: string | null = null
}

export class ListConversationsDto {
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
  includeArchived: boolean = false
}

export class ConversationDetailDto {
  @ApiProperty()
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  conversationId: string
}

export class ListConversationMessagesDto extends ConversationDetailDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(AGENT_ID_PATTERN)
  beforeMessageId: string | null = null

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50
}

export class UpdateConversationModelDto extends ConversationDetailDto {
  @ApiProperty({ enum: AiModelPolicy })
  @IsEnum(AiModelPolicy)
  modelPolicy: AiModelPolicy

  @ApiPropertyOptional({ nullable: true, maxLength: 128 })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  preferredModel: string | null = null
}
