import { buildNewsConfig } from 'src/config/news.config'

describe('NEWS-SEC-004: News 配置 fail fast', () => {
  const secret = 'news-cursor-secret-that-is-at-least-32-bytes'
  const token = 'news-bridge-token-that-is-at-least-32-bytes'

  it('模块启用时要求独立的 32 字节 cursor secret 和固定 24h TTL', () => {
    expect(() => buildNewsConfig({ NEWS_ENABLED: 'true', NEWS_CURSOR_SECRET: 'short' })).toThrow(
      'NEWS_CURSOR_SECRET 至少 32 字节',
    )
    expect(() =>
      buildNewsConfig({ NEWS_ENABLED: 'true', NEWS_CURSOR_SECRET: secret, NEWS_CURSOR_TTL_SECONDS: '3600' }),
    ).toThrow('NEWS_CURSOR_TTL_SECONDS 必须是 86400-86400 的整数')
    expect(() =>
      buildNewsConfig({
        NEWS_ENABLED: 'true',
        NEWS_CURSOR_SECRET: secret,
        NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
        NEWS_AKSHARE_BRIDGE_TOKEN: secret,
      }),
    ).toThrow('不得复用 Bridge token')
  })

  it.each([
    ['http://127.0.0.1:8080', '127.0.0.1'],
    ['http://169.254.169.254', '169.254.169.254'],
    ['https://example.com', 'example.com'],
    ['http://news-source-bridge:8080/redirect', 'news-source-bridge'],
  ])('Bridge 拒绝非固定内网 origin：%s', (baseUrl, allowedHost) => {
    expect(() =>
      buildNewsConfig({
        NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
        NEWS_AKSHARE_BRIDGE_BASE_URL: baseUrl,
        NEWS_AKSHARE_BRIDGE_ALLOWED_HOST: allowedHost,
        NEWS_AKSHARE_BRIDGE_TOKEN: token,
      }),
    ).toThrow()
  })

  it('固定 Compose DNS origin 可启用', () => {
    expect(
      buildNewsConfig({
        NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
        NEWS_AKSHARE_BRIDGE_BASE_URL: 'http://news-source-bridge:8080',
        NEWS_AKSHARE_BRIDGE_ALLOWED_HOST: 'news-source-bridge',
        NEWS_AKSHARE_BRIDGE_TOKEN: token,
      }).bridge.enabled,
    ).toBe(true)
  })

  it('NEWS-R3-GDELT-002: GDELT 默认超时与最小请求间隔均为 60 秒', () => {
    expect(buildNewsConfig({}).gdelt).toEqual(
      expect.objectContaining({
        timeoutMs: 60_000,
        minIntervalMs: 60_000,
      }),
    )
    expect(() => buildNewsConfig({ NEWS_GDELT_MIN_INTERVAL_MS: '59999' })).toThrow(
      'NEWS_GDELT_MIN_INTERVAL_MS 必须是 60000-900000 的整数',
    )
  })
})
