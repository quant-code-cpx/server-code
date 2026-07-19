import type { IWebSearchConfig } from 'src/config/web-search.config'
import { WebSearchError } from '../web-search.errors'
import type {
  ProviderSearchHit,
  ProviderSearchQuery,
  ProviderSearchResult,
  WebSearchProvider,
} from '../web-search.provider'

interface BraveWebResult {
  title?: unknown
  url?: unknown
  description?: unknown
  page_age?: unknown
  age?: unknown
  language?: unknown
  profile?: { long_name?: unknown }
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] }
}

export class BraveSearchProvider implements WebSearchProvider {
  readonly name = 'brave'

  constructor(private readonly config: IWebSearchConfig) {}

  async search(query: ProviderSearchQuery, signal: AbortSignal): Promise<ProviderSearchResult> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new WebSearchError('UPSTREAM_FAILED', 'Brave Search 配置不完整')
    }
    const endpoint = new URL(this.config.baseUrl)
    endpoint.searchParams.set('q', appendDomainFilters(query.query, query.domains))
    endpoint.searchParams.set('count', String(query.resultLimit))
    if (query.language) endpoint.searchParams.set('search_lang', query.language === 'zh-CN' ? 'zh-hans' : 'en')

    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new WebSearchError('TIMEOUT', '搜索供应商请求超时', true)),
      this.config.timeoutMs,
    )

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.config.apiKey,
        },
      })
      if (response.status === 429) {
        throw new WebSearchError(
          'RATE_LIMITED',
          '搜索供应商限流',
          true,
          retryAfterMs(response.headers.get('retry-after')),
        )
      }
      if (!response.ok) throw new WebSearchError('UPSTREAM_FAILED', '搜索供应商响应失败', response.status >= 500)
      const raw = await response.text()
      if (Buffer.byteLength(raw, 'utf8') > 1_000_000) {
        throw new WebSearchError('RESULT_TOO_LARGE', '搜索供应商响应超过大小限制')
      }
      const parsed = JSON.parse(raw) as BraveResponse
      const providerHits = Array.isArray(parsed.web?.results) ? parsed.web.results : []
      const hits = providerHits.map(toProviderHit).filter((hit): hit is ProviderSearchHit => hit !== null)
      return { provider: this.name, hits: hits.slice(0, query.resultLimit), truncated: hits.length > query.resultLimit }
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      if (controller.signal.aborted) {
        if (signal.aborted) throw new WebSearchError('CANCELLED', '搜索已取消')
        throw new WebSearchError('TIMEOUT', '搜索供应商请求超时', true)
      }
      throw new WebSearchError('UPSTREAM_FAILED', '搜索供应商请求失败', true)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }
}

function appendDomainFilters(query: string, domains: readonly string[]): string {
  if (!domains.length) return query
  return `${query} (${domains.map((domain) => `site:${domain}`).join(' OR ')})`
}

function toProviderHit(value: BraveWebResult): ProviderSearchHit | null {
  const title = typeof value.title === 'string' ? plainText(value.title) : ''
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  if (!title || !url) return null
  return {
    title,
    url,
    snippet: typeof value.description === 'string' ? plainText(value.description) : '',
    publisher: typeof value.profile?.long_name === 'string' ? plainText(value.profile.long_name) : null,
    publishedAt: parseDate(value.page_age) ?? parseDate(value.age),
    language: typeof value.language === 'string' ? value.language : null,
  }
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000)
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000)
  const date = new Date(value).getTime()
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.min(date - Date.now(), 60_000))
}
