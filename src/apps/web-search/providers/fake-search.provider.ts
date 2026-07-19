import { WebSearchError } from '../web-search.errors'
import type {
  ProviderSearchHit,
  ProviderSearchQuery,
  ProviderSearchResult,
  WebSearchProvider,
} from '../web-search.provider'

export class FakeSearchProvider implements WebSearchProvider {
  readonly name = 'fake'

  constructor(private readonly fixtures: readonly ProviderSearchHit[] = []) {}

  async search(query: ProviderSearchQuery, signal: AbortSignal): Promise<ProviderSearchResult> {
    if (signal.aborted) throw new WebSearchError('CANCELLED', '搜索已取消')
    const queryTerms = query.query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = this.fixtures.filter((hit) => {
      const haystack = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase()
      return queryTerms.every((term) => haystack.includes(term))
    })
    return {
      provider: this.name,
      hits: matches.slice(0, query.resultLimit),
      truncated: matches.length > query.resultLimit,
    }
  }
}
