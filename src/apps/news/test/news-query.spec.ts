import { NewsQueryService } from '../news-query.service'

describe('News 查询与快照契约', () => {
  const now = new Date('2026-08-06T04:00:00.000Z')
  const coverageResult = {
    generatedAt: now.toISOString(),
    overallStatus: 'READY',
    dataThrough: now.toISOString(),
    partial: false,
    warnings: [],
    feeds: [],
  }

  it('NEWS-ERR-009/RACE-006: cursor ≤512 且不能跨用户重放', async () => {
    const rows = [listRow('c12345678901234567890', 2), listRow('c22345678901234567890', 1)]
    const repository = {
      resolveScopeCodes: jest.fn().mockResolvedValue(undefined),
      listArticles: jest.fn().mockResolvedValue(rows),
    }
    const service = createService(repository)
    const dto = listDto({ limit: 1 })

    const first = await service.list(7, dto)

    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()
    expect(first.nextCursor!.length).toBeLessThanOrEqual(512)
    await expect(service.list(8, listDto({ limit: 1, cursor: first.nextCursor! }))).rejects.toEqual(
      expect.objectContaining({ definition: expect.objectContaining({ code: 7004 }) }),
    )
    expect(repository.listArticles).toHaveBeenCalledTimes(1)
  })

  it('NEWS-BIZ-010: detail 按聚合来源 20、修订 50 上限返回 wrapper', async () => {
    const providerItems = Array.from({ length: 21 }, (_, index) => ({
      providerKey: `P${String(index).padStart(2, '0')}`,
      feedKey: `feed.${String(index).padStart(2, '0')}`,
      upstreamId: `upstream-${index}`,
      sourceDiscoveredAt: new Date(now.getTime() + index * 1_000),
      firstSeenAt: new Date(now.getTime() + index * 1_000),
      lastSeenAt: new Date(now.getTime() + index * 2_000),
      retrievedAt: new Date(now.getTime() + index * 2_000),
    }))
    const revisions = Array.from({ length: 51 }, (_, index) => {
      const revision = 55 - index
      return {
        revision,
        contentType: 'NEWS',
        sourceType: 'MEDIA',
        title: `标题 ${revision}`,
        excerpt: null,
        publisher: '测试源',
        canonicalUrl: 'https://example.test/a',
        alternateUrls: [],
        publishedAt: now,
        publishedDate: null,
        publishedPrecision: 'SECOND',
        qualityFlags: [],
        createdAt: new Date(now.getTime() + revision * 1_000),
      }
    })
    const repository = {
      getArticleDetail: jest.fn().mockResolvedValue({
        id: 'c12345678901234567890',
        currentRevision: 55,
        contentType: 'NEWS',
        sourceType: 'MEDIA',
        title: '标题 55',
        excerpt: null,
        publisher: '测试源',
        canonicalUrl: 'https://example.test/a',
        alternateUrls: ['https://m.example.test/a'],
        publishedAt: now,
        publishedDate: null,
        publishedPrecision: 'SECOND',
        firstSeenAt: now,
        qualityFlags: [],
        securityLinks: [{ tsCode: '600519.SH' }],
        providerItems,
        revisions,
        _count: { revisions: 55, providerItems: 21 },
      }),
    }
    const capabilities = providerItems.map((item) => ({
      providerKey: item.providerKey,
      providerDisplayName: item.providerKey,
      feedKey: item.feedKey,
      feedDisplayName: item.feedKey,
      sourceType: 'MEDIA',
    }))
    const coverage = { getCoverage: jest.fn().mockResolvedValue(coverageResult) }
    const service = createService(repository, coverage, { allCapabilities: () => capabilities })

    const detail = await service.detail('c12345678901234567890')

    expect(detail.sources).toEqual(expect.objectContaining({ total: 21, truncated: true }))
    expect(detail.sources.items).toHaveLength(20)
    expect(detail.revisions).toEqual(expect.objectContaining({ total: 55, truncated: true }))
    expect(detail.revisions.items).toHaveLength(50)
    expect(detail.revisions.items[0].revision).toBe(55)
    expect(detail.revisions.items.at(-1)?.revision).toBe(6)
    expect(coverage.getCoverage).toHaveBeenCalledWith({ feedKeys: providerItems.map((item) => item.feedKey) })
  })
})

function createService(
  repository: unknown,
  coverage: unknown = undefined,
  registry: unknown = undefined,
): NewsQueryService {
  return new NewsQueryService(
    repository as never,
    (coverage ?? { getCoverage: jest.fn().mockResolvedValue(coverageResultForFactory()) }) as never,
    (registry ?? { allCapabilities: () => [] }) as never,
    {
      enabled: true,
      cursorSecret: 'news-query-test-secret-that-is-32-bytes',
      cursorTtlSeconds: 86_400,
      detailRevisionLimit: 50,
    } as never,
    { now: () => new Date('2026-08-06T04:00:00.000Z') },
  )
}

function coverageResultForFactory() {
  return {
    generatedAt: '2026-08-06T04:00:00.000Z',
    overallStatus: 'READY',
    dataThrough: '2026-08-06T04:00:00.000Z',
    partial: false,
    warnings: [],
    feeds: [],
  }
}

function listDto(overrides: Record<string, unknown> = {}) {
  return {
    limit: 30,
    scope: 'ALL',
    includeUnknownPublishedTime: false,
    ...overrides,
  } as never
}

function listRow(articleId: string, secondOffset: number) {
  return {
    articleId,
    revision: 1,
    contentType: 'NEWS',
    sourceType: 'MEDIA',
    title: `标题 ${secondOffset}`,
    excerpt: null,
    publisher: '测试源',
    canonicalUrl: `https://example.test/${secondOffset}`,
    publishedAt: new Date(`2026-08-06T03:00:0${secondOffset}.000Z`),
    publishedDate: null,
    publishedPrecision: 'SECOND',
    firstSeenAt: new Date(`2026-08-06T03:00:0${secondOffset}.000Z`),
    timelineSortAt: new Date(`2026-08-06T03:00:0${secondOffset}.000Z`),
    securityCodes: [],
    providerKeys: ['FAKE'],
    qualityFlags: [],
  }
}
