import { AkshareNewsProvider, AKSHARE_FEEDS } from '../providers/akshare-news.provider'
import { GdeltNewsProvider, parseGdeltSeenDate } from '../providers/gdelt-news.provider'
import { NewsProviderError } from '../providers/news-provider.errors'
import type { NewsHttpTransport } from '../domain/news.types'
import { NewsIngestionService } from '../news-ingestion.service'

describe('News Provider 固定契约', () => {
  const config = {
    bridge: { baseUrl: 'http://news-source-bridge:8080', token: 't'.repeat(32), timeoutMs: 15_000 },
    gdelt: { baseUrl: 'https://api.gdeltproject.org/api/v2/doc/doc', timeoutMs: 60_000, minIntervalMs: 60_000 },
  } as never

  it('NEWS-BIZ-001: AKShare Bridge envelope 映射并只调用固定路由', async () => {
    const requestJson = jest.fn().mockResolvedValue({
      schemaVersion: 1,
      requestId: 'request-1',
      retrievedAt: '2026-08-06T04:00:00.000Z',
      items: [
        {
          upstreamId: 'em-1',
          contentType: 'NEWS',
          title: '东财新闻',
          excerpt: '摘要',
          publisher: '东方财富',
          canonicalUrl: 'https://example.com/1',
          alternateUrls: [],
          publishedAt: '2026-08-06T12:00:01+08:00',
          publishedDate: null,
          publishedPrecision: 'SECOND',
          securityHints: [],
          sourceMetadata: {},
          rawPayloadHash: 'a'.repeat(64),
        },
      ],
      warnings: [],
    })
    const provider = new AkshareNewsProvider({ requestJson } as NewsHttpTransport, config)
    const batch = await provider.fetch(
      { feedKey: AKSHARE_FEEDS.EASTMONEY, partitionKey: 'default' },
      new AbortController().signal,
    )
    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/\/v1\/feeds\/eastmoney\/latest$/),
        method: 'POST',
        body: {},
      }),
    )
    expect(batch.items[0]).toEqual(expect.objectContaining({ title: '东财新闻', publishedPrecision: 'SECOND' }))
  })

  it('NEWS-ERR-007/S-008: AKShare 单条坏日期只隔离该行，合法项仍可提交', async () => {
    const requestJson = jest.fn().mockResolvedValue({
      schemaVersion: 1,
      requestId: 'request-mixed-batch',
      retrievedAt: '2026-08-06T04:00:00.000Z',
      items: [
        {
          upstreamId: 'em-valid',
          contentType: 'NEWS',
          title: '合法新闻',
          excerpt: '合法摘要',
          publisher: '东方财富',
          canonicalUrl: 'https://example.com/valid',
          alternateUrls: [],
          publishedAt: '2026-08-06T12:00:01+08:00',
          publishedDate: null,
          publishedPrecision: 'SECOND',
          securityHints: [],
          sourceMetadata: {},
          rawPayloadHash: 'a'.repeat(64),
        },
        {
          upstreamId: 'em-invalid-date',
          contentType: 'NEWS',
          title: '坏日期新闻',
          excerpt: '该行应隔离',
          publisher: '东方财富',
          canonicalUrl: 'https://example.com/invalid-date',
          alternateUrls: [],
          publishedAt: 'not-a-date',
          publishedDate: null,
          publishedPrecision: 'SECOND',
          securityHints: [],
          sourceMetadata: {},
          rawPayloadHash: 'b'.repeat(64),
        },
      ],
      warnings: [],
    })
    const provider = new AkshareNewsProvider({ requestJson } as NewsHttpTransport, config)
    const run = {
      id: 'run-mixed-akshare-batch',
      commandId: 'command-1',
      status: 'QUEUED',
      operation: 'POLL_FEED',
      providerKey: 'AKSHARE',
      feedKey: AKSHARE_FEEDS.EASTMONEY,
      partitionKey: 'default',
      command: { requestSpec: {} },
    }
    const repository = {
      getRun: jest.fn().mockResolvedValue(run),
      ensureCursor: jest.fn().mockResolvedValue({
        id: 'cursor-1',
        version: 0,
        providerCursor: null,
        watermarkAt: null,
      }),
      markRunRunning: jest.fn().mockResolvedValue(true),
      refreshCommandStatus: jest.fn().mockResolvedValue(undefined),
      resolveSecurityHints: jest.fn().mockResolvedValue({ resolved: [], unresolved: [] }),
      commitBatch: jest.fn().mockResolvedValue(undefined),
      markRunFailed: jest.fn().mockResolvedValue(undefined),
    }
    const circuit = {
      acquire: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    }
    const service = new NewsIngestionService(
      repository as never,
      {
        getCapability: jest.fn().mockReturnValue({ sourceType: 'MEDIA' }),
        getProvider: jest.fn().mockReturnValue(provider),
      } as never,
      circuit as never,
      { excerptMaxChars: 1_000 } as never,
      { now: () => new Date('2026-08-06T04:00:00.000Z') },
    )

    let outcome = 'resolved'
    try {
      await service.executeRun(run.id)
    } catch (error) {
      outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`
    }
    const committed = repository.commitBatch.mock.calls[0]?.[0]

    expect({
      outcome,
      commitCalls: repository.commitBatch.mock.calls.length,
      preparedTitles: committed?.items.map((item: { title: string }) => item.title) ?? [],
      quarantinedCount: committed?.quarantined.length ?? 0,
      markRunFailedCalls: repository.markRunFailed.mock.calls.length,
      recordFailureCalls: circuit.recordFailure.mock.calls.length,
    }).toEqual({
      outcome: 'resolved',
      commitCalls: 1,
      preparedTitles: ['合法新闻'],
      quarantinedCount: 1,
      markRunFailedCalls: 0,
      recordFailureCalls: 0,
    })
  })

  it('NEWS-BIZ-005: GDELT 使用服务端固定 query，seendate 只作发现时间', async () => {
    const requestJson = jest.fn().mockResolvedValue({
      articles: [
        {
          url: 'https://example.com/a',
          url_mobile: 'https://m.example.com/a',
          title: 'Risk',
          seendate: '20260806T040001Z',
          domain: 'example.com',
        },
      ],
    })
    const provider = new GdeltNewsProvider({ requestJson } as NewsHttpTransport, config)
    const batch = await provider.fetch(
      { feedKey: 'gdelt.risk.policy', partitionKey: 'default' },
      new AbortController().signal,
    )
    const requested = new URL(requestJson.mock.calls[0][0].url)
    expect(requested.searchParams.get('query')).toBe(
      '("monetary policy" OR "financial regulation" OR "central bank policy")',
    )
    expect(requested.searchParams.get('maxrecords')).toBe('250')
    expect(batch.items[0]).toEqual(
      expect.objectContaining({
        publishedAt: null,
        publishedPrecision: 'UNKNOWN',
        sourceDiscoveredAt: new Date('2026-08-06T04:00:01.000Z'),
        alternateUrls: ['https://m.example.com/a'],
      }),
    )
  })

  it('NEWS-EDGE-006/R-023: 并发主题仍按至少 60 秒间隔串行', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-06T04:00:00.000Z') })
    const requestJson = jest.fn().mockResolvedValue({ articles: [] })
    const provider = new GdeltNewsProvider({ requestJson } as NewsHttpTransport, config)
    const signal = new AbortController().signal
    try {
      await provider.fetch({ feedKey: 'gdelt.risk.policy', partitionKey: 'default' }, signal)
      const second = provider.fetch({ feedKey: 'gdelt.risk.trade', partitionKey: 'default' }, signal)
      const third = provider.fetch({ feedKey: 'gdelt.risk.sanctions', partitionKey: 'default' }, signal)
      await Promise.resolve()
      expect(requestJson).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(60_000)
      await second
      expect(requestJson).toHaveBeenCalledTimes(2)
      await jest.advanceTimersByTimeAsync(60_000)
      await third
      expect(requestJson).toHaveBeenCalledTimes(3)
    } finally {
      jest.useRealTimers()
    }
  })

  it('NEWS-R3-GDELT-003: 429 无 Retry-After 时进入 15 分钟全局冷却', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-06T04:00:00.000Z') })
    const requestJson = jest
      .fn()
      .mockRejectedValueOnce(new NewsProviderError('UPSTREAM_RATE_LIMITED', true, '受限'))
      .mockResolvedValueOnce({ articles: [] })
    const provider = new GdeltNewsProvider({ requestJson } as NewsHttpTransport, config)
    const signal = new AbortController().signal
    try {
      await expect(provider.fetch({ feedKey: 'gdelt.risk.policy', partitionKey: 'default' }, signal)).rejects.toEqual(
        expect.objectContaining({ code: 'UPSTREAM_RATE_LIMITED', retryAfterMs: 15 * 60_000 }),
      )
      const second = provider.fetch({ feedKey: 'gdelt.risk.trade', partitionKey: 'default' }, signal)
      await jest.advanceTimersByTimeAsync(14 * 60_000 + 59_999)
      expect(requestJson).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)
      await second
      expect(requestJson).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('NEWS-R3-GDELT-004: 已等待请求在首请求 429 后重新检查延长的全局冷却', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-06T04:00:00.000Z') })
    let rejectFirst!: (error: Error) => void
    const firstResponse = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject
    })
    const requestJson = jest.fn().mockReturnValueOnce(firstResponse).mockResolvedValueOnce({ articles: [] })
    const provider = new GdeltNewsProvider({ requestJson } as NewsHttpTransport, config)
    const signal = new AbortController().signal
    try {
      const first = provider.fetch({ feedKey: 'gdelt.risk.policy', partitionKey: 'default' }, signal)
      await Promise.resolve()
      const waiting = provider.fetch({ feedKey: 'gdelt.risk.trade', partitionKey: 'default' }, signal)
      await Promise.resolve()
      rejectFirst(new NewsProviderError('UPSTREAM_RATE_LIMITED', true, '受限', 15 * 60_000))
      await expect(first).rejects.toEqual(expect.objectContaining({ code: 'UPSTREAM_RATE_LIMITED' }))

      await jest.advanceTimersByTimeAsync(60_000)
      expect(requestJson).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(14 * 60_000)
      await waiting
      expect(requestJson).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('NEWS-ERR-005: GDELT 不接受会被 Date 自动滚动的非法日历时间', () => {
    expect(() => parseGdeltSeenDate('20260230T040001Z')).toThrow('GDELT seendate 非法')
  })
})
