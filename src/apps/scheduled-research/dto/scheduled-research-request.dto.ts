import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiModelPolicy, AiScheduledTaskStatus, AiScheduledTaskTrigger } from '@prisma/client'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { AGENT_CAPABILITIES, type AgentCapability } from 'src/apps/agent/contracts'
import { STOCK_RESEARCH_WORKFLOW_CURRENT } from 'src/apps/agent/workflow/workflows/stock-research.v2'
import { CONDITION_METRIC_KEYS, CONDITION_OPERATORS, WATERMARK_DATASETS } from '../scheduled-research.policy'

const SCHEDULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class StructuredConditionDto {
  @ApiProperty({ enum: CONDITION_METRIC_KEYS })
  @IsString()
  metricKey: string

  @ApiProperty({ example: '600519.SH', maxLength: 32 })
  @IsString()
  @Matches(/^[0-9A-Za-z._-]{3,32}$/)
  resourceId: string

  @ApiProperty({ enum: CONDITION_OPERATORS })
  @IsString()
  operator: string

  @ApiProperty({ example: 1500 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  threshold: number

  @ApiProperty({ minimum: 0, maximum: 43200, example: 60 })
  @IsInt()
  @Min(0)
  @Max(43_200)
  cooldownMinutes: number
}

export class RequiredWatermarkDto {
  @ApiProperty({ enum: WATERMARK_DATASETS })
  @IsString()
  dataset: string

  @ApiPropertyOptional({ pattern: '^\\d{8}$', example: '20260722' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  minTradeDate?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 43200, example: 180 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43_200)
  maxAgeMinutes?: number
}

export class CreateScheduledResearchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string

  @ApiProperty({ maxLength: 160, example: '收盘后自选股研究' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string

  @ApiProperty({ enum: AiScheduledTaskTrigger })
  @IsEnum(AiScheduledTaskTrigger)
  trigger: AiScheduledTaskTrigger

  @ApiPropertyOptional({ maxLength: 128, example: '0 30 18 * * 1-5' })
  @ValidateIf((object) => object.trigger === AiScheduledTaskTrigger.CRON)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  cronExpression?: string

  @ApiPropertyOptional({ default: 'Asia/Shanghai', maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timeZone: string = 'Asia/Shanghai'

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((object) => object.trigger === AiScheduledTaskTrigger.ONE_TIME)
  @Transform(({ value }) => (typeof value === 'string' ? new Date(value) : value))
  oneTimeAt?: Date

  @ApiPropertyOptional({ type: StructuredConditionDto })
  @ValidateIf((object) => object.trigger === AiScheduledTaskTrigger.STRUCTURED_CONDITION)
  @ValidateNested()
  @Type(() => StructuredConditionDto)
  condition?: StructuredConditionDto

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  tradingDayOnly: boolean = false

  @ApiProperty({ maxLength: 10000, example: '总结今日市场变化与自选股风险。' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  prompt: string

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, default: {} })
  @IsOptional()
  @IsObject()
  input: Record<string, unknown> = {}

  @ApiProperty({ enum: AGENT_CAPABILITIES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AGENT_CAPABILITIES.length)
  allowedCapabilities: AgentCapability[]

  @ApiPropertyOptional({ type: RequiredWatermarkDto, isArray: true, maxItems: 1, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((entry: RequiredWatermarkDto) => entry.dataset)
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequiredWatermarkDto)
  requiredWatermarks: RequiredWatermarkDto[] = []

  @ApiPropertyOptional({ default: 'stock_research' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,127}$/)
  workflowKey: string = 'stock_research'

  @ApiPropertyOptional({ default: STOCK_RESEARCH_WORKFLOW_CURRENT.version, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  workflowVersion: number = STOCK_RESEARCH_WORKFLOW_CURRENT.version

  @ApiPropertyOptional({ enum: AiModelPolicy, default: AiModelPolicy.AUTO })
  @IsOptional()
  @IsEnum(AiModelPolicy)
  modelPolicy: AiModelPolicy = AiModelPolicy.AUTO

  @ApiPropertyOptional({ nullable: true, maxLength: 128 })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  preferredModel: string | null = null

  @ApiProperty({ minimum: 0.01, maximum: 10000, example: 2 })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsNumber({ maxDecimalPlaces: 8, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(10_000)
  maxCostCny: number
}

export class ListScheduledResearchDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(SCHEDULE_ID_PATTERN)
  cursor: string | null = null

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30

  @ApiPropertyOptional({ enum: AiScheduledTaskStatus })
  @IsOptional()
  @IsEnum(AiScheduledTaskStatus)
  status?: AiScheduledTaskStatus

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeDeleted: boolean = false
}

export class ScheduledResearchIdDto {
  @ApiProperty()
  @IsString()
  @Matches(SCHEDULE_ID_PATTERN)
  taskId: string
}

export class UpdateScheduledResearchDto extends ScheduledResearchIdDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion: number

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @ApiPropertyOptional({ enum: AiScheduledTaskTrigger })
  @IsOptional()
  @IsEnum(AiScheduledTaskTrigger)
  trigger?: AiScheduledTaskTrigger

  @ApiPropertyOptional({ nullable: true, maxLength: 128 })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  cronExpression?: string | null

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timeZone?: string

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? new Date(value) : value))
  oneTimeAt?: Date | null

  @ApiPropertyOptional({ nullable: true, type: StructuredConditionDto })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @ValidateNested()
  @Type(() => StructuredConditionDto)
  condition?: StructuredConditionDto | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tradingDayOnly?: boolean

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  prompt?: string

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>

  @ApiPropertyOptional({ enum: AGENT_CAPABILITIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AGENT_CAPABILITIES.length)
  allowedCapabilities?: AgentCapability[]

  @ApiPropertyOptional({ type: RequiredWatermarkDto, isArray: true, maxItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayUnique((entry: RequiredWatermarkDto) => entry.dataset)
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequiredWatermarkDto)
  requiredWatermarks?: RequiredWatermarkDto[]

  @ApiPropertyOptional({ enum: AiModelPolicy })
  @IsOptional()
  @IsEnum(AiModelPolicy)
  modelPolicy?: AiModelPolicy

  @ApiPropertyOptional({ nullable: true, maxLength: 128 })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  preferredModel?: string | null

  @ApiPropertyOptional({ minimum: 0.01, maximum: 10000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsNumber({ maxDecimalPlaces: 8, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(10_000)
  maxCostCny?: number
}

export class ScheduledResearchVersionDto extends ScheduledResearchIdDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion: number
}

export class RunScheduledResearchDto extends ScheduledResearchIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clientRequestId: string
}

export class ListScheduledResearchExecutionsDto extends ScheduledResearchIdDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(SCHEDULE_ID_PATTERN)
  cursor: string | null = null

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30
}
