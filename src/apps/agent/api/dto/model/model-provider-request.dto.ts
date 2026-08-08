import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
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

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/
const REASONING_EFFORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const PROVIDER_KINDS = [
  'openai-compatible',
  'openai-chat-compatible',
  'openai-responses',
  'anthropic-messages',
] as const
const CAPABILITIES = [
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'PARALLEL_TOOL_CALLING',
  'VISION',
  'REASONING_EFFORT',
] as const
const REASONING_EFFORTS = ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'] as const
const DATA_CLASSES = ['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'] as const

export class ListModelProvidersDto {}

export class ModelProviderIdDto {
  @ApiProperty({ pattern: ID_PATTERN.source })
  @IsString()
  @Matches(ID_PATTERN)
  id: string
}

export class CreateModelProviderDto {
  @ApiProperty({ pattern: ID_PATTERN.source, example: 'deepseek', description: '可被多个模型配置复用的供应商标识' })
  @IsString()
  @Matches(ID_PATTERN)
  providerId: string

  @ApiProperty({ enum: PROVIDER_KINDS })
  @IsIn(PROVIDER_KINDS)
  kind: (typeof PROVIDER_KINDS)[number]

  @ApiProperty({ maxLength: 128 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  displayName: string

  @ApiProperty({ maxLength: 256, pattern: MODEL_ID_PATTERN.source, example: 'gpt-5.6-sol' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'model 仅允许字母、数字及 . _ : / @ -' })
  model: string

  @ApiProperty({ minimum: 0, maximum: 1000, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority: number = 0

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' })
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  costTier: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'

  @ApiPropertyOptional({ format: 'uri', description: 'OpenAI-compatible API 根地址，生产必须是 allowlist 中的 HTTPS' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'baseUrl 必须是 HTTP(S) URL' })
  baseUrl?: string

  @ApiPropertyOptional({ writeOnly: true, minLength: 1, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  apiKey?: string

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

  @ApiProperty({ enum: CAPABILITIES, isArray: true })
  @IsArray()
  @IsIn(CAPABILITIES, { each: true })
  capabilities: string[]

  @ApiProperty({
    enum: REASONING_EFFORTS,
    isArray: true,
    description: '支持内置档位与经适配器验证的供应商原生档位',
  })
  @IsArray()
  @Matches(REASONING_EFFORT_PATTERN, { each: true, message: 'reasoningEfforts 包含非法档位' })
  reasoningEfforts: string[]

  @ApiProperty({ enum: DATA_CLASSES, isArray: true })
  @IsArray()
  @IsIn(DATA_CLASSES, { each: true })
  dataClasses: string[]

  @ApiProperty({ minimum: 100, maximum: 300000, default: 120000 })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(300_000)
  timeoutMs: number = 120_000

  @ApiProperty({ minimum: 0, maximum: 2, default: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2)
  maxRetries: number = 2

  @ApiProperty({ minimum: 0, maximum: 10000, default: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  retryBaseMs: number = 200

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled = true
}

export class UpdateModelProviderDto extends ModelProviderIdDto {
  @ApiPropertyOptional({ pattern: ID_PATTERN.source, description: '可被多个模型配置复用的供应商标识' })
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN)
  providerId?: string

  @ApiPropertyOptional({ enum: PROVIDER_KINDS })
  @IsOptional()
  @IsIn(PROVIDER_KINDS)
  kind?: (typeof PROVIDER_KINDS)[number]

  @ApiPropertyOptional({ maxLength: 256, pattern: MODEL_ID_PATTERN.source })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  displayName?: string

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(MODEL_ID_PATTERN, { message: 'model 仅允许字母、数字及 . _ : / @ -' })
  model?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  costTier?: 'LOW' | 'MEDIUM' | 'HIGH'

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'baseUrl 必须是 HTTP(S) URL' })
  baseUrl?: string | null

  @ApiPropertyOptional({ writeOnly: true, minLength: 1, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  apiKey?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 10000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  contextWindow?: number

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxOutputTokens?: number

  @ApiPropertyOptional({ enum: CAPABILITIES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(CAPABILITIES, { each: true })
  capabilities?: string[]

  @ApiPropertyOptional({ enum: REASONING_EFFORTS, isArray: true })
  @IsOptional()
  @IsArray()
  @Matches(REASONING_EFFORT_PATTERN, { each: true, message: 'reasoningEfforts 包含非法档位' })
  reasoningEfforts?: string[]

  @ApiPropertyOptional({ enum: DATA_CLASSES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(DATA_CLASSES, { each: true })
  dataClasses?: string[]

  @ApiPropertyOptional({ minimum: 100, maximum: 300000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(300_000)
  timeoutMs?: number

  @ApiPropertyOptional({ minimum: 0, maximum: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2)
  maxRetries?: number

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  retryBaseMs?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}
