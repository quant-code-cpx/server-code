import { AiSearchFetchStatus, AiSourceType } from '@prisma/client'
import { buildWebSearchConfig } from 'src/config/web-search.config'
import { FakeSearchProvider } from '../providers/fake-search.provider'
import { SourceClassifierService } from '../source-classifier.service'
import { SsrfPolicyService } from '../ssrf-policy.service'
import { UrlTokenService } from '../url-token.service'
import { WebSearchService } from '../web-search.service'

const config = buildWebSearchConfig(
  {
    AGENT_SEARCH_PROVIDER: 'fake',
    AGENT_URL_TOKEN_SECRET: 'test-url-token-secret-32-characters-minimum',
  },
  'test',
)

describe('WebSearchService / UrlTokenService', () => {
  afterEach(() => jest.useRealTimers())

  it('默认关闭；真实 provider 缺 key/secret fail-fast，生产禁止 fake', () => {
    expect(buildWebSearchConfig({}, 'production')).toMatchObject({ provider: 'disabled', apiKey: null })
    expect(() => buildWebSearchConfig({ AGENT_SEARCH_PROVIDER: 'brave' }, 'production')).toThrow('API_KEY')
    expect(() => buildWebSearchConfig({ AGENT_SEARCH_PROVIDER: 'fake' }, 'production')).toThrow('禁止 fake')
    expect(() =>
      buildWebSearchConfig(
        {
          AGENT_SEARCH_PROVIDER: 'brave',
          AGENT_SEARCH_API_KEY: 'key',
          AGENT_URL_TOKEN_SECRET: 'test-url-token-secret-32-characters-minimum',
          AGENT_SEARCH_BASE_URL: 'https://example.com/res/v1/web/search',
        },
        'production',
      ),
    ).toThrow('官方 HTTPS')
  })

  it('搜索结果 canonicalize/去重/服务端来源分类并持久化，snippet 明确不可引用', async () => {
    const provider = new FakeSearchProvider([
      {
        url: 'https://www.sse.com.cn/disclosure/list?utm_source=feed#latest',
        title: '贵州茅台 公告',
        snippet: '贵州茅台发布公告摘要',
        publisher: '上海证券交易所',
        publishedAt: new Date('2026-07-19T01:00:00.000Z'),
      },
      {
        url: 'https://www.sse.com.cn/disclosure/list',
        title: '贵州茅台 公告重复页',
        snippet: '贵州茅台公告重复摘要',
        publisher: '上海证券交易所',
        publishedAt: new Date('2026-07-19T01:00:00.000Z'),
      },
      {
        url: 'http://127.0.0.1/internal',
        title: '贵州茅台 公告内网',
        snippet: '不应签发 token',
      },
    ])
    const citations = {
      createSearchSource: jest.fn(async (command) => ({
        id: 'source_1',
        canonicalUrl: command.url,
      })),
    }
    const logger = { log: jest.fn() }
    const service = new WebSearchService(
      provider,
      new SsrfPolicyService({ resolve: jest.fn() }),
      new SourceClassifierService(),
      new UrlTokenService(config),
      citations as never,
      logger as never,
    )

    const result = await service.search(
      { userId: 7, runId: 'run_1', abortSignal: new AbortController().signal },
      { query: '贵州茅台 公告', resultLimit: 10 },
    )

    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      canonicalUrl: 'https://www.sse.com.cn/disclosure/list',
      sourceType: 'EXCHANGE',
      rank: 1,
    })
    expect(result.warningCodes).toContain('SEARCH_SNIPPET_NOT_CITABLE')
    expect(result.warningCodes).toContain('SEARCH_RESULTS_REJECTED_BY_POLICY')
    expect(citations.createSearchSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: AiSourceType.OFFICIAL,
        fetchStatus: AiSearchFetchStatus.METADATA_ONLY,
        metadata: expect.objectContaining({ snippetCitable: false, toolSourceType: 'EXCHANGE' }),
      }),
    )
    expect(new UrlTokenService(config).verify(result.results[0].urlToken, { userId: 7, runId: 'run_1' })).toMatchObject(
      {
        sourceId: 'source_1',
        userId: 7,
        runId: 'run_1',
      },
    )
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('贵州茅台 公告')
  })

  it('URL token 绑定 user/run/urlHash，篡改、跨租户、跨 Run、过期全部拒绝', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T00:00:00.000Z'))
    const service = new UrlTokenService({ ...config, urlTokenTtlSeconds: 30 })
    const token = service.issue({
      sourceId: 'source_1',
      userId: 7,
      runId: 'run_1',
      urlHash: 'a'.repeat(64),
    })
    expect(service.verify(token, { userId: 7, runId: 'run_1' }).urlHash).toBe('a'.repeat(64))
    expect(() => service.verify(token, { userId: 8, runId: 'run_1' })).toThrow('无效')
    expect(() => service.verify(token, { userId: 7, runId: 'run_2' })).toThrow('无效')
    expect(() => service.verify(`${token.slice(0, -1)}x`, { userId: 7, runId: 'run_1' })).toThrow('无效')
    jest.advanceTimersByTime(31_000)
    expect(() => service.verify(token, { userId: 7, runId: 'run_1' })).toThrow('无效')
  })
})
