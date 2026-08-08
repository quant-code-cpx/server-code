import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export const MODEL_ADAPTER_KINDS = ['openai-responses', 'openai-chat-compatible', 'anthropic-messages'] as const
export const MODEL_CAPABILITIES = [
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'PARALLEL_TOOL_CALLING',
  'VISION',
  'REASONING_EFFORT',
] as const
export const MODEL_DATA_CLASSES = ['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'] as const
export const MODEL_REASONING_MODES = ['AUTO', 'DISABLED', 'EFFORT', 'TOKEN_BUDGET'] as const

const CONNECTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/
const REASONING_EFFORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const UUID_OR_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export class EmptyModelConsoleDto {}

export class ListModelConnectionsDto {
  @ApiPropertyOptional({ enum: ['ALL', 'ENABLED', 'DISABLED', 'FAILED'] })
  @IsOptional()
  @IsIn(['ALL', 'ENABLED', 'DISABLED', 'FAILED'])
  status?: 'ALL' | 'ENABLED' | 'DISABLED' | 'FAILED'
}

export class CreateModelConnectionDto {
  @ApiProperty({ pattern: CONNECTION_KEY_PATTERN.source, example: 'fishxcode-relay' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(CONNECTION_KEY_PATTERN, { message: 'connectionKey 仅允许英文、数字、下划线和连字符' })
  connectionKey: string

  @ApiProperty({ enum: MODEL_ADAPTER_KINDS })
  @IsIn(MODEL_ADAPTER_KINDS)
  adapterKind: (typeof MODEL_ADAPTER_KINDS)[number]

  @ApiProperty({ maxLength: 128, example: 'FishXCode 中转站' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  displayName: string

  @ApiProperty({ format: 'uri' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\/$/, '') : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'baseUrl 必须是 HTTP(S) URL' })
  baseUrl: string

  @ApiProperty({ writeOnly: true, minLength: 1, maxLength: 512 })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  apiKey: string

  @ApiPropertyOptional({ default: false, description: '新连接默认保存为未启用草稿' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateModelConnectionPatchDto extends PartialType(CreateModelConnectionDto) {
  @ApiPropertyOptional({ writeOnly: true, minLength: 1, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  declare apiKey?: string
}

export class UpdateModelConnectionDto extends UpdateModelConnectionPatchDto {
  @ApiProperty({ pattern: UUID_OR_ID_PATTERN.source })
  @IsString()
  @Matches(UUID_OR_ID_PATTERN)
  id: string

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number
}

export class ModelConnectionIdDto {
  @ApiProperty({ pattern: UUID_OR_ID_PATTERN.source })
  @IsString()
  @Matches(UUID_OR_ID_PATTERN)
  id: string
}

export class TestModelConnectionDto extends ModelConnectionIdDto {
  @ApiPropertyOptional({ enum: ['AUTH', 'STREAM'], default: 'AUTH' })
  @IsOptional()
  @IsIn(['AUTH', 'STREAM'])
  level?: 'AUTH' | 'STREAM'
}

export class ListModelDeploymentsDto {
  @ApiPropertyOptional({ pattern: UUID_OR_ID_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(UUID_OR_ID_PATTERN)
  connectionId?: string
}

export class CreateModelDeploymentDto {
  @ApiProperty({ pattern: UUID_OR_ID_PATTERN.source })
  @IsString()
  @Matches(UUID_OR_ID_PATTERN)
  connectionId: string

  @ApiProperty({ pattern: MODEL_ID_PATTERN.source, example: 'gpt-5.6-sol' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'modelId 仅允许字母、数字及 . _ : / @ -' })
  modelId: string

  @ApiProperty({ maxLength: 128 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  displayName: string

  @ApiProperty({ minimum: 0, maximum: 1000, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority: number

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' })
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  costTier: 'LOW' | 'MEDIUM' | 'HIGH'

  @ApiProperty({ minimum: 1, maximum: 10000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  contextWindow: number

  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxOutputTokens: number

  @ApiProperty({ enum: MODEL_CAPABILITIES, isArray: true })
  @IsArray()
  @ArrayMaxSize(MODEL_CAPABILITIES.length)
  @ArrayUnique()
  @IsIn(MODEL_CAPABILITIES, { each: true })
  capabilities: string[]

  @ApiProperty({ enum: MODEL_REASONING_MODES, default: 'AUTO' })
  @IsIn(MODEL_REASONING_MODES)
  reasoningMode: (typeof MODEL_REASONING_MODES)[number]

  @ApiProperty({ type: String, isArray: true, description: '适配器已知或供应商原生推理档位' })
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @Matches(REASONING_EFFORT_PATTERN, { each: true, message: 'reasoningEfforts 包含非法档位' })
  reasoningEfforts: string[]

  @ApiPropertyOptional({ pattern: REASONING_EFFORT_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(REASONING_EFFORT_PATTERN)
  defaultReasoningEffort?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  reasoningBudgetTokens?: number

  @ApiProperty({ enum: MODEL_DATA_CLASSES, isArray: true })
  @IsArray()
  @ArrayMaxSize(MODEL_DATA_CLASSES.length)
  @ArrayUnique()
  @IsIn(MODEL_DATA_CLASSES, { each: true })
  dataClasses: string[]

  @ApiProperty({ minimum: 100, maximum: 300000, default: 120000 })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(300_000)
  timeoutMs: number

  @ApiProperty({ minimum: 0, maximum: 2, default: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2)
  maxRetries: number

  @ApiProperty({ minimum: 0, maximum: 10000, default: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  retryBaseMs: number

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateModelDeploymentDto extends PartialType(CreateModelDeploymentDto) {
  @ApiProperty({ pattern: UUID_OR_ID_PATTERN.source })
  @IsString()
  @Matches(UUID_OR_ID_PATTERN)
  id: string

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number
}

export class ModelDeploymentIdDto extends ModelConnectionIdDto {}

export class ProbeModelDeploymentDto extends ModelDeploymentIdDto {
  @ApiPropertyOptional({ default: false, description: '深度探测会产生一次最小模型调用' })
  @IsOptional()
  @IsBoolean()
  confirmBillable?: boolean
}
