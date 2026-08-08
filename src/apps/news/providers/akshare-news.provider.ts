import { Inject, Injectable } from '@nestjs/common'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { sha256, stableJson } from '../domain/news-identity'
import { rejectProviderItem } from '../domain/news-rejection'
import { shanghaiCompactDate } from '../domain/news-time'
import {
  NEWS_HTTP_TRANSPORT,
  type NewsFeedProvider,
  type NewsFetchRequest,
  type NewsHttpTransport,
  type NewsProviderBatch,
  type ProviderNewsItem,
} from '../domain/news.types'
import { NewsProviderError } from './news-provider.errors'

export const AKSHARE_PROVIDER_KEY = 'AKSHARE'
export const AKSHARE_FEEDS = {
  EASTMONEY: 'akshare.eastmoney.global',
  CLS: 'akshare.cls.telegraph',
  NOTICE_TODAY: 'akshare.notice.daily.today',
  NOTICE_PREVIOUS: 'akshare.notice.daily.previous',
  NOTICE_BACKFILL: 'akshare.notice.security.backfill',
} as const

interface BridgeEnvelope {
  schemaVersion: number
  requestId: string
  retrievedAt: string
  items: BridgeItem[]
  warnings?: Array<{ code: string; message: string; affectsCompleteness?: boolean }>
}

interface BridgeItem {
  upstreamId?: string
  contentType: 'NOTICE' | 'NEWS' | 'FLASH'
  title?: string
  excerpt?: string | null
  publisher?: string | null
  canonicalUrl?: string | null
  alternateUrls?: string[]
  publishedAt?: string | null
  publishedDate?: string | null
  publishedPrecision: 'SECOND' | 'MINUTE' | 'DATE' | 'UNKNOWN'
  sourceDiscoveredAt?: string | null
  language?: string | null
  sourceCountry?: string | null
  securityHints?: string[]
  category?: string | null
  sourceMetadata?: Record<string, unknown>
  rawPayloadHash?: string
  qualityFlags?: string[]
}

@Injectable()
export class AkshareNewsProvider implements NewsFeedProvider {
  readonly providerKey = AKSHARE_PROVIDER_KEY
  readonly supportedFeeds = Object.values(AKSHARE_FEEDS)

  constructor(
    @Inject(NEWS_HTTP_TRANSPORT) private readonly http: NewsHttpTransport,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
  ) {}

  async fetch(request: NewsFetchRequest, signal: AbortSignal): Promise<NewsProviderBatch> {
    const route = this.routeFor(request)
    const envelope = await this.http.requestJson<BridgeEnvelope>({
      url: `${this.config.bridge.baseUrl}${route.path}`,
      method: 'POST',
      body: route.body,
      timeoutMs: this.config.bridge.timeoutMs,
      headers: { authorization: `Bearer ${this.config.bridge.token}` },
      signal,
    })
    if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.items)) {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, 'Bridge envelope schemaVersion/items 非法')
    }
    const retrievedAt = parseDate(envelope.retrievedAt, 'Bridge retrievedAt')
    const items: ProviderNewsItem[] = []
    const rejectedItems = []
    for (let index = 0; index < envelope.items.length; index += 1) {
      const item = envelope.items[index]
      try {
        items.push(this.mapItem(item, index))
      } catch (error) {
        rejectedItems.push(rejectProviderItem(item, index, error))
      }
    }
    return {
      schemaVersion: 1,
      providerKey: this.providerKey,
      feedKey: request.feedKey,
      partitionKey: request.partitionKey,
      retrievedAt,
      items,
      rejectedItems,
      nextCursor: null,
      potentiallyTruncated: envelope.warnings?.some((warning) => warning.code === 'POTENTIALLY_TRUNCATED') ?? false,
      warnings: envelope.warnings ?? [],
    }
  }

  private routeFor(request: NewsFetchRequest): { path: string; body: Record<string, unknown> } {
    if (request.feedKey === AKSHARE_FEEDS.EASTMONEY) return { path: '/v1/feeds/eastmoney/latest', body: {} }
    if (request.feedKey === AKSHARE_FEEDS.CLS) return { path: '/v1/feeds/cls/latest', body: { scope: 'ALL' } }
    if (request.feedKey === AKSHARE_FEEDS.NOTICE_TODAY || request.feedKey === AKSHARE_FEEDS.NOTICE_PREVIOUS) {
      const compact = /^\d{8}$/.test(request.partitionKey)
        ? request.partitionKey
        : shanghaiCompactDate(request.windowEnd ?? new Date())
      return { path: '/v1/notices/daily', body: { date: compact } }
    }
    if (request.feedKey === AKSHARE_FEEDS.NOTICE_BACKFILL) {
      const code = request.securityCodes?.[0]
      if (!code || request.securityCodes?.length !== 1 || !request.windowStart || !request.windowEnd) {
        throw new NewsProviderError('INVALID_ARGUMENT', false, '公告回补必须包含单一证券和日期范围')
      }
      return {
        path: '/v1/notices/security/range',
        body: {
          security: code.slice(0, 6),
          beginDate: shanghaiCompactDate(request.windowStart),
          endDate: shanghaiCompactDate(request.windowEnd),
        },
      }
    }
    throw new NewsProviderError('INVALID_ARGUMENT', false, '未注册 AKShare feed')
  }

  private mapItem(item: BridgeItem, index: number): ProviderNewsItem {
    if (!item || typeof item !== 'object' || !item.contentType || !item.publishedPrecision) {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, `Bridge item ${index} 缺少必填字段`)
    }
    const metadata = item.sourceMetadata ?? {}
    const hash = item.rawPayloadHash ?? sha256(stableJson(item))
    return {
      upstreamId: item.upstreamId ?? '',
      contentType: item.contentType,
      title: item.title ?? '',
      excerpt: item.excerpt ?? null,
      publisher: item.publisher ?? null,
      canonicalUrl: item.canonicalUrl ?? null,
      alternateUrls: item.alternateUrls ?? [],
      publishedAt: item.publishedAt ? parseDate(item.publishedAt, 'publishedAt') : null,
      publishedDate: item.publishedDate ?? null,
      publishedPrecision: item.publishedPrecision,
      sourceDiscoveredAt: item.sourceDiscoveredAt ? parseDate(item.sourceDiscoveredAt, 'sourceDiscoveredAt') : null,
      language: item.language ?? 'zh-CN',
      sourceCountry: item.sourceCountry ?? 'CN',
      securityHints: item.securityHints ?? [],
      category: item.category ?? null,
      sourceMetadata: metadata,
      rawPayloadHash: hash,
      qualityFlags: item.qualityFlags ?? [],
    }
  }
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, `${field} 非法`)
  return parsed
}
