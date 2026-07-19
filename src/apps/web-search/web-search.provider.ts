export const WEB_SEARCH_PROVIDER = Symbol('WEB_SEARCH_PROVIDER')

export type WebSourceType = 'OFFICIAL' | 'EXCHANGE' | 'REGULATOR' | 'COMPANY' | 'MEDIA' | 'INSTITUTION'

export interface ProviderSearchQuery {
  query: string
  resultLimit: number
  publishedAfter?: Date
  publishedBefore?: Date
  domains: readonly string[]
  language?: 'zh-CN' | 'en'
}

export interface ProviderSearchHit {
  url: string
  title: string
  snippet: string
  publisher?: string | null
  publishedAt?: Date | null
  language?: string | null
}

export interface ProviderSearchResult {
  provider: string
  hits: ProviderSearchHit[]
  truncated: boolean
}

export interface WebSearchProvider {
  readonly name: string
  search(query: ProviderSearchQuery, signal: AbortSignal): Promise<ProviderSearchResult>
}
