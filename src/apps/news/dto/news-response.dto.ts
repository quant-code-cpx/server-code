import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  NewsContentType,
  NewsIngestionOperation,
  NewsIngestionRunStatus,
  NewsPublishedPrecision,
  NewsSourceType,
} from '@prisma/client'

export const NEWS_COVERAGE_WARNING_CODES = [
  'FEED_UNAVAILABLE',
  'FEED_STALE',
  'FEED_DISABLED',
  'NO_SUCCESSFUL_SYNC',
  'FEED_SCHEMA_CHANGED',
  'POTENTIALLY_TRUNCATED',
  'PARTIAL_INGESTION',
  'SOURCE_WINDOW_LIMITED',
  'COVERAGE_UNKNOWN',
] as const

export class NewsCoverageWarningDto {
  @ApiProperty() warningId: string
  @ApiProperty({ enum: NEWS_COVERAGE_WARNING_CODES }) code: (typeof NEWS_COVERAGE_WARNING_CODES)[number]
  @ApiProperty({ enum: ['INFO', 'WARNING', 'ERROR'] }) severity: 'INFO' | 'WARNING' | 'ERROR'
  @ApiProperty() affectsCompleteness: boolean
  @ApiPropertyOptional({ nullable: true }) providerKey: string | null
  @ApiPropertyOptional({ nullable: true }) providerDisplayName: string | null
  @ApiPropertyOptional({ nullable: true }) feedKey: string | null
  @ApiPropertyOptional({ nullable: true }) feedDisplayName: string | null
  @ApiProperty() publicMessage: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThrough: string | null
  @ApiProperty({ format: 'date-time' }) observedAt: string
}

export class NewsFeedCoverageDto {
  @ApiProperty() providerKey: string
  @ApiProperty() providerDisplayName: string
  @ApiProperty() feedKey: string
  @ApiProperty() feedDisplayName: string
  @ApiProperty({ enum: NewsSourceType }) sourceType: NewsSourceType
  @ApiProperty({ enum: NewsContentType, isArray: true }) contentTypes: NewsContentType[]
  @ApiProperty({ enum: ['SCHEDULED', 'ON_DEMAND'] }) scheduleMode: 'SCHEDULED' | 'ON_DEMAND'
  @ApiProperty() requiredForCompleteness: boolean
  @ApiProperty({ enum: ['READY', 'DEGRADED', 'DISABLED'] }) status: 'READY' | 'DEGRADED' | 'DISABLED'
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastSuccessfulAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThrough: string | null
  @ApiPropertyOptional({ nullable: true }) expectedIntervalSeconds: number | null
  @ApiPropertyOptional({ nullable: true }) freshnessSeconds: number | null
  @ApiProperty() consecutiveFailures: number
  @ApiProperty() potentiallyTruncated: boolean
  @ApiPropertyOptional({ nullable: true, enum: NEWS_COVERAGE_WARNING_CODES }) reasonCode: string | null
  @ApiPropertyOptional({ nullable: true }) publicReason: string | null
}

export class NewsCoverageResponseDto {
  @ApiProperty({ format: 'date-time' }) generatedAt: string
  @ApiProperty({ enum: ['READY', 'DEGRADED', 'DISABLED'] }) overallStatus: 'READY' | 'DEGRADED' | 'DISABLED'
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThrough: string | null
  @ApiProperty() partial: boolean
  @ApiProperty({ type: NewsCoverageWarningDto, isArray: true }) warnings: NewsCoverageWarningDto[]
  @ApiProperty({ type: NewsFeedCoverageDto, isArray: true }) feeds: NewsFeedCoverageDto[]
}

export class NewsArticleListItemDto {
  @ApiProperty() articleId: string
  @ApiProperty({ minimum: 1 }) revision: number
  @ApiProperty({ enum: NewsContentType }) contentType: NewsContentType
  @ApiProperty({ enum: NewsSourceType }) sourceType: NewsSourceType
  @ApiProperty() title: string
  @ApiPropertyOptional({ nullable: true }) excerpt: string | null
  @ApiPropertyOptional({ nullable: true }) publisher: string | null
  @ApiPropertyOptional({ nullable: true }) canonicalUrl: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) publishedAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date' }) publishedDate: string | null
  @ApiProperty({ enum: NewsPublishedPrecision }) publishedPrecision: NewsPublishedPrecision
  @ApiProperty({ format: 'date-time' }) firstSeenAt: string
  @ApiProperty({ type: String, isArray: true }) securityCodes: string[]
  @ApiProperty({ type: String, isArray: true }) providerKeys: string[]
  @ApiProperty({ type: String, isArray: true }) qualityFlags: string[]
}

export class NewsArticleListResponseDto {
  @ApiProperty({ type: NewsArticleListItemDto, isArray: true }) items: NewsArticleListItemDto[]
  @ApiPropertyOptional({ nullable: true }) nextCursor: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThrough: string | null
  @ApiProperty() partial: boolean
  @ApiProperty({ type: NewsCoverageWarningDto, isArray: true }) warnings: NewsCoverageWarningDto[]
}

export const NEWS_IMPACT_REASON_CODES = [
  'AUTHORITATIVE_SOURCE',
  'BREAKING_EVENT',
  'CORROBORATED',
  'FRESHNESS',
  'MARKET_WIDE',
  'SECURITY_RELEVANCE',
] as const

export type NewsImpactReasonCode = (typeof NEWS_IMPACT_REASON_CODES)[number]

export class NewsHighlightItemDto extends NewsArticleListItemDto {
  @ApiProperty({ enum: ['CRITICAL', 'MAJOR', 'RECENT'] }) impactLevel: 'CRITICAL' | 'MAJOR' | 'RECENT'
  @ApiProperty({ minimum: 0 }) impactScore: number
  @ApiProperty({ enum: NEWS_IMPACT_REASON_CODES, isArray: true }) reasonCodes: NewsImpactReasonCode[]
  @ApiProperty({ minimum: 1 }) corroboratingSourceCount: number
  @ApiProperty({ minimum: 0 }) relatedArticleCount: number
}

export class NewsHighlightsResponseDto {
  @ApiProperty({ format: 'date-time' }) generatedAt: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThrough: string | null
  @ApiProperty() partial: boolean
  @ApiProperty({ type: NewsCoverageWarningDto, isArray: true }) warnings: NewsCoverageWarningDto[]
  @ApiProperty({ enum: ['impact-v1'] }) rankingVersion: 'impact-v1'
  @ApiProperty({ enum: ['READY', 'STALE', 'RECENT_FALLBACK'] })
  rankingStatus: 'READY' | 'STALE' | 'RECENT_FALLBACK'
  @ApiProperty({ enum: ['HIGHLIGHTS', 'RECENT'] }) displayMode: 'HIGHLIGHTS' | 'RECENT'
  @ApiProperty({ type: NewsHighlightItemDto, isArray: true }) items: NewsHighlightItemDto[]
}

export class NewsArticleSourceDto {
  @ApiProperty() providerKey: string
  @ApiProperty() providerDisplayName: string
  @ApiProperty() feedKey: string
  @ApiProperty() feedDisplayName: string
  @ApiProperty({ enum: NewsSourceType }) sourceType: NewsSourceType
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) sourceDiscoveredAt: string | null
  @ApiProperty({ format: 'date-time' }) firstSeenAt: string
  @ApiProperty({ format: 'date-time' }) lastSeenAt: string
  @ApiProperty({ format: 'date-time' }) retrievedAt: string
}

export class NewsArticleRevisionDto {
  @ApiProperty() revision: number
  @ApiProperty({ format: 'date-time' }) changedAt: string
  @ApiProperty({ type: String, isArray: true }) changedFields: string[]
  @ApiProperty() title: string
  @ApiPropertyOptional({ nullable: true }) excerpt: string | null
  @ApiPropertyOptional({ nullable: true }) publisher: string | null
  @ApiPropertyOptional({ nullable: true }) canonicalUrl: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) publishedAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date' }) publishedDate: string | null
  @ApiProperty({ enum: NewsPublishedPrecision }) publishedPrecision: NewsPublishedPrecision
}

export class NewsArticleSourceListDto {
  @ApiProperty({ type: NewsArticleSourceDto, isArray: true }) items: NewsArticleSourceDto[]
  @ApiProperty() total: number
  @ApiProperty() truncated: boolean
}

export class NewsArticleRevisionListDto {
  @ApiProperty({ type: NewsArticleRevisionDto, isArray: true }) items: NewsArticleRevisionDto[]
  @ApiProperty() total: number
  @ApiProperty() truncated: boolean
}

export class NewsArticleDetailResponseDto extends NewsArticleListItemDto {
  @ApiProperty({ type: String, isArray: true }) alternateUrls: string[]
  @ApiProperty({ type: NewsArticleSourceListDto }) sources: NewsArticleSourceListDto
  @ApiProperty({ type: NewsArticleRevisionListDto }) revisions: NewsArticleRevisionListDto
  @ApiProperty({ type: NewsCoverageResponseDto }) coverage: NewsCoverageResponseDto
}

export class NewsIngestionRunResponseDto {
  @ApiProperty() commandId: string
  @ApiProperty({ type: String, isArray: true }) runIds: string[]
  @ApiProperty({ enum: NewsIngestionRunStatus }) status: NewsIngestionRunStatus
  @ApiProperty() idempotentReplay: boolean
  @ApiProperty({ format: 'date-time' }) acceptedAt: string
}

export class NewsIngestionRunItemDto {
  @ApiProperty() runId: string
  @ApiProperty() providerKey: string
  @ApiProperty() feedKey: string
  @ApiProperty() partitionKey: string
  @ApiProperty({ enum: NewsIngestionRunStatus }) status: NewsIngestionRunStatus
  @ApiProperty() fetchedCount: number
  @ApiProperty() insertedCount: number
  @ApiProperty() revisedCount: number
  @ApiProperty() duplicateCount: number
  @ApiProperty() quarantinedCount: number
  @ApiProperty() potentiallyTruncated: boolean
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThroughBefore: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) dataThroughAfter: string | null
  @ApiPropertyOptional({ nullable: true }) errorCode: string | null
  @ApiPropertyOptional({ nullable: true }) errorMessage: string | null
  @ApiProperty({ format: 'date-time' }) createdAt: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) startedAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) finishedAt: string | null
}

export class NewsIngestionStatusResponseDto {
  @ApiProperty() commandId: string
  @ApiProperty({ format: 'uuid' }) clientRequestId: string
  @ApiProperty({ enum: NewsIngestionOperation }) operation: NewsIngestionOperation
  @ApiProperty({ enum: NewsIngestionRunStatus }) status: NewsIngestionRunStatus
  @ApiProperty({ format: 'date-time' }) acceptedAt: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) startedAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) finishedAt: string | null
  @ApiProperty({ type: NewsIngestionRunItemDto, isArray: true }) runs: NewsIngestionRunItemDto[]
}

export class NewsProviderAdminDto {
  @ApiProperty() providerKey: string
  @ApiProperty() providerDisplayName: string
  @ApiProperty() enabled: boolean
  @ApiProperty() contractVersion: string
  @ApiProperty({ enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] }) circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  @ApiProperty({ enum: ['UNKNOWN', 'AVAILABLE', 'THROTTLED', 'EXHAUSTED'] }) quotaStatus: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) quotaResetAt: string | null
  @ApiProperty({ type: NewsFeedCoverageDto, isArray: true }) feeds: NewsFeedCoverageDto[]
}

export class NewsProviderListResponseDto {
  @ApiProperty({ format: 'date-time' }) generatedAt: string
  @ApiProperty({ type: NewsProviderAdminDto, isArray: true }) providers: NewsProviderAdminDto[]
}
