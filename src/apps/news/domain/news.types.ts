export const NEWS_CONTENT_TYPES = ['NOTICE', 'NEWS', 'FLASH'] as const
export type NewsContentTypeValue = (typeof NEWS_CONTENT_TYPES)[number]

export const NEWS_SOURCE_TYPES = [
  'REGULATOR',
  'EXCHANGE',
  'COMPANY',
  'MEDIA',
  'INSTITUTION',
  'AGGREGATOR',
  'OTHER',
] as const
export type NewsSourceTypeValue = (typeof NEWS_SOURCE_TYPES)[number]

export const NEWS_PUBLISHED_PRECISIONS = ['SECOND', 'MINUTE', 'DATE', 'UNKNOWN'] as const
export type NewsPublishedPrecisionValue = (typeof NEWS_PUBLISHED_PRECISIONS)[number]

export const NEWS_QUALITY_FLAGS = [
  'TRUNCATED',
  'GENERATED_TITLE',
  'MISSING_CANONICAL_URL',
  'UNRESOLVED_SECURITY',
  'POSSIBLE_SECURITY_OMISSION',
  'PUBLISHED_TIME_UNKNOWN',
  'SOURCE_DISCOVERY_TIME_ONLY',
] as const
export type NewsQualityFlag = (typeof NEWS_QUALITY_FLAGS)[number] | string

export const NEWS_CLOCK = Symbol('NEWS_CLOCK')
export const NEWS_HTTP_TRANSPORT = Symbol('NEWS_HTTP_TRANSPORT')
export const NEWS_FEED_PROVIDERS = Symbol('NEWS_FEED_PROVIDERS')

export interface NewsClock {
  now(): Date
}

export interface NewsFetchRequest {
  feedKey: string
  partitionKey: string
  windowStart?: Date
  windowEnd?: Date
  securityCodes?: readonly string[]
  providerCursor?: Readonly<Record<string, unknown>>
}

export interface NewsProviderWarning {
  code: string
  message: string
  affectsCompleteness?: boolean
}

export interface ProviderNewsItem {
  upstreamId: string
  contentType: NewsContentTypeValue
  title: string
  excerpt: string | null
  publisher: string | null
  canonicalUrl: string | null
  alternateUrls: readonly string[]
  publishedAt: Date | null
  publishedDate: string | null
  publishedPrecision: NewsPublishedPrecisionValue
  sourceDiscoveredAt: Date | null
  language: string | null
  sourceCountry: string | null
  securityHints: readonly string[]
  category: string | null
  sourceMetadata: Readonly<Record<string, unknown>>
  rawPayloadHash: string
  qualityFlags?: readonly string[]
}

export interface RejectedProviderNewsItem {
  itemKeyHash: string
  rawPayloadHash: string
  errorCode: string
  errorMessage: string
  fieldManifest: Record<string, unknown>
  retryable: boolean
}

export interface NewsProviderBatch {
  schemaVersion: 1
  providerKey: string
  feedKey: string
  partitionKey: string
  retrievedAt: Date
  items: readonly ProviderNewsItem[]
  rejectedItems?: readonly RejectedProviderNewsItem[]
  nextCursor: Readonly<Record<string, unknown>> | null
  potentiallyTruncated: boolean
  warnings: readonly NewsProviderWarning[]
}

export interface NewsFeedProvider {
  readonly providerKey: string
  readonly supportedFeeds: readonly string[]
  fetch(request: NewsFetchRequest, signal: AbortSignal): Promise<NewsProviderBatch>
}

export interface NewsHttpRequest {
  url: string
  method: 'GET' | 'POST'
  body?: unknown
  headers?: Readonly<Record<string, string>>
  timeoutMs: number
  maxResponseBytes?: number
  signal?: AbortSignal
}

export interface NewsHttpTransport {
  requestJson<T>(request: NewsHttpRequest): Promise<T>
}

export interface NormalizedNewsItem extends ProviderNewsItem {
  providerKey: string
  feedKey: string
  sourceType: NewsSourceTypeValue
  identityHash: string
  contentHash: string
  canonicalUrlHash: string | null
  normalizedTitle: string
  normalizedExcerpt: string | null
  timelineSortAt: Date
  qualityFlags: readonly string[]
}

export interface NewsFeedCapability {
  providerKey: string
  providerDisplayName: string
  feedKey: string
  feedDisplayName: string
  sourceType: NewsSourceTypeValue
  contentTypes: readonly NewsContentTypeValue[]
  scheduleMode: 'SCHEDULED' | 'ON_DEMAND'
  expectedIntervalSeconds: number | null
  requiredForCompleteness: boolean
  enabled: boolean
}
