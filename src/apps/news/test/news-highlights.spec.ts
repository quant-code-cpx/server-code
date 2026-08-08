import { createHighlightsResponse, NewsHighlightsService, rankHighlightCandidates } from '../news-highlights.service'
import type { NewsListRepositoryRow } from '../news.repository'

describe('首页新闻 highlights 排名与降级', () => {
  const baseNow = new Date('2026-08-08T04:00:00.000Z')
  const readyCoverage = {
    generatedAt: baseNow.toISOString(),
    overallStatus: 'READY' as const,
    dataThrough: '2026-08-08T03:59:00.000Z',
    partial: false,
    warnings: [],
    feeds: [],
  }

  it('相同分数按有效时间、首次发现时间、articleId 稳定排序', () => {
    const rows = [
      row('cccccccccccccccccccc', { publishedAt: '2026-08-08T03:00:00.000Z' }),
      row('bbbbbbbbbbbbbbbbbbbb', { publishedAt: '2026-08-08T03:30:00.000Z' }),
      row('aaaaaaaaaaaaaaaaaaaa', { publishedAt: '2026-08-08T03:30:00.000Z' }),
    ]

    const ranked = rankHighlightCandidates(rows, baseNow)

    expect(ranked.map((item) => item.articleId)).toEqual([
      'aaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccc',
    ])
  })

  it('至少三条达到 impact-v1 阈值才进入 HIGHLIGHTS，并映射重大与重要等级', () => {
    const response = createHighlightsResponse(
      [
        row('criticalcriticalcrit', {
          contentType: 'NOTICE',
          sourceType: 'REGULATOR',
          title: '证监会发布重大市场处罚决定',
        }),
        row('majorcompanyarticle01', {
          contentType: 'NOTICE',
          sourceType: 'COMPANY',
          title: '公司发布重大资产收购公告',
          securityCodes: ['600000.SH'],
        }),
        row('majorexchangearticle', {
          contentType: 'FLASH',
          sourceType: 'EXCHANGE',
          title: '交易所发布 A股 市场交易监管动态',
        }),
        row('ordinaryordinaryor', {
          publishedAt: '2026-08-05T03:00:00.000Z',
          title: '普通公司日常经营动态',
        }),
      ],
      readyCoverage,
      baseNow,
      5,
    )

    expect(response).toMatchObject({
      rankingVersion: 'impact-v1',
      rankingStatus: 'READY',
      displayMode: 'HIGHLIGHTS',
      partial: false,
    })
    expect(response.items).toHaveLength(3)
    expect(response.items[0]).toMatchObject({
      articleId: 'criticalcriticalcrit',
      impactLevel: 'CRITICAL',
      reasonCodes: expect.arrayContaining(['AUTHORITATIVE_SOURCE', 'BREAKING_EVENT', 'FRESHNESS']),
    })
    expect(response.items.slice(1).map((item) => item.impactLevel)).toEqual(['MAJOR', 'MAJOR'])
  })

  it('impact-v1 严格限制五项加分和质量惩罚上限', () => {
    const [ranked] = rankHighlightCandidates(
      [
        row('scorecapsarticle0001', {
          contentType: 'NOTICE',
          sourceType: 'REGULATOR',
          title: '证监会发布重大 A股 调查',
          providerKeys: ['provider-a', 'provider-b', 'provider-c'],
          qualityFlags: ['duplicate', 'stale', 'low-confidence', 'missing-source', 'bad-link', 'other', 'extra'],
        }),
      ],
      baseNow,
    )

    expect(ranked).toMatchObject({
      impactScore: 70,
      impactLevel: 'MAJOR',
      reasonCodes: expect.arrayContaining(['CORROBORATED', 'MARKET_WIDE']),
    })
  })

  it('相似故事只在展示层聚类，并聚合来源数与关联文章数', () => {
    const response = createHighlightsResponse(
      [
        row('clusterrepresentative', {
          title: '央行宣布全面降准释放长期资金',
          providerKeys: ['provider-a'],
        }),
        row('clusterrelatedstory', {
          title: '央行宣布全面降准，释放长期资金',
          providerKeys: ['provider-b'],
          publishedAt: '2026-08-08T03:20:00.000Z',
        }),
        row('clusterthirdhighlight', {
          contentType: 'NOTICE',
          sourceType: 'REGULATOR',
          title: '证监会发布重大市场处罚决定',
        }),
        row('clusterfourthhighlight', {
          contentType: 'FLASH',
          sourceType: 'EXCHANGE',
          title: '交易所发布 A股 市场交易监管动态',
        }),
      ],
      readyCoverage,
      baseNow,
      5,
    )

    const cluster = response.items.find((item) => item.relatedArticleCount === 1)
    expect(response).toMatchObject({ displayMode: 'HIGHLIGHTS', rankingStatus: 'READY' })
    expect(response.items).toHaveLength(3)
    expect(cluster).toMatchObject({
      corroboratingSourceCount: 2,
      relatedArticleCount: 1,
      reasonCodes: expect.arrayContaining(['CORROBORATED']),
    })
  })

  it('全部低于阈值时稳定降级为 RECENT，而不是前端自行排序', () => {
    const response = createHighlightsResponse(
      [
        row('olderrecentarticle01', { publishedAt: '2026-08-07T03:00:00.000Z' }),
        row('newerrecentarticle01', { publishedAt: '2026-08-08T03:30:00.000Z' }),
      ],
      readyCoverage,
      baseNow,
      5,
    )

    expect(response).toMatchObject({ displayMode: 'RECENT', rankingStatus: 'RECENT_FALLBACK' })
    expect(response.items.map((item) => item.articleId)).toEqual(['newerrecentarticle01', 'olderrecentarticle01'])
    expect(response.items.every((item) => item.impactLevel === 'RECENT')).toBe(true)
  })

  it('少于三条达标新闻时降级为 RECENT，不用少量候选冒充重磅', () => {
    const response = createHighlightsResponse(
      [
        row('criticalbutinsufficient', {
          contentType: 'NOTICE',
          sourceType: 'REGULATOR',
          title: '证监会发布重大市场处罚决定',
        }),
        row('majorbutinsufficient1', {
          contentType: 'FLASH',
          sourceType: 'EXCHANGE',
          title: '交易所发布 A股 市场交易监管动态',
        }),
      ],
      readyCoverage,
      baseNow,
      5,
    )

    expect(response).toMatchObject({ displayMode: 'RECENT', rankingStatus: 'RECENT_FALLBACK' })
    expect(response.items.every((item) => item.impactLevel === 'RECENT')).toBe(true)
  })

  it('空数据保留 READY 空态，不伪造 recent 新闻', () => {
    const response = createHighlightsResponse([], readyCoverage, baseNow, 5)

    expect(response).toMatchObject({ displayMode: 'HIGHLIGHTS', rankingStatus: 'READY', items: [] })
  })

  it('一分钟内命中 fresh cache；刷新失败时十五分钟内返回 STALE cache', async () => {
    let now = new Date(baseNow)
    const repository = {
      listHighlightCandidates: jest.fn().mockResolvedValue(qualifiedRows()),
      listRecentArticles: jest.fn(),
    }
    const coverage = { getCoverage: jest.fn().mockResolvedValue(readyCoverage) }
    const service = new NewsHighlightsService(repository as never, coverage as never, {
      now: () => new Date(now),
    })

    const first = await service.getHighlights({ scope: 'ALL', limit: 5 })
    now = new Date(baseNow.getTime() + 30_000)
    const fresh = await service.getHighlights({ scope: 'ALL', limit: 3 })
    repository.listHighlightCandidates.mockRejectedValueOnce(new Error('ranking query unavailable'))
    now = new Date(baseNow.getTime() + 61_000)
    const stale = await service.getHighlights({ scope: 'ALL', limit: 5 })

    expect(first.items).toHaveLength(3)
    expect(fresh.rankingStatus).toBe('READY')
    expect(stale).toMatchObject({ rankingStatus: 'STALE', partial: true })
    expect(repository.listHighlightCandidates).toHaveBeenCalledTimes(2)
    expect(repository.listRecentArticles).not.toHaveBeenCalled()
  })

  it('无可用缓存且排名查询失败时使用独立 recent 查询降级', async () => {
    const repository = {
      listHighlightCandidates: jest.fn().mockRejectedValue(new Error('ranking query unavailable')),
      listRecentArticles: jest
        .fn()
        .mockResolvedValue([row('recentfallbackstory1', { publishedAt: '2026-08-08T03:45:00.000Z' })]),
    }
    const service = new NewsHighlightsService(repository as never, { getCoverage: jest.fn() } as never, {
      now: () => new Date(baseNow),
    })

    await expect(service.getHighlights({ scope: 'ALL', limit: 5 })).resolves.toMatchObject({
      rankingStatus: 'RECENT_FALLBACK',
      displayMode: 'RECENT',
      partial: true,
      items: [expect.objectContaining({ articleId: 'recentfallbackstory1', impactLevel: 'RECENT' })],
    })
  })
})

function row(
  articleId: string,
  overrides: Partial<Omit<NewsListRepositoryRow, 'publishedAt'>> & { publishedAt?: string | null } = {},
): NewsListRepositoryRow {
  const { publishedAt = '2026-08-08T03:30:00.000Z', ...rest } = overrides
  return {
    articleId,
    revision: 1,
    contentType: 'NEWS',
    sourceType: 'MEDIA',
    title: `普通市场动态 ${articleId}`,
    excerpt: null,
    publisher: '测试媒体',
    canonicalUrl: `https://example.test/${articleId}`,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    publishedDate: null,
    publishedPrecision: 'SECOND',
    firstSeenAt: new Date(publishedAt ?? '2026-08-08T03:30:00.000Z'),
    timelineSortAt: new Date(publishedAt ?? '2026-08-08T03:30:00.000Z'),
    securityCodes: [],
    providerKeys: ['provider-a'],
    qualityFlags: [],
    ...rest,
  }
}

function qualifiedRows(): NewsListRepositoryRow[] {
  return [
    row('cachedcriticalarticle', {
      contentType: 'NOTICE',
      sourceType: 'REGULATOR',
      title: '证监会发布重大市场处罚决定',
    }),
    row('cachedmajorcompany', {
      contentType: 'NOTICE',
      sourceType: 'COMPANY',
      title: '公司发布重大资产收购公告',
      securityCodes: ['600000.SH'],
    }),
    row('cachedmajorexchange', {
      contentType: 'FLASH',
      sourceType: 'EXCHANGE',
      title: '交易所发布 A股 市场交易监管动态',
    }),
  ]
}
