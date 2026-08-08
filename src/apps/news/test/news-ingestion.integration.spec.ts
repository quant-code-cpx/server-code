import { randomUUID } from 'node:crypto'
import { NewsIngestionOperation, NewsIngestionRunStatus, NewsIngestionTrigger, PrismaClient } from '@prisma/client'
import { normalizeNewsItem } from '../domain/news-normalizer'
import type { NewsFeedCapability, NewsProviderBatch, ProviderNewsItem } from '../domain/news.types'
import { NewsRepository, type PreparedNewsItem } from '../news.repository'

const describeDb = process.env.RUN_NEWS_DB_INTEGRATION === 'true' ? describe : describe.skip

describeDb('NEWS-BIZ-006: News 事务入库集成', () => {
  const prisma = new PrismaClient()
  const repository = new NewsRepository(prisma as never)
  const token = randomUUID()
  const providerKey = 'NEWS_TEST'
  const feedKey = `news.test.${token}`
  const partitionKey = 'default'
  const identityHashes: string[] = []
  const runIds: string[] = []

  afterAll(async () => {
    const articles = await prisma.newsArticle.findMany({
      where: { identityHash: { in: identityHashes } },
      select: { id: true },
    })
    const articleIds = articles.map((article) => article.id)
    await prisma.newsQuarantineItem.deleteMany({ where: { runId: { in: runIds } } })
    await prisma.newsProviderItem.deleteMany({ where: { articleId: { in: articleIds } } })
    await prisma.newsSecurityLink.deleteMany({ where: { articleId: { in: articleIds } } })
    await prisma.newsArticleRevision.deleteMany({ where: { articleId: { in: articleIds } } })
    await prisma.newsArticle.deleteMany({ where: { id: { in: articleIds } } })
    await prisma.newsIngestionRun.deleteMany({ where: { id: { in: runIds } } })
    await prisma.newsIngestionCursor.deleteMany({ where: { providerKey, feedKey } })
    await prisma.newsFeedHealth.deleteMany({ where: { providerKey, feedKey } })
    await prisma.$disconnect()
  })

  it('5 项样本原子产生 inserted=2/revised=1/duplicate=1/quarantine=1 与水位', async () => {
    const run = await prisma.newsIngestionRun.create({
      data: {
        idempotencyKey: `integration:${token}`,
        operation: NewsIngestionOperation.POLL_FEED,
        providerKey,
        feedKey,
        partitionKey,
        trigger: NewsIngestionTrigger.MANUAL,
        status: NewsIngestionRunStatus.RUNNING,
      },
    })
    runIds.push(run.id)
    const cursor = await repository.ensureCursor(providerKey, feedKey, partitionKey)
    const retrievedAt = new Date('2026-08-06T04:00:00.000Z')
    const rawItems = [
      item('upstream-a1', 'https://news-test.invalid/a', '标题 A'),
      item('upstream-a2', 'https://news-test.invalid/a', '标题 A 修订'),
      item('upstream-a3', 'https://news-test.invalid/a', '标题 A 修订'),
      item('upstream-b1', 'https://news-test.invalid/b', '标题 B'),
      item('upstream-bad', null, '坏数据'),
    ]
    const prepared: PreparedNewsItem[] = rawItems.slice(0, 4).map((raw) => {
      const normalized = normalizeNewsItem({ providerKey, feedKey, sourceType: 'MEDIA', item: raw, retrievedAt })
      identityHashes.push(normalized.identityHash)
      return { ...normalized, resolvedSecurityCodes: [] }
    })
    const batch: NewsProviderBatch = {
      schemaVersion: 1,
      providerKey,
      feedKey,
      partitionKey,
      retrievedAt,
      items: rawItems,
      nextCursor: { page: 2 },
      potentiallyTruncated: false,
      warnings: [],
    }
    const capability: NewsFeedCapability = {
      providerKey,
      providerDisplayName: 'Test',
      feedKey,
      feedDisplayName: 'Test',
      sourceType: 'MEDIA',
      contentTypes: ['NEWS'],
      scheduleMode: 'SCHEDULED',
      expectedIntervalSeconds: 60,
      requiredForCompleteness: true,
      enabled: true,
    }
    await repository.commitBatch({
      runId: run.id,
      cursorId: cursor.id,
      cursorVersion: cursor.version,
      dataThroughBefore: null,
      batch,
      capability,
      items: prepared,
      quarantined: [
        {
          itemKeyHash: 'f'.repeat(64),
          rawPayloadHash: 'e'.repeat(64),
          errorCode: 'ITEM_NORMALIZATION_FAILED',
          errorMessage: '测试隔离',
          fieldManifest: { fields: ['title'] },
          retryable: false,
        },
      ],
    })

    const [storedRun, storedCursor, health, articles, quarantine] = await Promise.all([
      prisma.newsIngestionRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.newsIngestionCursor.findUniqueOrThrow({ where: { id: cursor.id } }),
      prisma.newsFeedHealth.findUniqueOrThrow({ where: { providerKey_feedKey: { providerKey, feedKey } } }),
      prisma.newsArticle.findMany({ where: { identityHash: { in: identityHashes } }, include: { revisions: true } }),
      prisma.newsQuarantineItem.findMany({ where: { runId: run.id } }),
    ])
    expect(storedRun).toEqual(
      expect.objectContaining({
        status: NewsIngestionRunStatus.PARTIAL,
        fetchedCount: 5,
        insertedCount: 2,
        revisedCount: 1,
        duplicateCount: 1,
        quarantinedCount: 1,
      }),
    )
    expect(storedCursor.version).toBe(cursor.version + 1)
    expect(storedCursor.watermarkAt?.toISOString()).toBe(retrievedAt.toISOString())
    expect(health).toEqual(
      expect.objectContaining({ lastRunStatus: NewsIngestionRunStatus.PARTIAL, consecutiveFailures: 0 }),
    )
    expect(articles).toHaveLength(2)
    expect(articles.find((article) => article.canonicalUrl?.endsWith('/a'))?.revisions).toHaveLength(2)
    expect(quarantine).toHaveLength(1)
  })

  it('NEWS-DATA-008/RACE-005: 旧快照不回退修订、Provider 时间或水位', async () => {
    const run = await prisma.newsIngestionRun.create({
      data: {
        idempotencyKey: `integration:old-snapshot:${token}`,
        operation: NewsIngestionOperation.POLL_FEED,
        providerKey,
        feedKey,
        partitionKey,
        trigger: NewsIngestionTrigger.RETRY,
        status: NewsIngestionRunStatus.RUNNING,
      },
    })
    runIds.push(run.id)
    const cursor = await repository.ensureCursor(providerKey, feedKey, partitionKey)
    const retrievedAt = new Date('2026-08-06T02:00:00.000Z')
    const raw = item('upstream-a3', 'https://news-test.invalid/a', '标题 A')
    const normalized = normalizeNewsItem({ providerKey, feedKey, sourceType: 'MEDIA', item: raw, retrievedAt })
    await repository.commitBatch({
      runId: run.id,
      cursorId: cursor.id,
      cursorVersion: cursor.version,
      dataThroughBefore: cursor.watermarkAt,
      batch: {
        schemaVersion: 1,
        providerKey,
        feedKey,
        partitionKey,
        retrievedAt,
        items: [raw],
        nextCursor: { page: 1 },
        potentiallyTruncated: false,
        warnings: [],
      },
      capability: {
        providerKey,
        providerDisplayName: 'Test',
        feedKey,
        feedDisplayName: 'Test',
        sourceType: 'MEDIA',
        contentTypes: ['NEWS'],
        scheduleMode: 'SCHEDULED',
        expectedIntervalSeconds: 60,
        requiredForCompleteness: true,
        enabled: true,
      },
      items: [{ ...normalized, resolvedSecurityCodes: [] }],
      quarantined: [],
    })

    const [article, providerItem, storedCursor, storedRun, health] = await Promise.all([
      prisma.newsArticle.findUniqueOrThrow({
        where: { identityHash: normalized.identityHash },
        include: { revisions: { orderBy: { revision: 'asc' } } },
      }),
      prisma.newsProviderItem.findUniqueOrThrow({
        where: { providerKey_feedKey_upstreamId: { providerKey, feedKey, upstreamId: 'upstream-a3' } },
      }),
      prisma.newsIngestionCursor.findUniqueOrThrow({ where: { id: cursor.id } }),
      prisma.newsIngestionRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.newsFeedHealth.findUniqueOrThrow({ where: { providerKey_feedKey: { providerKey, feedKey } } }),
    ])
    expect(article.title).toBe('标题 A 修订')
    expect(article.revisions).toHaveLength(2)
    expect(providerItem.firstSeenAt.toISOString()).toBe(retrievedAt.toISOString())
    expect(providerItem.lastSeenAt.toISOString()).toBe('2026-08-06T04:00:00.000Z')
    expect(providerItem.retrievedAt.toISOString()).toBe('2026-08-06T04:00:00.000Z')
    expect(storedCursor.watermarkAt?.toISOString()).toBe('2026-08-06T04:00:00.000Z')
    expect(storedRun).toEqual(expect.objectContaining({ duplicateCount: 1, revisedCount: 0 }))
    expect(storedRun.dataThroughAfter?.toISOString()).toBe('2026-08-06T04:00:00.000Z')
    expect(health.lastRunStatus).toBe(NewsIngestionRunStatus.PARTIAL)
  })

  it('NEWS-ERR-008/RACE-006: Cursor CAS 失败时整批零写入', async () => {
    const run = await prisma.newsIngestionRun.create({
      data: {
        idempotencyKey: `integration:cas:${token}`,
        operation: NewsIngestionOperation.POLL_FEED,
        providerKey,
        feedKey,
        partitionKey,
        trigger: NewsIngestionTrigger.RETRY,
        status: NewsIngestionRunStatus.RUNNING,
      },
    })
    runIds.push(run.id)
    const cursor = await repository.ensureCursor(providerKey, feedKey, partitionKey)
    const retrievedAt = new Date('2026-08-06T05:00:00.000Z')
    const raw = item('upstream-c1', 'https://news-test.invalid/c', '标题 C')
    const normalized = normalizeNewsItem({ providerKey, feedKey, sourceType: 'MEDIA', item: raw, retrievedAt })
    identityHashes.push(normalized.identityHash)

    await expect(
      repository.commitBatch({
        runId: run.id,
        cursorId: cursor.id,
        cursorVersion: cursor.version - 1,
        dataThroughBefore: cursor.watermarkAt,
        batch: {
          schemaVersion: 1,
          providerKey,
          feedKey,
          partitionKey,
          retrievedAt,
          items: [raw],
          nextCursor: null,
          potentiallyTruncated: false,
          warnings: [],
        },
        capability: {
          providerKey,
          providerDisplayName: 'Test',
          feedKey,
          feedDisplayName: 'Test',
          sourceType: 'MEDIA',
          contentTypes: ['NEWS'],
          scheduleMode: 'SCHEDULED',
          expectedIntervalSeconds: 60,
          requiredForCompleteness: true,
          enabled: true,
        },
        items: [{ ...normalized, resolvedSecurityCodes: [] }],
        quarantined: [],
      }),
    ).rejects.toThrow('NEWS_CURSOR_WRITE_CONFLICT')

    await expect(
      prisma.newsArticle.findUnique({ where: { identityHash: normalized.identityHash } }),
    ).resolves.toBeNull()
    await expect(prisma.newsIngestionRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toEqual(
      expect.objectContaining({ status: NewsIngestionRunStatus.RUNNING, fetchedCount: 0 }),
    )
    await expect(prisma.newsIngestionCursor.findUniqueOrThrow({ where: { id: cursor.id } })).resolves.toEqual(
      expect.objectContaining({ version: cursor.version }),
    )
  })

  it('NEWS-DATA-017: 数据库拒绝破坏 Run 计数守恒', async () => {
    await expect(
      prisma.newsIngestionRun.update({
        where: { id: runIds[0] },
        data: { fetchedCount: 999 },
      }),
    ).rejects.toThrow('news_ingestion_runs_counts_balance_check')
  })
})

function item(upstreamId: string, canonicalUrl: string | null, title: string): ProviderNewsItem {
  return {
    upstreamId,
    contentType: 'NEWS',
    title,
    excerpt: '集成测试摘要',
    publisher: '集成测试源',
    canonicalUrl,
    alternateUrls: [],
    publishedAt: new Date('2026-08-06T03:00:01.000Z'),
    publishedDate: null,
    publishedPrecision: 'SECOND',
    sourceDiscoveredAt: null,
    language: 'zh-CN',
    sourceCountry: 'CN',
    securityHints: [],
    category: null,
    sourceMetadata: { fixture: true },
    rawPayloadHash: upstreamId
      .padEnd(64, '0')
      .slice(0, 64)
      .replace(/[^a-f0-9]/g, 'a'),
  }
}
