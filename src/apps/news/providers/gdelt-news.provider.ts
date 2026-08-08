import { Inject, Injectable } from '@nestjs/common'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { sha256, stableJson } from '../domain/news-identity'
import { rejectProviderItem } from '../domain/news-rejection'
import {
  NEWS_HTTP_TRANSPORT,
  type NewsFeedProvider,
  type NewsFetchRequest,
  type NewsHttpTransport,
  type NewsProviderBatch,
  type ProviderNewsItem,
} from '../domain/news.types'
import { NewsProviderError } from './news-provider.errors'

export const GDELT_PROVIDER_KEY = 'GDELT'
export const GDELT_FALLBACK_RETRY_AFTER_MS = 15 * 60_000
export const GDELT_TOPICS = Object.freeze({
  'gdelt.risk.policy': '("monetary policy" OR "financial regulation" OR "central bank policy")',
  'gdelt.risk.sanctions': '(sanctions OR "export controls" OR "technology restrictions")',
  'gdelt.risk.geopolitics': '(war OR "geopolitical conflict" OR "military escalation")',
  'gdelt.risk.trade': '(tariff OR "trade restriction" OR "trade dispute")',
  'gdelt.risk.supply-chain': '("supply chain disruption" OR "shipping disruption" OR "critical shortage")',
} as const)

interface GdeltResponse {
  articles?: Array<{
    url?: string
    url_mobile?: string
    title?: string
    seendate?: string
    domain?: string
    language?: string
    sourcecountry?: string
  }>
}

@Injectable()
export class GdeltNewsProvider implements NewsFeedProvider {
  readonly providerKey = GDELT_PROVIDER_KEY
  readonly supportedFeeds = Object.keys(GDELT_TOPICS)
  private nextAllowedAt = 0
  private rateLimitTail: Promise<void> = Promise.resolve()

  constructor(
    @Inject(NEWS_HTTP_TRANSPORT) private readonly http: NewsHttpTransport,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
  ) {}

  async fetch(request: NewsFetchRequest, signal: AbortSignal): Promise<NewsProviderBatch> {
    const query = GDELT_TOPICS[request.feedKey as keyof typeof GDELT_TOPICS]
    if (!query) throw new NewsProviderError('INVALID_ARGUMENT', false, '未注册 GDELT feed')
    await this.waitForRateLimit(signal)
    const url = new URL(this.config.gdelt.baseUrl)
    url.searchParams.set('query', query)
    url.searchParams.set('mode', 'artlist')
    url.searchParams.set('format', 'json')
    url.searchParams.set('sort', 'datedesc')
    url.searchParams.set('timespan', '45min')
    url.searchParams.set('maxrecords', '250')
    let response: GdeltResponse
    try {
      response = await this.http.requestJson<GdeltResponse>({
        url: url.toString(),
        method: 'GET',
        timeoutMs: this.config.gdelt.timeoutMs,
        signal,
      })
    } catch (error) {
      if (!(error instanceof NewsProviderError) || error.code !== 'UPSTREAM_RATE_LIMITED') throw error
      const retryAfterMs = Math.min(
        GDELT_FALLBACK_RETRY_AFTER_MS,
        Math.max(0, error.retryAfterMs ?? GDELT_FALLBACK_RETRY_AFTER_MS),
      )
      this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + retryAfterMs)
      throw new NewsProviderError(error.code, true, error.message, retryAfterMs)
    }
    if (!response || !Array.isArray(response.articles)) {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, 'GDELT articles 字段非法')
    }
    const retrievedAt = new Date()
    const items: ProviderNewsItem[] = []
    const rejectedItems = []
    for (let index = 0; index < response.articles.length; index += 1) {
      const article = response.articles[index]
      try {
        items.push(this.mapArticle(article, index))
      } catch (error) {
        rejectedItems.push(rejectProviderItem(article, index, error))
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
      potentiallyTruncated: items.length === 250,
      warnings: items.length === 250 ? [{ code: 'POTENTIALLY_TRUNCATED', message: 'GDELT 返回达到 250 条上限' }] : [],
    }
  }

  private mapArticle(article: NonNullable<GdeltResponse['articles']>[number], index: number): ProviderNewsItem {
    if (!article.url || !article.title || !article.seendate) {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, `GDELT article ${index} 缺少 url/title/seendate`)
    }
    const discoveredAt = parseGdeltSeenDate(article.seendate)
    const metadata = {
      domain: article.domain ?? null,
      language: article.language ?? null,
      sourceCountry: article.sourcecountry ?? null,
      seenDate: article.seendate,
    }
    return {
      upstreamId: article.url,
      contentType: 'NEWS',
      title: article.title,
      excerpt: null,
      publisher: article.domain ?? null,
      canonicalUrl: article.url,
      alternateUrls: article.url_mobile ? [article.url_mobile] : [],
      publishedAt: null,
      publishedDate: null,
      publishedPrecision: 'UNKNOWN',
      sourceDiscoveredAt: discoveredAt,
      language: article.language ?? null,
      sourceCountry: article.sourcecountry ?? null,
      securityHints: [],
      category: 'gdelt-risk-v1',
      sourceMetadata: metadata,
      rawPayloadHash: sha256(stableJson(metadata)),
      qualityFlags: ['SOURCE_DISCOVERY_TIME_ONLY', 'PUBLISHED_TIME_UNKNOWN'],
    }
  }

  private async waitForRateLimit(signal: AbortSignal): Promise<void> {
    let release!: () => void
    const previous = this.rateLimitTail
    this.rateLimitTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      while (true) {
        const waitMs = Math.max(0, this.nextAllowedAt - Date.now())
        if (waitMs === 0) break
        await waitWithAbort(waitMs, signal)
      }
      this.nextAllowedAt = Date.now() + this.config.gdelt.minIntervalMs
    } finally {
      release()
    }
  }
}

function waitWithAbort(waitMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new NewsProviderError('UPSTREAM_TIMEOUT', true, 'GDELT 请求已取消'))
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new NewsProviderError('UPSTREAM_TIMEOUT', true, 'GDELT 请求已取消'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, waitMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function parseGdeltSeenDate(value: string): Date {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/)
  if (!match) throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, 'GDELT seendate 非法')
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  ) {
    throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, 'GDELT seendate 非法')
  }
  return date
}
