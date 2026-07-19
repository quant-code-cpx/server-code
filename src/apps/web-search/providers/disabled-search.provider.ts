import { WebSearchError } from '../web-search.errors'
import type { ProviderSearchResult, WebSearchProvider } from '../web-search.provider'

export class DisabledSearchProvider implements WebSearchProvider {
  readonly name = 'disabled'

  async search(): Promise<ProviderSearchResult> {
    throw new WebSearchError('UPSTREAM_FAILED', '联网搜索供应商未启用')
  }
}
