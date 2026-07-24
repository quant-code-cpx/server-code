import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiResearchReportStatus } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class ResearchReportJournalDto {
  @ApiPropertyOptional({ example: '600519.SH' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  tsCode?: string

  @ApiPropertyOptional({ maxLength: 4_000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  thesis?: string

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @ArrayMaxSize(20)
  risks?: string[]

  @ApiPropertyOptional({ maxLength: 4_000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  decision?: string

  @ApiPropertyOptional({ maxLength: 4_000 })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  outcome?: string

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reviewAt?: string
}

export class SaveResearchReportDto {
  @ApiPropertyOptional({ description: '首次预览必须提供；确认阶段由 token 绑定' })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(32)
  runId?: string

  @ApiPropertyOptional({ description: '首次预览返回的短期确认 token' })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(4_096)
  confirmationToken?: string

  @ApiPropertyOptional({ description: '确认保存必填；同一用户内幂等' })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(128)
  clientRequestId?: string

  @ApiPropertyOptional({ type: ResearchReportJournalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResearchReportJournalDto)
  journal?: ResearchReportJournalDto
}

export class ListResearchReportsDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(32)
  cursor: string | null = null

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit: number = 30

  @ApiPropertyOptional({ enum: AiResearchReportStatus })
  @IsOptional()
  @IsEnum(AiResearchReportStatus)
  status?: AiResearchReportStatus
}

export class ResearchReportIdDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  reportId: string
}

export class DeleteResearchReportDto extends ResearchReportIdDto {}

export function assertAgentIdentifier(value: string, name: string): void {
  if (!AGENT_ID_PATTERN.test(value)) throw new Error(`${name} 非法`)
}
