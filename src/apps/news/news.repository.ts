import { Injectable } from '@nestjs/common'
import { NewsContentType, NewsIngestionRunStatus, NewsPublishedPrecision, NewsSourceType, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { computeNewsContentHash, sha256, stableJson } from './domain/news-identity'
import { choosePrimarySourceType, NEWS_NORMALIZER_VERSION, sortQualityFlags } from './domain/news-normalizer'
import { formatPrismaDate, prismaDate } from './domain/news-time'
import type { NewsFeedCapability, NewsProviderBatch, NormalizedNewsItem } from './domain/news.types'

const NEWS_INGESTION_PUBLIC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_ARGUMENT: '新闻采集参数无效',
  UPSTREAM_TIMEOUT: '新闻源请求超时',
  UPSTREAM_RATE_LIMITED: '新闻源请求频率受限',
  UPSTREAM_UNAVAILABLE: '新闻源暂时不可用',
  UPSTREAM_SCHEMA_CHANGED: '新闻源响应结构已变化',
  INTERNAL_ERROR: '新闻采集内部错误',
  QUEUE_ENQUEUE_FAILED: '新闻采集任务入队失败',
}

export function newsIngestionPublicErrorMessage(errorCode: string | null | undefined): string | null {
  if (errorCode == null) return null
  return NEWS_INGESTION_PUBLIC_ERROR_MESSAGES[errorCode] ?? '新闻采集任务失败'
}

export interface NewsListRepositoryQuery {
  snapshotAt: Date
  after: Date
  before: Date
  limit: number
  includeUnknownPublishedTime: boolean
  contentTypes?: readonly string[]
  sourceTypes?: readonly string[]
  keyword?: string
  securityCodes?: readonly string[]
  cursorTuple?: { timelineSortAt: Date; firstSeenAt: Date; articleId: string }
}

export interface NewsListRepositoryRow {
  articleId: string
  revision: number
  contentType: NewsContentType
  sourceType: NewsSourceType
  title: string
  excerpt: string | null
  publisher: string | null
  canonicalUrl: string | null
  publishedAt: Date | null
  publishedDate: Date | null
  publishedPrecision: NewsPublishedPrecision
  firstSeenAt: Date
  timelineSortAt: Date
  securityCodes: string[]
  providerKeys: string[]
  qualityFlags: unknown
}

export function mergeNewsListRepositoryRows(
  stableRows: NewsListRepositoryRow[],
  changedRows: NewsListRepositoryRow[],
  take: number,
): NewsListRepositoryRow[] {
  const unique = new Map<string, NewsListRepositoryRow>()
  for (const row of [...stableRows, ...changedRows]) {
    if (!unique.has(row.articleId)) unique.set(row.articleId, row)
  }
  return [...unique.values()]
    .sort((left, right) => {
      const byTimeline = right.timelineSortAt.getTime() - left.timelineSortAt.getTime()
      if (byTimeline !== 0) return byTimeline
      const byFirstSeen = right.firstSeenAt.getTime() - left.firstSeenAt.getTime()
      if (byFirstSeen !== 0) return byFirstSeen
      return right.articleId.localeCompare(left.articleId)
    })
    .slice(0, take)
}

export interface PreparedNewsItem extends NormalizedNewsItem {
  resolvedSecurityCodes: readonly string[]
}

export interface QuarantinedNewsItem {
  itemKeyHash: string
  rawPayloadHash: string
  errorCode: string
  errorMessage: string
  fieldManifest: Record<string, unknown>
  sanitizedPayload?: Record<string, unknown>
  retryable: boolean
}

@Injectable()
export class NewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listArticles(query: NewsListRepositoryQuery): Promise<NewsListRepositoryRow[]> {
    if (query.securityCodes && query.securityCodes.length === 0) return []
    const filters: Prisma.Sql[] = [
      Prisma.sql`a.created_at <= ${query.snapshotAt}`,
      Prisma.sql`(
        (r.published_precision IN ('SECOND'::news_published_precision, 'MINUTE'::news_published_precision)
          AND r.published_at >= ${query.after} AND r.published_at < ${query.before})
        OR
        (r.published_precision = 'DATE'::news_published_precision
          AND (r.published_date::timestamp AT TIME ZONE 'Asia/Shanghai') < ${query.before}
          AND ((r.published_date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai') > ${query.after})
        OR
        (${query.includeUnknownPublishedTime}
          AND r.published_precision = 'UNKNOWN'::news_published_precision
          AND a.first_seen_at >= ${query.after} AND a.first_seen_at < ${query.before})
      )`,
    ]
    if (query.contentTypes?.length) {
      filters.push(Prisma.sql`r.content_type::text IN (${Prisma.join(query.contentTypes)})`)
    }
    if (query.sourceTypes?.length) {
      filters.push(Prisma.sql`r.source_type::text IN (${Prisma.join(query.sourceTypes)})`)
    }
    if (query.securityCodes) {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM news_security_links scoped_link
        WHERE scoped_link.article_id = a.id
          AND scoped_link.created_at <= ${query.snapshotAt}
          AND scoped_link.ts_code IN (${Prisma.join(query.securityCodes)})
      )`)
    }
    if (query.cursorTuple) {
      filters.push(
        Prisma.sql`(a.timeline_sort_at, a.first_seen_at, a.id) < (
          ${query.cursorTuple.timelineSortAt}, ${query.cursorTuple.firstSeenAt}, ${query.cursorTuple.articleId}
        )`,
      )
    }

    const take = query.limit + 1
    if (!query.keyword) return this.queryArticleRows(filters, query.snapshotAt, take)

    const keywordPattern = `%${escapeLike(query.keyword)}%`
    const [stableRows, changedRows] = await Promise.all([
      this.queryArticleRows(
        [
          ...filters,
          Prisma.sql`a.updated_at <= ${query.snapshotAt}`,
          Prisma.sql`(a.title || ' ' || COALESCE(a.excerpt, '')) ILIKE ${keywordPattern} ESCAPE '\\'`,
        ],
        query.snapshotAt,
        take,
      ),
      this.queryArticleRows(
        [
          ...filters,
          Prisma.sql`a.updated_at > ${query.snapshotAt}`,
          Prisma.sql`(r.title || ' ' || COALESCE(r.excerpt, '')) ILIKE ${keywordPattern} ESCAPE '\\'`,
        ],
        query.snapshotAt,
        take,
      ),
    ])
    return mergeNewsListRepositoryRows(stableRows, changedRows, take)
  }

  listHighlightCandidates(now: Date, take = 60): Promise<NewsListRepositoryRow[]> {
    return this.listArticles({
      snapshotAt: now,
      after: new Date(now.getTime() - 72 * 60 * 60 * 1_000),
      before: new Date(now.getTime() + 1_000),
      limit: take - 1,
      includeUnknownPublishedTime: true,
    })
  }

  listRecentArticles(now: Date, take: number): Promise<NewsListRepositoryRow[]> {
    return this.listArticles({
      snapshotAt: now,
      after: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
      before: new Date(now.getTime() + 1_000),
      limit: take - 1,
      includeUnknownPublishedTime: true,
    })
  }

  private queryArticleRows(filters: Prisma.Sql[], snapshotAt: Date, take: number): Promise<NewsListRepositoryRow[]> {
    return this.prisma.$queryRaw<NewsListRepositoryRow[]>(Prisma.sql`
      SELECT
        a.id AS "articleId",
        r.revision,
        r.content_type AS "contentType",
        r.source_type AS "sourceType",
        r.title,
        r.excerpt,
        r.publisher,
        r.canonical_url AS "canonicalUrl",
        r.published_at AS "publishedAt",
        r.published_date AS "publishedDate",
        r.published_precision AS "publishedPrecision",
        a.first_seen_at AS "firstSeenAt",
        a.timeline_sort_at AS "timelineSortAt",
        COALESCE((
          SELECT array_agg(DISTINCT link.ts_code ORDER BY link.ts_code)
          FROM news_security_links link
          WHERE link.article_id = a.id AND link.created_at <= ${snapshotAt}
        ), ARRAY[]::text[]) AS "securityCodes",
        COALESCE((
          SELECT array_agg(DISTINCT source.provider_key ORDER BY source.provider_key)
          FROM news_provider_items source
          WHERE source.article_id = a.id AND source.first_seen_at <= ${snapshotAt}
        ), ARRAY[]::text[]) AS "providerKeys",
        r.quality_flags AS "qualityFlags"
      FROM news_articles a
      JOIN LATERAL (
        SELECT revision, content_type, source_type, title, excerpt, publisher, canonical_url,
               published_at, published_date, published_precision, quality_flags
        FROM news_article_revisions revision_row
        WHERE revision_row.article_id = a.id AND revision_row.created_at <= ${snapshotAt}
        ORDER BY revision_row.revision DESC
        LIMIT 1
      ) r ON true
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY a.timeline_sort_at DESC, a.first_seen_at DESC, a.id DESC
      LIMIT ${take}
    `)
  }

  async getArticleDetail(articleId: string, revisionLimit: number) {
    return this.prisma.newsArticle.findUnique({
      where: { id: articleId },
      include: {
        securityLinks: { orderBy: { tsCode: 'asc' } },
        providerItems: { orderBy: [{ sourceDiscoveredAt: 'asc' }, { providerKey: 'asc' }, { feedKey: 'asc' }] },
        revisions: { orderBy: { revision: 'desc' }, take: revisionLimit + 1 },
        _count: { select: { revisions: true, providerItems: true } },
      },
    })
  }

  async resolveScopeCodes(scope: 'ALL' | 'WATCHLIST' | 'PORTFOLIO' | 'SECURITIES', userId: number, codes?: string[]) {
    if (scope === 'ALL') return undefined
    if (scope === 'SECURITIES') return [...(codes ?? [])].sort()
    if (scope === 'WATCHLIST') {
      const rows = await this.prisma.watchlistStock.findMany({
        where: { watchlist: { userId } },
        select: { tsCode: true },
        distinct: ['tsCode'],
        orderBy: { tsCode: 'asc' },
      })
      return rows.map((row) => row.tsCode)
    }
    const rows = await this.prisma.portfolioHolding.findMany({
      where: { quantity: { gt: 0 }, portfolio: { userId, isArchived: false } },
      select: { tsCode: true },
      distinct: ['tsCode'],
      orderBy: { tsCode: 'asc' },
    })
    return rows.map((row) => row.tsCode)
  }

  async ensureCursor(providerKey: string, feedKey: string, partitionKey: string) {
    return this.prisma.newsIngestionCursor.upsert({
      where: { providerKey_feedKey_partitionKey: { providerKey, feedKey, partitionKey } },
      create: { providerKey, feedKey, partitionKey },
      update: {},
    })
  }

  async markRunRunning(runId: string, now = new Date(), staleAfterMs = 90_000): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - staleAfterMs)
    const result = await this.prisma.newsIngestionRun.updateMany({
      where: {
        id: runId,
        OR: [
          { status: { in: [NewsIngestionRunStatus.QUEUED, NewsIngestionRunStatus.FAILED] } },
          {
            status: NewsIngestionRunStatus.RUNNING,
            OR: [{ startedAt: null }, { startedAt: { lte: staleBefore } }],
          },
        ],
      },
      data: { status: NewsIngestionRunStatus.RUNNING, startedAt: now, errorCode: null, errorMessage: null },
    })
    return result.count === 1
  }

  async getRun(runId: string) {
    return this.prisma.newsIngestionRun.findUnique({ where: { id: runId }, include: { command: true } })
  }

  async commitBatch(input: {
    runId: string
    cursorId: bigint
    cursorVersion: number
    batch: NewsProviderBatch
    capability: NewsFeedCapability
    dataThroughBefore: Date | null
    items: readonly PreparedNewsItem[]
    quarantined: readonly QuarantinedNewsItem[]
  }): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => this.commitBatchTransaction(tx, input), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
        return
      } catch (error) {
        lastError = error
        if (!isRetryableWriteConflict(error)) throw error
      }
    }
    throw lastError
  }

  async markRunFailed(input: {
    runId: string
    providerKey: string
    feedKey: string
    partitionKey: string
    errorCode: string
    errorMessage: string
  }): Promise<void> {
    const now = new Date()
    const publicErrorCode = input.errorCode.slice(0, 64)
    const publicErrorMessage = newsIngestionPublicErrorMessage(publicErrorCode)!
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.newsIngestionRun.updateMany({
        where: { id: input.runId, status: NewsIngestionRunStatus.RUNNING },
        data: {
          status: NewsIngestionRunStatus.FAILED,
          errorCode: publicErrorCode,
          errorMessage: publicErrorMessage,
          finishedAt: now,
        },
      })
      if (transitioned.count !== 1) return

      await tx.newsIngestionCursor.upsert({
        where: {
          providerKey_feedKey_partitionKey: {
            providerKey: input.providerKey,
            feedKey: input.feedKey,
            partitionKey: input.partitionKey,
          },
        },
        create: {
          providerKey: input.providerKey,
          feedKey: input.feedKey,
          partitionKey: input.partitionKey,
          lastAttemptAt: now,
          consecutiveFailures: 1,
        },
        update: { lastAttemptAt: now, consecutiveFailures: { increment: 1 } },
      })
      await tx.newsFeedHealth.upsert({
        where: { providerKey_feedKey: { providerKey: input.providerKey, feedKey: input.feedKey } },
        create: {
          providerKey: input.providerKey,
          feedKey: input.feedKey,
          lastAttemptAt: now,
          consecutiveFailures: 1,
          lastRunStatus: NewsIngestionRunStatus.FAILED,
          lastPublicErrorCode: publicErrorCode,
          lastPublicErrorMessage: publicErrorMessage,
        },
        update: {
          lastAttemptAt: now,
          consecutiveFailures: { increment: 1 },
          lastRunStatus: NewsIngestionRunStatus.FAILED,
          lastPublicErrorCode: publicErrorCode,
          lastPublicErrorMessage: publicErrorMessage,
        },
      })
    })
  }

  async resolveSecurityHints(hints: readonly string[]): Promise<{ resolved: string[]; unresolved: string[] }> {
    const unique = [...new Set(hints)].slice(0, 101)
    const tsCodes = unique.filter((value) => /^\d{6}\.(SH|SZ|BJ)$/.test(value))
    const symbols = unique.filter((value) => /^\d{6}$/.test(value))
    const rows = await this.prisma.stockBasic.findMany({
      where: { OR: [{ tsCode: { in: tsCodes } }, { symbol: { in: symbols } }] },
      select: { tsCode: true, symbol: true },
    })
    const bySymbol = new Map<string, string[]>()
    for (const row of rows) {
      if (row.symbol) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row.tsCode])
    }
    const foundCodes = new Set(rows.map((row) => row.tsCode))
    const resolved: string[] = []
    const unresolved: string[] = []
    for (const hint of unique) {
      if (TS_CODE.test(hint)) {
        ;(foundCodes.has(hint) ? resolved : unresolved).push(hint)
      } else if (/^\d{6}$/.test(hint) && bySymbol.get(hint)?.length === 1) {
        resolved.push(bySymbol.get(hint)![0])
      } else {
        unresolved.push(hint)
      }
    }
    return { resolved: [...new Set(resolved)].sort().slice(0, 100), unresolved }
  }

  async cleanup(now: Date, retention: { metadataDays: number; runDays: number; quarantineDays: number }) {
    const before = (days: number) => new Date(now.getTime() - days * 86_400_000)
    return this.prisma.$transaction(async (tx) => {
      const metadata = await tx.newsProviderItem.updateMany({
        where: { retrievedAt: { lt: before(retention.metadataDays) }, NOT: { sourceMetadata: { equals: {} } } },
        data: { sourceMetadata: {} },
      })
      const quarantine = await tx.newsQuarantineItem.deleteMany({
        where: { createdAt: { lt: before(retention.quarantineDays) } },
      })
      const runs = await tx.newsIngestionRun.deleteMany({
        where: { commandId: null, createdAt: { lt: before(retention.runDays) }, quarantinedItems: { none: {} } },
      })
      return { metadataCleared: metadata.count, quarantineDeleted: quarantine.count, runsDeleted: runs.count }
    })
  }

  async refreshCommandStatus(commandId: string | null): Promise<void> {
    if (!commandId) return
    const runs = await this.prisma.newsIngestionRun.findMany({
      where: { commandId },
      select: { status: true, startedAt: true, finishedAt: true },
    })
    if (!runs.length) return
    const statuses = runs.map((run) => run.status)
    const terminalStatuses = new Set<NewsIngestionRunStatus>([
      NewsIngestionRunStatus.SUCCEEDED,
      NewsIngestionRunStatus.PARTIAL,
      NewsIngestionRunStatus.FAILED,
      NewsIngestionRunStatus.CANCELLED,
    ])
    const terminal = statuses.every((status) => terminalStatuses.has(status))
    let status: NewsIngestionRunStatus = NewsIngestionRunStatus.QUEUED
    const queuedAndTerminalMixed =
      statuses.includes(NewsIngestionRunStatus.QUEUED) && statuses.some((value) => terminalStatuses.has(value))
    if (statuses.includes(NewsIngestionRunStatus.RUNNING) || queuedAndTerminalMixed)
      status = NewsIngestionRunStatus.RUNNING
    else if (terminal) {
      if (statuses.every((value) => value === NewsIngestionRunStatus.SUCCEEDED))
        status = NewsIngestionRunStatus.SUCCEEDED
      else if (statuses.every((value) => value === NewsIngestionRunStatus.FAILED))
        status = NewsIngestionRunStatus.FAILED
      else if (statuses.every((value) => value === NewsIngestionRunStatus.CANCELLED))
        status = NewsIngestionRunStatus.CANCELLED
      else status = NewsIngestionRunStatus.PARTIAL
    }
    const started = runs.map((run) => run.startedAt).filter((value): value is Date => value != null)
    const finished = runs.map((run) => run.finishedAt).filter((value): value is Date => value != null)
    await this.prisma.newsIngestionCommand.update({
      where: { id: commandId },
      data: {
        status,
        startedAt: started.length ? new Date(Math.min(...started.map(Number))) : null,
        finishedAt: terminal && finished.length ? new Date(Math.max(...finished.map(Number))) : null,
      },
    })
  }

  private async commitBatchTransaction(
    tx: Prisma.TransactionClient,
    input: {
      runId: string
      cursorId: bigint
      cursorVersion: number
      batch: NewsProviderBatch
      capability: NewsFeedCapability
      dataThroughBefore: Date | null
      items: readonly PreparedNewsItem[]
      quarantined: readonly QuarantinedNewsItem[]
    },
  ): Promise<void> {
    const currentCursor = await tx.newsIngestionCursor.findUnique({ where: { id: input.cursorId } })
    if (!currentCursor || currentCursor.version !== input.cursorVersion) {
      throw new Error('NEWS_CURSOR_WRITE_CONFLICT')
    }
    let insertedCount = 0
    let revisedCount = 0
    let duplicateCount = 0
    for (const incoming of input.items) {
      const existing = await tx.newsArticle.findUnique({ where: { identityHash: incoming.identityHash } })
      const alternateUrls = mergeStringArrays(existing?.alternateUrls, incoming.alternateUrls, 20)
      const effectiveIncoming: NormalizedNewsItem = { ...incoming, alternateUrls }
      const sourceType = existing
        ? choosePrimarySourceType(existing.sourceType as typeof incoming.sourceType, incoming.sourceType)
        : incoming.sourceType
      const qualityFlags = sortQualityFlags(incoming.qualityFlags)
      const contentHash = computeNewsContentHash({ ...effectiveIncoming, sourceType, qualityFlags })
      let articleId: string
      if (!existing) {
        const created = await tx.newsArticle.create({
          data: {
            identityHash: effectiveIncoming.identityHash,
            canonicalUrl: effectiveIncoming.canonicalUrl,
            canonicalUrlHash: effectiveIncoming.canonicalUrlHash,
            alternateUrls: json(effectiveIncoming.alternateUrls),
            contentType: effectiveIncoming.contentType,
            sourceType,
            publisher: effectiveIncoming.publisher,
            title: effectiveIncoming.title,
            excerpt: effectiveIncoming.excerpt,
            publishedAt: effectiveIncoming.publishedAt,
            publishedDate: prismaDate(effectiveIncoming.publishedDate),
            publishedPrecision: effectiveIncoming.publishedPrecision,
            language: effectiveIncoming.language,
            sourceCountry: effectiveIncoming.sourceCountry,
            currentContentHash: contentHash,
            qualityFlags: json(qualityFlags),
            firstSeenAt: input.batch.retrievedAt,
            lastSeenAt: input.batch.retrievedAt,
            timelineSortAt: incoming.timelineSortAt,
          },
        })
        articleId = created.id
        await tx.newsArticleRevision.create({
          data: revisionData(created.id, 1, effectiveIncoming, sourceType, contentHash, qualityFlags),
        })
        insertedCount += 1
      } else {
        articleId = existing.id
        if (existing.currentContentHash !== contentHash) {
          const historicalRevision = await tx.newsArticleRevision.findUnique({
            where: { articleId_contentHash: { articleId: existing.id, contentHash } },
            select: { id: true },
          })
          if (historicalRevision) {
            await tx.newsArticle.update({
              where: { id: existing.id },
              data: { lastSeenAt: maxDate(existing.lastSeenAt, input.batch.retrievedAt) },
            })
            duplicateCount += 1
          } else {
            const nextRevision = existing.currentRevision + 1
            const updated = await tx.newsArticle.updateMany({
              where: {
                id: existing.id,
                currentRevision: existing.currentRevision,
                currentContentHash: existing.currentContentHash,
              },
              data: {
                canonicalUrl: effectiveIncoming.canonicalUrl,
                canonicalUrlHash: effectiveIncoming.canonicalUrlHash,
                alternateUrls: json(effectiveIncoming.alternateUrls),
                contentType: effectiveIncoming.contentType,
                sourceType,
                publisher: effectiveIncoming.publisher,
                title: effectiveIncoming.title,
                excerpt: effectiveIncoming.excerpt,
                publishedAt: effectiveIncoming.publishedAt,
                publishedDate: prismaDate(effectiveIncoming.publishedDate),
                publishedPrecision: effectiveIncoming.publishedPrecision,
                language: effectiveIncoming.language,
                sourceCountry: effectiveIncoming.sourceCountry,
                currentRevision: nextRevision,
                currentContentHash: contentHash,
                qualityFlags: json(qualityFlags),
                lastSeenAt: maxDate(existing.lastSeenAt, input.batch.retrievedAt),
              },
            })
            if (updated.count !== 1) throw new Error('NEWS_ARTICLE_WRITE_CONFLICT')
            await tx.newsArticleRevision.create({
              data: revisionData(existing.id, nextRevision, effectiveIncoming, sourceType, contentHash, qualityFlags),
            })
            revisedCount += 1
          }
        } else {
          await tx.newsArticle.update({
            where: { id: existing.id },
            data: { lastSeenAt: maxDate(existing.lastSeenAt, input.batch.retrievedAt) },
          })
          duplicateCount += 1
        }
      }

      const existingProviderItem = await tx.newsProviderItem.findUnique({
        where: {
          providerKey_feedKey_upstreamId: {
            providerKey: incoming.providerKey,
            feedKey: incoming.feedKey,
            upstreamId: incoming.upstreamId,
          },
        },
      })
      const isLatestProviderSnapshot =
        !existingProviderItem || input.batch.retrievedAt >= existingProviderItem.retrievedAt
      await tx.newsProviderItem.upsert({
        where: {
          providerKey_feedKey_upstreamId: {
            providerKey: incoming.providerKey,
            feedKey: incoming.feedKey,
            upstreamId: incoming.upstreamId,
          },
        },
        create: {
          providerKey: incoming.providerKey,
          feedKey: incoming.feedKey,
          upstreamId: incoming.upstreamId,
          articleId,
          sourceDiscoveredAt: incoming.sourceDiscoveredAt,
          rawPayloadHash: incoming.rawPayloadHash,
          sourceMetadata: json(incoming.sourceMetadata),
          firstSeenAt: input.batch.retrievedAt,
          lastSeenAt: input.batch.retrievedAt,
          retrievedAt: input.batch.retrievedAt,
        },
        update: {
          articleId,
          sourceDiscoveredAt: minNullableDate(existingProviderItem?.sourceDiscoveredAt, incoming.sourceDiscoveredAt),
          rawPayloadHash: isLatestProviderSnapshot ? incoming.rawPayloadHash : existingProviderItem!.rawPayloadHash,
          sourceMetadata: isLatestProviderSnapshot
            ? json(incoming.sourceMetadata)
            : json(existingProviderItem!.sourceMetadata),
          firstSeenAt: existingProviderItem
            ? minDate(existingProviderItem.firstSeenAt, input.batch.retrievedAt)
            : input.batch.retrievedAt,
          lastSeenAt: existingProviderItem
            ? maxDate(existingProviderItem.lastSeenAt, input.batch.retrievedAt)
            : input.batch.retrievedAt,
          retrievedAt: existingProviderItem
            ? maxDate(existingProviderItem.retrievedAt, input.batch.retrievedAt)
            : input.batch.retrievedAt,
        },
      })
      if (incoming.resolvedSecurityCodes.length) {
        await tx.newsSecurityLink.createMany({
          data: incoming.resolvedSecurityCodes.map((tsCode) => ({
            articleId,
            tsCode,
            matchMethod: 'PROVIDER_CODE',
            confidence: new Prisma.Decimal(1),
            evidence: 'provider.securityHints',
          })),
          skipDuplicates: true,
        })
      }
    }

    if (input.quarantined.length) {
      await tx.newsQuarantineItem.createMany({
        data: input.quarantined.map((item) => ({
          runId: input.runId,
          itemKeyHash: item.itemKeyHash,
          rawPayloadHash: item.rawPayloadHash,
          errorCode: item.errorCode,
          errorMessage: item.errorMessage.slice(0, 500),
          fieldManifest: json(item.fieldManifest),
          sanitizedPayload: item.sanitizedPayload ? json(item.sanitizedPayload) : undefined,
          retryable: item.retryable,
        })),
        skipDuplicates: true,
      })
    }

    const watermarkAfter = maxNullableDate(currentCursor.watermarkAt, input.batch.retrievedAt)!
    const cursorSnapshotIsNewest = !currentCursor.watermarkAt || input.batch.retrievedAt >= currentCursor.watermarkAt
    const advanced = await tx.newsIngestionCursor.updateMany({
      where: { id: input.cursorId, version: input.cursorVersion },
      data: {
        providerCursor: cursorSnapshotIsNewest
          ? input.batch.nextCursor
            ? json(input.batch.nextCursor)
            : Prisma.JsonNull
          : (currentCursor.providerCursor ?? Prisma.JsonNull),
        watermarkAt: watermarkAfter,
        lastSuccessfulAt: maxNullableDate(currentCursor.lastSuccessfulAt, input.batch.retrievedAt),
        lastAttemptAt: maxNullableDate(currentCursor.lastAttemptAt, input.batch.retrievedAt),
        consecutiveFailures: 0,
        version: { increment: 1 },
      },
    })
    if (advanced.count !== 1) throw new Error('NEWS_CURSOR_WRITE_CONFLICT')
    const partial =
      input.quarantined.length > 0 ||
      input.batch.potentiallyTruncated ||
      input.batch.warnings.some((warning) => warning.affectsCompleteness !== false)
    const existingHealth = await tx.newsFeedHealth.findUnique({
      where: { providerKey_feedKey: { providerKey: input.batch.providerKey, feedKey: input.batch.feedKey } },
    })
    const healthSnapshotIsNewest = !existingHealth?.dataThrough || input.batch.retrievedAt >= existingHealth.dataThrough
    const potentiallyTruncated = input.batch.potentiallyTruncated
      ? true
      : existingHealth?.potentiallyTruncated && !healthSnapshotIsNewest
        ? true
        : false
    await tx.newsFeedHealth.upsert({
      where: { providerKey_feedKey: { providerKey: input.batch.providerKey, feedKey: input.batch.feedKey } },
      create: {
        providerKey: input.batch.providerKey,
        feedKey: input.batch.feedKey,
        lastSuccessfulAt: input.batch.retrievedAt,
        dataThrough: input.batch.retrievedAt,
        lastAttemptAt: input.batch.retrievedAt,
        lastRunStatus: partial ? NewsIngestionRunStatus.PARTIAL : NewsIngestionRunStatus.SUCCEEDED,
        potentiallyTruncated: input.batch.potentiallyTruncated,
      },
      update: {
        lastSuccessfulAt: maxNullableDate(existingHealth?.lastSuccessfulAt, input.batch.retrievedAt),
        dataThrough: maxNullableDate(existingHealth?.dataThrough, input.batch.retrievedAt),
        lastAttemptAt: maxNullableDate(existingHealth?.lastAttemptAt, input.batch.retrievedAt),
        consecutiveFailures: healthSnapshotIsNewest ? 0 : existingHealth?.consecutiveFailures,
        lastRunStatus: healthSnapshotIsNewest
          ? partial
            ? NewsIngestionRunStatus.PARTIAL
            : NewsIngestionRunStatus.SUCCEEDED
          : existingHealth?.lastRunStatus,
        potentiallyTruncated,
        circuitState: healthSnapshotIsNewest ? 'CLOSED' : existingHealth?.circuitState,
        lastPublicErrorCode: healthSnapshotIsNewest ? null : existingHealth?.lastPublicErrorCode,
        lastPublicErrorMessage: healthSnapshotIsNewest ? null : existingHealth?.lastPublicErrorMessage,
      },
    })
    await tx.newsIngestionRun.update({
      where: { id: input.runId },
      data: {
        status: partial ? NewsIngestionRunStatus.PARTIAL : NewsIngestionRunStatus.SUCCEEDED,
        fetchedCount: input.batch.items.length,
        insertedCount,
        revisedCount,
        duplicateCount,
        quarantinedCount: input.quarantined.length,
        potentiallyTruncated: input.batch.potentiallyTruncated,
        dataThroughBefore: input.dataThroughBefore,
        dataThroughAfter: watermarkAfter,
        finishedAt: new Date(),
      },
    })
  }
}

const TS_CODE = /^\d{6}\.(SH|SZ|BJ)$/

function revisionData(
  articleId: string,
  revision: number,
  item: NormalizedNewsItem,
  sourceType: NewsSourceType,
  contentHash: string,
  qualityFlags: string[],
): Prisma.NewsArticleRevisionUncheckedCreateInput {
  return {
    articleId,
    revision,
    contentHash,
    rawPayloadHash: item.rawPayloadHash,
    normalizerVersion: NEWS_NORMALIZER_VERSION,
    contentType: item.contentType,
    sourceType,
    canonicalUrl: item.canonicalUrl,
    alternateUrls: json(item.alternateUrls),
    title: item.title,
    excerpt: item.excerpt,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    publishedDate: prismaDate(item.publishedDate),
    publishedPrecision: item.publishedPrecision,
    language: item.language,
    sourceCountry: item.sourceCountry,
    qualityFlags: json(qualityFlags),
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(stableJson(value)) as Prisma.InputJsonValue
}

function mergeStringArrays(left: unknown, right: readonly string[], limit: number): string[] {
  const existing = Array.isArray(left) ? left.filter((value): value is string => typeof value === 'string') : []
  return [...new Set([...existing, ...right])].sort().slice(0, limit)
}

function minDate(left: Date, right: Date): Date {
  return left <= right ? left : right
}

function maxDate(left: Date, right: Date): Date {
  return left >= right ? left : right
}

function minNullableDate(left: Date | null | undefined, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return minDate(left, right)
}

function maxNullableDate(left: Date | null | undefined, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return maxDate(left, right)
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function isRetryableWriteConflict(error: unknown): boolean {
  if (error instanceof Error && error.message === 'NEWS_ARTICLE_WRITE_CONFLICT') return true
  return error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)
}

export function serializeListRow(row: NewsListRepositoryRow) {
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
    qualityFlags: Array.isArray(row.qualityFlags) ? row.qualityFlags.map(String) : [],
  }
}

export function commandRequestHash(value: unknown): string {
  return sha256(stableJson(value))
}
