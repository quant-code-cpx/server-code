import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { NewsHttpException } from '../news.errors'
import {
  NEWS_FEED_PROVIDERS,
  type NewsContentTypeValue,
  type NewsFeedCapability,
  type NewsFeedProvider,
  type NewsSourceTypeValue,
} from '../domain/news.types'
import { AKSHARE_FEEDS, AKSHARE_PROVIDER_KEY } from './akshare-news.provider'
import { GDELT_PROVIDER_KEY, GDELT_TOPICS } from './gdelt-news.provider'

@Injectable()
export class NewsProviderRegistry implements OnModuleInit {
  private readonly providerByKey = new Map<string, NewsFeedProvider>()
  private readonly capabilityByFeed = new Map<string, NewsFeedCapability>()

  constructor(
    @Inject(NEWS_FEED_PROVIDERS) providers: readonly NewsFeedProvider[],
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
  ) {
    for (const provider of providers) {
      if (this.providerByKey.has(provider.providerKey)) throw new Error(`[News] Provider 重复：${provider.providerKey}`)
      this.providerByKey.set(provider.providerKey, provider)
    }
    for (const capability of buildCapabilities(config)) {
      if (this.capabilityByFeed.has(capability.feedKey)) throw new Error(`[News] Feed 重复：${capability.feedKey}`)
      this.capabilityByFeed.set(capability.feedKey, capability)
    }
  }

  onModuleInit(): void {
    const publicContentTypes: readonly NewsContentTypeValue[] = ['NOTICE', 'NEWS', 'FLASH']
    for (const contentType of publicContentTypes) {
      if (
        ![...this.capabilityByFeed.values()].some(
          (feed) => feed.requiredForCompleteness && feed.contentTypes.includes(contentType),
        )
      ) {
        throw new Error(`[News] ${contentType} 没有 completeness feed`)
      }
    }
  }

  allCapabilities(): readonly NewsFeedCapability[] {
    return [...this.capabilityByFeed.values()].sort(
      (left, right) => left.providerKey.localeCompare(right.providerKey) || left.feedKey.localeCompare(right.feedKey),
    )
  }

  scheduledCapabilities(): readonly NewsFeedCapability[] {
    return this.allCapabilities().filter((feed) => feed.enabled && feed.scheduleMode === 'SCHEDULED')
  }

  relevantCapabilities(filter?: {
    contentTypes?: readonly NewsContentTypeValue[]
    sourceTypes?: readonly NewsSourceTypeValue[]
    feedKeys?: readonly string[]
  }): readonly NewsFeedCapability[] {
    return this.allCapabilities().filter((feed) => {
      if (filter?.feedKeys && !filter.feedKeys.includes(feed.feedKey)) return false
      if (filter?.contentTypes && !filter.contentTypes.some((type) => feed.contentTypes.includes(type))) return false
      if (filter?.sourceTypes && !filter.sourceTypes.includes(feed.sourceType)) return false
      return true
    })
  }

  getCapability(providerKey: string, feedKey: string): NewsFeedCapability {
    const capability = this.capabilityByFeed.get(feedKey)
    if (!capability || capability.providerKey !== providerKey) {
      throw NewsHttpException.fromKey('NEWS_PROVIDER_OR_FEED_NOT_FOUND')
    }
    return capability
  }

  getProvider(providerKey: string, feedKey: string): NewsFeedProvider {
    const capability = this.getCapability(providerKey, feedKey)
    if (!capability.enabled) throw NewsHttpException.fromKey('NEWS_PROVIDER_DISABLED')
    const provider = this.providerByKey.get(providerKey)
    if (!provider || !provider.supportedFeeds.includes(feedKey)) {
      throw NewsHttpException.fromKey('NEWS_PROVIDER_OR_FEED_NOT_FOUND')
    }
    return provider
  }
}

function buildCapabilities(config: INewsConfig): NewsFeedCapability[] {
  const akshareEnabled = config.enabled && config.bridge.enabled
  const gdeltEnabled = config.enabled && config.gdelt.enabled
  const capabilities: NewsFeedCapability[] = [
    feed(
      AKSHARE_PROVIDER_KEY,
      'AKShare',
      AKSHARE_FEEDS.EASTMONEY,
      '东方财富全球财经快讯',
      'MEDIA',
      ['NEWS'],
      120,
      true,
      akshareEnabled,
    ),
    feed(
      AKSHARE_PROVIDER_KEY,
      'AKShare',
      AKSHARE_FEEDS.CLS,
      '财联社电报',
      'MEDIA',
      ['FLASH'],
      60,
      true,
      akshareEnabled,
    ),
    feed(
      AKSHARE_PROVIDER_KEY,
      'AKShare',
      AKSHARE_FEEDS.NOTICE_TODAY,
      'A股当日公告',
      'EXCHANGE',
      ['NOTICE'],
      600,
      true,
      akshareEnabled,
    ),
    feed(
      AKSHARE_PROVIDER_KEY,
      'AKShare',
      AKSHARE_FEEDS.NOTICE_PREVIOUS,
      'A股前日公告复查',
      'EXCHANGE',
      ['NOTICE'],
      3_600,
      false,
      akshareEnabled,
    ),
    {
      ...feed(
        AKSHARE_PROVIDER_KEY,
        'AKShare',
        AKSHARE_FEEDS.NOTICE_BACKFILL,
        '个股公告回补',
        'EXCHANGE',
        ['NOTICE'],
        null,
        false,
        akshareEnabled,
      ),
      scheduleMode: 'ON_DEMAND',
    },
  ]
  for (const feedKey of Object.keys(GDELT_TOPICS)) {
    capabilities.push(
      feed(
        GDELT_PROVIDER_KEY,
        'GDELT',
        feedKey,
        `GDELT ${feedKey.split('.').at(-1)}`,
        'AGGREGATOR',
        ['NEWS'],
        900,
        false,
        gdeltEnabled,
      ),
    )
  }
  return capabilities
}

function feed(
  providerKey: string,
  providerDisplayName: string,
  feedKey: string,
  feedDisplayName: string,
  sourceType: NewsSourceTypeValue,
  contentTypes: readonly NewsContentTypeValue[],
  expectedIntervalSeconds: number | null,
  requiredForCompleteness: boolean,
  enabled: boolean,
): NewsFeedCapability {
  return {
    providerKey,
    providerDisplayName,
    feedKey,
    feedDisplayName,
    sourceType,
    contentTypes,
    scheduleMode: 'SCHEDULED',
    expectedIntervalSeconds,
    requiredForCompleteness,
    enabled,
  }
}
