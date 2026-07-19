import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentAuditModule } from 'src/apps/agent/audit/agent-audit.module'
import { WebSearchConfig, type IWebSearchConfig } from 'src/config/web-search.config'
import { BraveSearchProvider } from './providers/brave-search.provider'
import { DisabledSearchProvider } from './providers/disabled-search.provider'
import { FakeSearchProvider } from './providers/fake-search.provider'
import { HtmlContentExtractor } from './html-content.extractor'
import { SafeWebFetcherService } from './safe-web-fetcher.service'
import { SourceClassifierService } from './source-classifier.service'
import { NodeWebDnsResolver, SsrfPolicyService, WEB_DNS_RESOLVER, type WebDnsResolver } from './ssrf-policy.service'
import { UrlTokenService } from './url-token.service'
import { WebFetchService } from './web-fetch.service'
import { WEB_SEARCH_PROVIDER } from './web-search.provider'
import { WebSearchService } from './web-search.service'

@Module({
  imports: [ConfigModule.forFeature(WebSearchConfig), AgentAuditModule],
  providers: [
    NodeWebDnsResolver,
    { provide: WEB_DNS_RESOLVER, useExisting: NodeWebDnsResolver },
    {
      provide: SsrfPolicyService,
      inject: [WEB_DNS_RESOLVER],
      useFactory: (resolver: WebDnsResolver) => new SsrfPolicyService(resolver),
    },
    {
      provide: WEB_SEARCH_PROVIDER,
      inject: [WebSearchConfig.KEY],
      useFactory: (config: IWebSearchConfig) => {
        if (config.provider === 'brave') return new BraveSearchProvider(config)
        if (config.provider === 'fake') return new FakeSearchProvider()
        return new DisabledSearchProvider()
      },
    },
    UrlTokenService,
    SourceClassifierService,
    SafeWebFetcherService,
    HtmlContentExtractor,
    WebSearchService,
    WebFetchService,
  ],
  exports: [WebSearchService, WebFetchService],
})
export class WebSearchModule {}
