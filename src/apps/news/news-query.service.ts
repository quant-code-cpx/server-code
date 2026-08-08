import { Inject, Injectable } from '@nestjs/common'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { NewsCursorCodec } from './domain/news-cursor'
import { sha256, stableJson } from './domain/news-identity'
import { formatPrismaDate, resolveNewsWindow } from './domain/news-time'
import { NEWS_CLOCK, type NewsClock } from './domain/news.types'
import type { NewsArticleListRequestDto } from './dto/news-request.dto'
import type {
  NewsArticleDetailResponseDto,
  NewsArticleListItemDto,
  NewsArticleListResponseDto,
  NewsArticleRevisionDto,
} from './dto/news-response.dto'
import { NewsHttpException } from './news.errors'
import { NewsCoverageService } from './news-coverage.service'
import { NewsRepository } from './news.repository'
import { NewsProviderRegistry } from './providers/news-provider.registry'

@Injectable()
export class NewsQueryService {
  private readonly cursorCodec: NewsCursorCodec

  constructor(
    private readonly repository: NewsRepository,
    private readonly coverageService: NewsCoverageService,
    private readonly registry: NewsProviderRegistry,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
    @Inject(NEWS_CLOCK) private readonly clock: NewsClock,
  ) {
    this.cursorCodec = new NewsCursorCodec(
      config.cursorSecret || 'news-disabled-cursor-secret-not-for-production',
      config.cursorTtlSeconds,
    )
  }

  async list(userId: number, dto: NewsArticleListRequestDto): Promise<NewsArticleListResponseDto> {
    this.assertEnabled()
    this.assertScope(dto)
    const now = this.clock.now()
    const decoded = dto.cursor ? this.cursorCodec.decode(dto.cursor, now) : null
    const window = decoded
      ? { after: new Date(decoded.effectiveAfter), before: new Date(decoded.effectiveBefore) }
      : resolveNewsWindow(dto.publishedAfter, dto.publishedBefore, now)
    const scopeCodes = await this.repository.resolveScopeCodes(dto.scope, userId, dto.securityCodes)
    const scopeFingerprint = sha256(stableJson({ userId, scope: dto.scope, securityCodes: scopeCodes ?? null }))
    const queryHash = this.cursorCodec.hashQuery({
      userId,
      sortVersion: 'timeline-v1',
      scope: dto.scope,
      securityCodes: sorted(dto.securityCodes),
      limit: dto.limit,
      keyword: dto.keyword ?? null,
      contentTypes: sorted(dto.contentTypes),
      sourceTypes: sorted(dto.sourceTypes),
      includeUnknownPublishedTime: dto.includeUnknownPublishedTime,
      effectiveAfter: window.after.toISOString(),
      effectiveBefore: window.before.toISOString(),
    })
    if (decoded && (decoded.queryHash !== queryHash || decoded.scopeFingerprint !== scopeFingerprint)) {
      throw NewsHttpException.fromKey('NEWS_CURSOR_FILTER_MISMATCH')
    }

    const snapshotAt = decoded ? new Date(decoded.snapshotAt) : now
    const rows = await this.repository.listArticles({
      snapshotAt,
      after: window.after,
      before: window.before,
      limit: dto.limit,
      includeUnknownPublishedTime: dto.includeUnknownPublishedTime,
      contentTypes: dto.contentTypes,
      sourceTypes: dto.sourceTypes,
      keyword: dto.keyword,
      securityCodes: scopeCodes,
      cursorTuple: decoded
        ? {
            timelineSortAt: new Date(decoded.timelineSortAt),
            firstSeenAt: new Date(decoded.firstSeenAt),
            articleId: decoded.articleId,
          }
        : undefined,
    })
    const hasMore = rows.length > dto.limit
    const page = rows.slice(0, dto.limit)
    const last = page.at(-1)
    const coverage = await this.coverageService.getCoverage({
      contentTypes: dto.contentTypes,
      sourceTypes: dto.sourceTypes,
    })

    return {
      items: page.map(mapListItem),
      nextCursor:
        hasMore && last
          ? this.cursorCodec.encode(
              {
                snapshotAt: snapshotAt.toISOString(),
                effectiveAfter: window.after.toISOString(),
                effectiveBefore: window.before.toISOString(),
                queryHash,
                scopeFingerprint,
                timelineSortAt: last.timelineSortAt.toISOString(),
                firstSeenAt: last.firstSeenAt.toISOString(),
                articleId: last.articleId,
              },
              now,
            )
          : null,
      dataThrough: coverage.dataThrough,
      partial: coverage.partial,
      warnings: coverage.warnings,
    }
  }

  async detail(articleId: string): Promise<NewsArticleDetailResponseDto> {
    this.assertEnabled()
    const article = await this.repository.getArticleDetail(articleId, this.config.detailRevisionLimit)
    if (!article) throw NewsHttpException.fromKey('NEWS_ARTICLE_NOT_FOUND')
    const capabilities = new Map(this.registry.allCapabilities().map((capability) => [capability.feedKey, capability]))
    const sourceGroups = aggregateSources(article.providerItems)
    const providerItems = sourceGroups.slice(0, 20)
    const revisions = article.revisions.slice(0, this.config.detailRevisionLimit)
    const revisionsAscending = [...article.revisions].reverse()
    const previousByRevision = new Map(
      revisionsAscending.map((revision, index) => [revision.revision, revisionsAscending[index - 1]]),
    )
    const coverage = await this.coverageService.getCoverage({
      feedKeys: [...new Set(sourceGroups.map((item) => item.feedKey))],
    })

    return {
      articleId: article.id,
      revision: article.currentRevision,
      contentType: article.contentType,
      sourceType: article.sourceType,
      title: article.title,
      excerpt: article.excerpt,
      publisher: article.publisher,
      canonicalUrl: article.canonicalUrl,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      publishedDate: formatPrismaDate(article.publishedDate),
      publishedPrecision: article.publishedPrecision,
      firstSeenAt: article.firstSeenAt.toISOString(),
      securityCodes: article.securityLinks.map((link) => link.tsCode),
      providerKeys: [...new Set(article.providerItems.map((item) => item.providerKey))].sort(),
      qualityFlags: stringArray(article.qualityFlags),
      alternateUrls: stringArray(article.alternateUrls),
      sources: {
        items: providerItems.map((item) => {
          const capability = capabilities.get(item.feedKey)
          return {
            providerKey: item.providerKey,
            providerDisplayName: capability?.providerDisplayName ?? item.providerKey,
            feedKey: item.feedKey,
            feedDisplayName: capability?.feedDisplayName ?? item.feedKey,
            sourceType: capability?.sourceType ?? article.sourceType,
            sourceDiscoveredAt: item.sourceDiscoveredAt?.toISOString() ?? null,
            firstSeenAt: item.firstSeenAt.toISOString(),
            lastSeenAt: item.lastSeenAt.toISOString(),
            retrievedAt: item.retrievedAt.toISOString(),
          }
        }),
        total: sourceGroups.length,
        truncated: sourceGroups.length > providerItems.length,
      },
      revisions: {
        items: revisions.map((revision) => mapRevision(revision, previousByRevision.get(revision.revision))),
        total: article._count.revisions,
        truncated: article._count.revisions > revisions.length,
      },
      coverage,
    }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw NewsHttpException.fromKey('NEWS_MODULE_DISABLED')
  }

  private assertScope(dto: NewsArticleListRequestDto): void {
    if (dto.scope === 'SECURITIES' && !dto.securityCodes?.length) {
      throw NewsHttpException.fromKey('NEWS_SCOPE_SECURITY_CODES_REQUIRED')
    }
    if (dto.scope !== 'SECURITIES' && dto.securityCodes != null) {
      throw NewsHttpException.fromKey('NEWS_SCOPE_SECURITY_CODES_CONFLICT')
    }
  }
}

function mapListItem(row: Awaited<ReturnType<NewsRepository['listArticles']>>[number]): NewsArticleListItemDto {
  return {
    articleId: row.articleId,
    revision: row.revision,
    contentType: row.contentType,
    sourceType: row.sourceType,
    title: row.title,
    excerpt: row.excerpt,
    publisher: row.publisher,
    canonicalUrl: row.canonicalUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedDate: formatPrismaDate(row.publishedDate),
    publishedPrecision: row.publishedPrecision,
    firstSeenAt: row.firstSeenAt.toISOString(),
    securityCodes: row.securityCodes,
    providerKeys: row.providerKeys,
    qualityFlags: stringArray(row.qualityFlags),
  }
}

type ArticleRevision = NonNullable<Awaited<ReturnType<NewsRepository['getArticleDetail']>>>['revisions'][number]

function mapRevision(revision: ArticleRevision, previous?: ArticleRevision): NewsArticleRevisionDto {
  const changedFields = previous
    ? [
        changed('CONTENT_TYPE', revision.contentType, previous.contentType),
        changed('SOURCE_TYPE', revision.sourceType, previous.sourceType),
        changed('TITLE', revision.title, previous.title),
        changed('EXCERPT', revision.excerpt, previous.excerpt),
        changed('PUBLISHER', revision.publisher, previous.publisher),
        changed('CANONICAL_URL', revision.canonicalUrl, previous.canonicalUrl),
        changed('ALTERNATE_URLS', revision.alternateUrls, previous.alternateUrls),
        changed(
          'PUBLISHED_TIME',
          [revision.publishedAt, revision.publishedDate, revision.publishedPrecision],
          [previous.publishedAt, previous.publishedDate, previous.publishedPrecision],
        ),
        changed('QUALITY_FLAGS', revision.qualityFlags, previous.qualityFlags),
      ].filter((value): value is string => value != null)
    : [
        'CONTENT_TYPE',
        'SOURCE_TYPE',
        'TITLE',
        'EXCERPT',
        'PUBLISHER',
        'CANONICAL_URL',
        'ALTERNATE_URLS',
        'PUBLISHED_TIME',
        'QUALITY_FLAGS',
      ]
  return {
    revision: revision.revision,
    changedAt: revision.createdAt.toISOString(),
    changedFields,
    title: revision.title,
    excerpt: revision.excerpt,
    publisher: revision.publisher,
    canonicalUrl: revision.canonicalUrl,
    publishedAt: revision.publishedAt?.toISOString() ?? null,
    publishedDate: formatPrismaDate(revision.publishedDate),
    publishedPrecision: revision.publishedPrecision,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sorted<T extends string>(value: readonly T[] | undefined): T[] | null {
  return value ? [...value].sort() : null
}

function changed(label: string, left: unknown, right: unknown): string | null {
  return comparableJson(left) === comparableJson(right) ? null : label
}

function comparableJson(value: unknown): string {
  return stableJson(
    Array.isArray(value)
      ? value.map((item) => (item instanceof Date ? item.toISOString() : item))
      : value instanceof Date
        ? value.toISOString()
        : value,
  )
}

type ProviderItem = NonNullable<Awaited<ReturnType<NewsRepository['getArticleDetail']>>>['providerItems'][number]

function aggregateSources(items: ProviderItem[]): ProviderItem[] {
  const groups = new Map<string, ProviderItem>()
  for (const item of items) {
    const key = `${item.providerKey}\u0000${item.feedKey}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { ...item })
      continue
    }
    const sourceDiscoveredAt =
      [existing.sourceDiscoveredAt, item.sourceDiscoveredAt]
        .filter((value): value is Date => value != null)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null
    groups.set(key, {
      ...existing,
      sourceDiscoveredAt,
      firstSeenAt: existing.firstSeenAt < item.firstSeenAt ? existing.firstSeenAt : item.firstSeenAt,
      lastSeenAt: existing.lastSeenAt > item.lastSeenAt ? existing.lastSeenAt : item.lastSeenAt,
      retrievedAt: existing.retrievedAt > item.retrievedAt ? existing.retrievedAt : item.retrievedAt,
    })
  }
  return [...groups.values()].sort((left, right) => {
    if (left.sourceDiscoveredAt && right.sourceDiscoveredAt) {
      const compared = left.sourceDiscoveredAt.getTime() - right.sourceDiscoveredAt.getTime()
      if (compared) return compared
    } else if (left.sourceDiscoveredAt) return -1
    else if (right.sourceDiscoveredAt) return 1
    return left.providerKey.localeCompare(right.providerKey) || left.feedKey.localeCompare(right.feedKey)
  })
}
