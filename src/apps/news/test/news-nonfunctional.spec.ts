import { buildNewsCanaryPlan, runNewsProviderCanary } from '../nonfunctional/news-canary'
import { buildNewsPerformanceProfile } from '../nonfunctional/news-performance-profile'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('News Round 2 非功能与真实 Provider 门禁', () => {
  it('NEWS-R2-CANARY-001: 未显式 opt-in 时零网络请求', async () => {
    const fetcher = jest.fn()
    const report = await runNewsProviderCanary({
      env: {},
      fetcher,
      sleep: jest.fn(),
      now: () => new Date('2026-08-06T04:00:00.000Z'),
    })

    expect(report).toEqual({
      schemaVersion: 1,
      status: 'DISABLED',
      startedAt: '2026-08-06T04:00:00.000Z',
      finishedAt: '2026-08-06T04:00:00.000Z',
      evidence: [],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('NEWS-R2-CANARY-002/004: AKShare 只输出脱敏字段 manifest，不输出标题、URL 或 token', async () => {
    const secret = 'bridge-token-should-never-appear-1234567890'
    const fetcher = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        schemaVersion: 1,
        requestId: 'bridge-request-1',
        retrievedAt: '2026-08-06T04:00:00.000Z',
        items: [
          {
            upstreamId: 'upstream-1',
            contentType: 'NEWS',
            title: '敏感真实标题不应进入证据',
            canonicalUrl: 'https://example.test/private?token=leak',
            publishedAt: '2026-08-06T12:00:00.000+08:00',
            publishedDate: null,
            publishedPrecision: 'SECOND',
          },
        ],
        warnings: [],
      }),
    })
    const report = await runNewsProviderCanary({
      env: {
        NEWS_CANARY_ENABLED: 'true',
        NEWS_CANARY_PROVIDERS: 'AKSHARE',
        NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
        NEWS_AKSHARE_BRIDGE_BASE_URL: 'http://news-source-bridge:8080',
        NEWS_AKSHARE_BRIDGE_ALLOWED_HOST: 'news-source-bridge',
        NEWS_AKSHARE_BRIDGE_TOKEN: secret,
      },
      fetcher,
      sleep: jest.fn(),
      now: () => new Date('2026-08-06T04:00:00.000Z'),
    })

    expect(report.status).toBe('PASSED')
    expect(report.evidence[0]).toEqual(
      expect.objectContaining({
        providerKey: 'AKSHARE',
        itemCount: 1,
        requestId: 'bridge-request-1',
        fieldManifest: expect.arrayContaining(['title', 'canonicalUrl', 'publishedAt']),
        nullCountByField: expect.objectContaining({ publishedDate: 1 }),
      }),
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('敏感真实标题')
    expect(serialized).not.toContain('example.test')
    expect(serialized).not.toContain(secret)
    expect(JSON.parse(fetcher.mock.calls[3][1].body ?? '{}')).toEqual({
      security: '000001',
      beginDate: '20260707',
      endDate: '20260806',
    })
  })

  it('NEWS-R2-CANARY-003/NEWS-R3-GDELT-001/002: GDELT 固定五主题使用官方短语语法并保持至少 60 秒间隔', async () => {
    const fetcher = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ articles: [] }) })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const report = await runNewsProviderCanary({
      env: {
        NEWS_CANARY_ENABLED: 'true',
        NEWS_CANARY_PROVIDERS: 'GDELT',
        NEWS_GDELT_ENABLED: 'true',
        NEWS_GDELT_BASE_URL: 'https://api.gdeltproject.org/api/v2/doc/doc',
        NEWS_GDELT_MIN_INTERVAL_MS: '60000',
      },
      fetcher,
      sleep,
      now: () => new Date('2026-08-06T04:00:00.000Z'),
    })

    expect(report.status).toBe('PASSED')
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(sleep).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledWith(60000)
    for (const [url] of fetcher.mock.calls) {
      const parsed = new URL(url)
      expect(parsed.origin + parsed.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc')
      expect(parsed.searchParams.get('maxrecords')).toBe('250')
      expect(parsed.searchParams.get('query')).toBeTruthy()
      expect(parsed.searchParams.get('query')).not.toMatch(
        /\b(?:monetary policy|financial regulation|central bank policy|export controls|technology restrictions|geopolitical conflict|military escalation|trade restriction|trade dispute|supply chain disruption|shipping disruption|critical shortage)\b(?!")/,
      )
    }
  })

  it('NEWS-R3-GDELT-003: 首个 GDELT 探针被 429 时立即停止，不继续请求剩余主题', async () => {
    const fetcher = jest.fn().mockResolvedValue({ status: 429, json: async () => ({}) })
    const sleep = jest.fn().mockResolvedValue(undefined)

    const report = await runNewsProviderCanary({
      env: {
        NEWS_CANARY_ENABLED: 'true',
        NEWS_CANARY_PROVIDERS: 'GDELT',
        NEWS_GDELT_ENABLED: 'true',
      },
      fetcher,
      sleep,
      now: () => new Date('2026-08-06T04:00:00.000Z'),
    })

    expect(report.status).toBe('FAILED')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(report.evidence).toHaveLength(1)
    expect(report.evidence[0]).toEqual(expect.objectContaining({ errorCode: 'UPSTREAM_RATE_LIMITED' }))
  })

  it('NEWS-R2-CANARY-004: Schema 漂移只记录低敏错误码，不回显 payload', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ changed: 'raw-payload-must-not-leak' }),
    })
    const report = await runNewsProviderCanary({
      env: {
        NEWS_CANARY_ENABLED: 'true',
        NEWS_CANARY_PROVIDERS: 'GDELT',
        NEWS_GDELT_ENABLED: 'true',
      },
      fetcher,
      sleep: jest.fn(),
      now: () => new Date('2026-08-06T04:00:00.000Z'),
    })

    expect(report.status).toBe('FAILED')
    expect(report.evidence[0]).toEqual(expect.objectContaining({ ok: false, errorCode: 'UPSTREAM_SCHEMA_CHANGED' }))
    expect(JSON.stringify(report)).not.toContain('raw-payload-must-not-leak')
  })

  it('NEWS-R2-HARNESS-001/002/003: 负载配置要求隔离 schema、本地目标并保留正式默认时长', () => {
    expect(buildNewsPerformanceProfile({})).toEqual(expect.objectContaining({ enabled: false }))

    expect(() =>
      buildNewsPerformanceProfile({
        NEWS_PERF_ENABLED: 'true',
        NEWS_PERF_PROFILE: 'load',
        NEWS_PERF_BASE_URL: 'https://news.example.com',
        NEWS_PERF_DATASET_ID: 'news-perf-r2',
        NEWS_PERF_DATABASE_SCHEMA: 'news_perf_r2',
      }),
    ).toThrow('NEWS_PERF_BASE_URL 必须指向本机或受信内网服务')

    expect(
      buildNewsPerformanceProfile({
        NEWS_PERF_ENABLED: 'true',
        NEWS_PERF_PROFILE: 'load',
        NEWS_PERF_BASE_URL: 'http://quant_api:3000',
        NEWS_PERF_DATASET_ID: 'news-perf-r2',
        NEWS_PERF_DATABASE_SCHEMA: 'news_perf_r2',
      }),
    ).toEqual(
      expect.objectContaining({
        enabled: true,
        profile: 'load',
        virtualUsers: 20,
        duration: '10m',
        listWeight: 80,
        detailWeight: 20,
        thresholds: { errorRate: 0.005, p95Ms: 500 },
      }),
    )

    expect(
      buildNewsPerformanceProfile({
        NEWS_PERF_ENABLED: 'true',
        NEWS_PERF_PROFILE: 'soak',
        NEWS_PERF_BASE_URL: 'http://localhost:3000',
        NEWS_PERF_DATASET_ID: 'news-perf-r2',
        NEWS_PERF_DATABASE_SCHEMA: 'news_perf_r2',
      }),
    ).toEqual(expect.objectContaining({ duration: '2h', maximumSteadyStateMemoryGrowthRatio: 0.15 }))
  })

  it('NEWS-R2-HARNESS-001: canary plan 不接受未知 Provider', () => {
    expect(() =>
      buildNewsCanaryPlan({ NEWS_CANARY_ENABLED: 'true', NEWS_CANARY_PROVIDERS: 'AKSHARE,UNKNOWN' }),
    ).toThrow('NEWS_CANARY_PROVIDERS 只允许 AKSHARE/GDELT')
  })

  it('NEWS-R2-HARNESS-002: k6 脚本固定 80/20 本地读模型与设计阈值', () => {
    const script = readFileSync(join(process.cwd(), 'test/performance/news/read-load.js'), 'utf8')
    expect(script).toContain('const LIST_WEIGHT = 80')
    expect(script).toContain('const DETAIL_WEIGHT = 20')
    expect(script).toContain("'http_req_failed{phase:measure}': ['rate<0.005']")
    expect(script).toContain("'http_req_duration{phase:measure,endpoint:list}': ['p(95)<300', 'p(99)<800']")
    expect(script).toContain("'http_req_duration{phase:measure,endpoint:detail}': ['p(95)<150']")
    expect(script).not.toMatch(/https:\/\/(?!localhost)/)
  })

  it('NEWS-R2-HARNESS-004: k6 只访问绑定隔离 schema 的专用 API 进程', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')

    expect(compose).toContain('news-performance-app:')
    expect(compose).toContain(
      'DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@database:5432/quant_db?schema=${NEWS_PERF_DATABASE_SCHEMA:-news_perf_round2}&application_name=news-performance-app',
    )
    expect(compose).toContain('REDIS_HOST: news-performance-redis')
    expect(compose).toContain('NEWS_PERF_BASE_URL: http://news-performance-app:3000')
    expect(compose).not.toContain('NEWS_PERF_BASE_URL: http://app:3000')
  })
})
