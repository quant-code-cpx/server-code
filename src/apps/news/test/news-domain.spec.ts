import { NewsCursorCodec } from '../domain/news-cursor'
import { computeNewsIdentity } from '../domain/news-identity'
import { normalizeNewsItem } from '../domain/news-normalizer'
import { resolveNewsWindow } from '../domain/news-time'
import { normalizeNewsUrl } from '../domain/news-url'
import type { ProviderNewsItem } from '../domain/news.types'
import { NewsHttpException } from '../news.errors'

describe('News 领域契约', () => {
  const retrievedAt = new Date('2026-08-06T04:00:00.000Z')

  it('NEWS-EDGE-002: 1001 个 Unicode code point 截为 1000，emoji 不破坏', () => {
    const normalized = normalizeNewsItem({
      providerKey: 'FAKE',
      feedKey: 'fake.news',
      sourceType: 'MEDIA',
      item: item({ title: `${'中'.repeat(999)}😀X` }),
      retrievedAt,
    })
    expect(Array.from(normalized.title)).toHaveLength(1000)
    expect(normalized.title.endsWith('😀')).toBe(true)
    expect(normalized.qualityFlags).toContain('TRUNCATED')
  })

  it('NEWS-EDGE-003: NFKC、零宽、CRLF 与连续空白规范化确定', () => {
    const normalized = normalizeNewsItem({
      providerKey: 'FAKE',
      feedKey: 'fake.news',
      sourceType: 'MEDIA',
      item: item({ title: 'Ａ股\u200b\r\n  新闻' }),
      retrievedAt,
    })
    expect(normalized.title).toBe('A股 新闻')
  })

  it('NEWS-EDGE-004/005: 无 URL 与 UNKNOWN 时间合法且带质量标记', () => {
    const normalized = normalizeNewsItem({
      providerKey: 'FAKE',
      feedKey: 'fake.flash',
      sourceType: 'MEDIA',
      item: item({ canonicalUrl: null, publishedAt: null, publishedPrecision: 'UNKNOWN' }),
      retrievedAt,
    })
    expect(normalized.canonicalUrl).toBeNull()
    expect(normalized.qualityFlags).toEqual(expect.arrayContaining(['MISSING_CANONICAL_URL', 'PUBLISHED_TIME_UNKNOWN']))
    expect(normalized.upstreamId).toMatch(/^synthetic:v1:/)
  })

  it('NEWS-ERR-URL: URL 仅保留 HTTP(S)，移除跟踪参数、fragment 与默认端口', () => {
    expect(normalizeNewsUrl('HTTPS://Example.COM:443/a?utm_source=x&id=7#part')).toBe('https://example.com/a?id=7')
    expect(() => normalizeNewsUrl('javascript:alert(1)')).toThrow('NEWS_URL_PROTOCOL_INVALID')
  })

  it('NEWS-BIZ-IDENTITY: 有 canonical URL 时跨 Provider 身份一致', () => {
    const left = computeNewsIdentity({
      canonicalUrl: 'https://example.com/a',
      providerKey: 'A',
      feedKey: 'a',
      upstreamId: '1',
    })
    const right = computeNewsIdentity({
      canonicalUrl: 'https://example.com/a',
      providerKey: 'B',
      feedKey: 'b',
      upstreamId: '2',
    })
    expect(left).toBe(right)
  })

  it('NEWS-BIZ-007: 默认窗口是上海当日及前 6 个日历日起点到 now', () => {
    const window = resolveNewsWindow(undefined, undefined, new Date('2026-08-06T04:00:00.000Z'))
    expect(window.after.toISOString()).toBe('2026-07-30T16:00:00.000Z')
    expect(window.before.toISOString()).toBe('2026-08-06T04:00:00.000Z')
  })

  it('NEWS-ERR-005: 自定义窗口缺一端或超过 90 天拒绝', () => {
    expect(() => resolveNewsWindow('2026-08-01T00:00:00.000Z', undefined, retrievedAt)).toThrow(NewsHttpException)
    expect(() => resolveNewsWindow('2026-01-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', retrievedAt)).toThrow(
      expect.objectContaining({ definition: expect.objectContaining({ code: 7006 }) }),
    )
  })

  it('NEWS-ERR-001/002: cursor 验签、过期和结构错误使用稳定 code', () => {
    const codec = new NewsCursorCodec('x'.repeat(32), 60)
    const cursor = codec.encode(
      {
        snapshotAt: retrievedAt.toISOString(),
        effectiveAfter: '2026-08-01T00:00:00.000Z',
        effectiveBefore: retrievedAt.toISOString(),
        queryHash: 'a'.repeat(64),
        scopeFingerprint: 'b'.repeat(64),
        timelineSortAt: retrievedAt.toISOString(),
        firstSeenAt: retrievedAt.toISOString(),
        articleId: 'c12345678901234567890',
      },
      retrievedAt,
    )
    expect(codec.decode(cursor, new Date(retrievedAt.getTime() + 59_000)).articleId).toBe('c12345678901234567890')
    expectExceptionCode(() => codec.decode(`${cursor}x`, retrievedAt), 7002)
    expectExceptionCode(() => codec.decode(cursor, new Date(retrievedAt.getTime() + 60_000)), 7003)
  })
})

function item(overrides: Partial<ProviderNewsItem> = {}): ProviderNewsItem {
  return {
    upstreamId: '',
    contentType: 'NEWS',
    title: '测试新闻',
    excerpt: '摘要',
    publisher: '测试源',
    canonicalUrl: 'https://example.com/news?id=1&utm_source=test',
    alternateUrls: [],
    publishedAt: new Date('2026-08-06T03:00:01.000Z'),
    publishedDate: null,
    publishedPrecision: 'SECOND',
    sourceDiscoveredAt: null,
    language: 'zh-CN',
    sourceCountry: 'CN',
    securityHints: [],
    category: null,
    sourceMetadata: {},
    rawPayloadHash: 'a'.repeat(64),
    ...overrides,
  }
}

function expectExceptionCode(call: () => unknown, code: number): void {
  try {
    call()
    throw new Error('预期抛出 NewsHttpException')
  } catch (error) {
    expect(error).toBeInstanceOf(NewsHttpException)
    expect((error as NewsHttpException).definition.code).toBe(code)
  }
}
