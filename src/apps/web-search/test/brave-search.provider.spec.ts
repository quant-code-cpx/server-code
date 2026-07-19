import { buildWebSearchConfig } from 'src/config/web-search.config'
import { BraveSearchProvider } from '../providers/brave-search.provider'

describe('BraveSearchProvider', () => {
  afterEach(() => jest.restoreAllMocks())

  it('使用官方 endpoint/header/query contract，映射 web.results 且不跟随 redirect', async () => {
    const config = buildWebSearchConfig(
      {
        AGENT_SEARCH_PROVIDER: 'brave',
        AGENT_SEARCH_API_KEY: 'brave-test-key',
        AGENT_URL_TOKEN_SECRET: 'test-url-token-secret-32-characters-minimum',
      },
      'test',
    )
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: '<strong>交易所公告</strong>',
                url: 'https://www.sse.com.cn/notice',
                description: '公告 <b>摘要</b>',
                page_age: '2026-07-19T00:00:00.000Z',
                language: 'zh-hans',
                profile: { long_name: '上海证券交易所' },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const provider = new BraveSearchProvider(config)

    const result = await provider.search(
      {
        query: '贵州茅台 公告',
        resultLimit: 5,
        domains: ['sse.com.cn'],
        language: 'zh-CN',
      },
      new AbortController().signal,
    )

    const [requestUrl, request] = fetchMock.mock.calls[0]
    const url = new URL(String(requestUrl))
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(url.searchParams.get('q')).toContain('site:sse.com.cn')
    expect(url.searchParams.get('count')).toBe('5')
    expect(url.searchParams.get('search_lang')).toBe('zh-hans')
    expect(request).toMatchObject({
      redirect: 'error',
      headers: expect.objectContaining({ 'X-Subscription-Token': 'brave-test-key' }),
    })
    expect(result.hits[0]).toMatchObject({
      title: '交易所公告',
      snippet: '公告 摘要',
      publisher: '上海证券交易所',
      publishedAt: new Date('2026-07-19T00:00:00.000Z'),
    })
  })
})
