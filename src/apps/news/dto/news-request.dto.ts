import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import { NEWS_CONTENT_TYPES, NEWS_SOURCE_TYPES } from '../domain/news.types'

export const NEWS_SCOPES = ['ALL', 'WATCHLIST', 'PORTFOLIO', 'SECURITIES'] as const
export type NewsScope = (typeof NEWS_SCOPES)[number]
export const NEWS_INGESTION_OPERATIONS = ['POLL_FEED', 'BACKFILL_SECURITY_NOTICES'] as const
export type NewsIngestionOperationValue = (typeof NEWS_INGESTION_OPERATIONS)[number]
const TS_CODE = /^\d{6}\.(SH|SZ|BJ)$/
const CUID = /^[a-z0-9]{20,32}$/
const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RFC3339_WITH_ZONE = /(Z|[+-]\d{2}:\d{2})$/

export class EmptyNewsRequestDto {}

export class NewsArticleListRequestDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cursor?: string

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30

  @ApiPropertyOptional({ enum: NEWS_SCOPES, default: 'ALL' })
  @IsOptional()
  @IsIn(NEWS_SCOPES)
  scope: NewsScope = 'ALL'

  @ApiPropertyOptional({ type: String, isArray: true, minItems: 1, maxItems: 20, pattern: TS_CODE.source })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(TS_CODE, { each: true })
  securityCodes?: string[]

  @ApiPropertyOptional({ minLength: 2, maxLength: 64 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().normalize('NFKC') : value))
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  keyword?: string

  @ApiPropertyOptional({ enum: NEWS_CONTENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NEWS_CONTENT_TYPES.length)
  @ArrayUnique()
  @IsIn(NEWS_CONTENT_TYPES, { each: true })
  contentTypes?: Array<(typeof NEWS_CONTENT_TYPES)[number]>

  @ApiPropertyOptional({ enum: NEWS_SOURCE_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NEWS_SOURCE_TYPES.length)
  @ArrayUnique()
  @IsIn(NEWS_SOURCE_TYPES, { each: true })
  sourceTypes?: Array<(typeof NEWS_SOURCE_TYPES)[number]>

  @ApiPropertyOptional({ format: 'date-time', example: '2026-08-01T00:00:00.000+08:00' })
  @IsOptional()
  @IsString()
  @Matches(RFC3339_WITH_ZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  publishedAfter?: string

  @ApiPropertyOptional({ format: 'date-time', example: '2026-08-06T00:00:00.000+08:00' })
  @IsOptional()
  @IsString()
  @Matches(RFC3339_WITH_ZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  publishedBefore?: string

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeUnknownPublishedTime: boolean = false
}

export class NewsArticleDetailRequestDto {
  @ApiProperty({ pattern: CUID.source })
  @IsString()
  @Matches(CUID)
  articleId: string
}

export class NewsHighlightsRequestDto {
  @ApiProperty({ enum: ['ALL'], default: 'ALL' })
  @IsIn(['ALL'])
  scope = 'ALL' as const

  @ApiProperty({ minimum: 1, maximum: 5, default: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  limit: number = 5
}

export class NewsIngestionRunRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Matches(LOWERCASE_UUID_V4)
  clientRequestId: string

  @ApiProperty({ enum: NEWS_INGESTION_OPERATIONS })
  @IsIn(NEWS_INGESTION_OPERATIONS)
  operation: NewsIngestionOperationValue

  @ApiPropertyOptional({ pattern: '^[A-Z0-9_]{1,32}$' })
  @ValidateIf((object: NewsIngestionRunRequestDto) => object.operation === 'POLL_FEED')
  @IsString()
  @Matches(/^[A-Z0-9_]{1,32}$/)
  providerKey?: string

  @ApiPropertyOptional({ pattern: '^[a-z0-9._-]{1,96}$' })
  @ValidateIf((object: NewsIngestionRunRequestDto) => object.operation === 'POLL_FEED')
  @IsString()
  @Matches(/^[a-z0-9._-]{1,96}$/)
  feedKey?: string

  @ApiPropertyOptional({ type: String, isArray: true, minItems: 1, maxItems: 20, pattern: TS_CODE.source })
  @ValidateIf((object: NewsIngestionRunRequestDto) => object.operation === 'BACKFILL_SECURITY_NOTICES')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(TS_CODE, { each: true })
  securityCodes?: string[]

  @ApiPropertyOptional({ format: 'date', example: '2026-08-01' })
  @ValidateIf((object: NewsIngestionRunRequestDto) => object.operation === 'BACKFILL_SECURITY_NOTICES')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  beginDate?: string

  @ApiPropertyOptional({ format: 'date', example: '2026-08-06' })
  @ValidateIf((object: NewsIngestionRunRequestDto) => object.operation === 'BACKFILL_SECURITY_NOTICES')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string
}

export class NewsIngestionPollFeedRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Matches(LOWERCASE_UUID_V4)
  clientRequestId: string

  @ApiProperty({ enum: ['POLL_FEED'] })
  @IsIn(['POLL_FEED'])
  operation: 'POLL_FEED'

  @ApiProperty({ pattern: '^[A-Z0-9_]{1,32}$' })
  @IsString()
  @Matches(/^[A-Z0-9_]{1,32}$/)
  providerKey: string

  @ApiProperty({ pattern: '^[a-z0-9._-]{1,96}$' })
  @IsString()
  @Matches(/^[a-z0-9._-]{1,96}$/)
  feedKey: string
}

export class NewsIngestionBackfillSecurityNoticesRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Matches(LOWERCASE_UUID_V4)
  clientRequestId: string

  @ApiProperty({ enum: ['BACKFILL_SECURITY_NOTICES'] })
  @IsIn(['BACKFILL_SECURITY_NOTICES'])
  operation: 'BACKFILL_SECURITY_NOTICES'

  @ApiProperty({ type: String, isArray: true, minItems: 1, maxItems: 20, pattern: TS_CODE.source })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(TS_CODE, { each: true })
  securityCodes: string[]

  @ApiProperty({ format: 'date', example: '2026-08-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  beginDate: string

  @ApiProperty({ format: 'date', example: '2026-08-06' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string
}

export class NewsIngestionStatusRequestDto {
  @ApiProperty({ pattern: CUID.source })
  @IsString()
  @Matches(CUID)
  commandId: string
}
