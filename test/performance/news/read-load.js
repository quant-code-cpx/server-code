import http from 'k6/http'
import { check } from 'k6'

const LIST_WEIGHT = 80
const DETAIL_WEIGHT = 20
const WARMUP_REQUESTS = 200
const PROFILE = __ENV.NEWS_PERF_PROFILE || 'smoke'
const BASE_URL = normalizeLocalBaseUrl(__ENV.NEWS_PERF_BASE_URL || 'http://app:3000')
const ACCESS_TOKEN_FILE = __ENV.NEWS_PERF_ACCESS_TOKEN_FILE || ''
const ACCESS_TOKEN = ACCESS_TOKEN_FILE ? open(ACCESS_TOKEN_FILE).trim() : __ENV.NEWS_PERF_ACCESS_TOKEN || ''
const PROFILE_DEFAULTS = {
  smoke: { vus: 1, duration: '10s' },
  load: { vus: 20, duration: '10m' },
  stress: { vus: 40, duration: '5m' },
  soak: { vus: 20, duration: '2h' },
}

if (__ENV.NEWS_PERF_ENABLED !== 'true') throw new Error('NEWS_PERF_ENABLED=true 才允许执行新闻性能门禁')
if (!PROFILE_DEFAULTS[PROFILE]) throw new Error('NEWS_PERF_PROFILE 只允许 smoke/load/stress/soak')
if (!ACCESS_TOKEN) throw new Error('新闻性能专用 access token 不能为空')
if (LIST_WEIGHT + DETAIL_WEIGHT !== 100) throw new Error('新闻读模型权重必须等于 100')

const selected = PROFILE_DEFAULTS[PROFILE]
const duration = __ENV.NEWS_PERF_DURATION || selected.duration
const vus = Number(__ENV.NEWS_PERF_VUS || selected.vus)

export const options = {
  scenarios:
    PROFILE === 'stress'
      ? {
          news_read: {
            executor: 'ramping-vus',
            startVUs: 1,
            stages: [
              { duration: '30s', target: 5 },
              { duration: '30s', target: 10 },
              { duration: '30s', target: 20 },
              { duration, target: vus },
              { duration: '30s', target: 0 },
            ],
          },
        }
      : { news_read: { executor: 'constant-vus', vus, duration } },
  thresholds: {
    'http_req_failed{phase:measure}': ['rate<0.005'],
    'http_reqs{phase:measure}': ['count>0'],
    'http_req_duration{phase:measure}': ['p(95)<500'],
    'http_req_duration{phase:measure,endpoint:list}': ['p(95)<300', 'p(99)<800'],
    'http_req_duration{phase:measure,endpoint:detail}': ['p(95)<150'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
  noConnectionReuse: false,
  userAgent: 'quant-news-local-performance/1.0',
}

const headers = {
  authorization: `Bearer ${ACCESS_TOKEN}`,
  'content-type': 'application/json',
}

export function setup() {
  let articleIds = []
  for (let index = 0; index < WARMUP_REQUESTS; index += 1) {
    const response = listRequest('warmup')
    const valid = check(response, { 'warmup list 返回 200': (result) => result.status === 200 })
    if (!valid) throw new Error(`新闻性能预热失败，HTTP ${response.status}`)
    if (articleIds.length === 0) {
      const body = response.json()
      const items = body && body.data && Array.isArray(body.data.items) ? body.data.items : []
      articleIds = items.map((item) => item.articleId).filter(Boolean)
    }
  }
  if (articleIds.length === 0) throw new Error('新闻性能隔离数据集为空')
  return { articleIds }
}

export default function (data) {
  const selector = (__ITER % 100) + 1
  if (selector <= LIST_WEIGHT) {
    const response = listRequest('measure')
    check(response, { 'list 返回 200': (result) => result.status === 200 })
    return
  }

  const index = (__ITER + __VU) % data.articleIds.length
  const response = http.post(
    `${BASE_URL}/api/news/articles/detail`,
    JSON.stringify({ articleId: data.articleIds[index] }),
    { headers, tags: { phase: 'measure', endpoint: 'detail' } },
  )
  check(response, { 'detail 返回 200': (result) => result.status === 200 })
}

export function handleSummary(data) {
  const summaryPath = __ENV.NEWS_PERF_SUMMARY_PATH || '/reports/news-perf-k6-summary.json'
  if (!/^\/reports\/[a-zA-Z0-9._-]+\.json$/.test(summaryPath)) {
    throw new Error('NEWS_PERF_SUMMARY_PATH 必须是 /reports 下的 JSON 文件')
  }
  return {
    [summaryPath]: JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profile: PROFILE,
        state: data.state,
        metrics: data.metrics,
      },
      null,
      2,
    ),
  }
}

function listRequest(phase) {
  return http.post(`${BASE_URL}/api/news/articles/list`, JSON.stringify({ scope: 'ALL', limit: 50 }), {
    headers,
    tags: { phase, endpoint: 'list' },
  })
}

function normalizeLocalBaseUrl(raw) {
  const match = raw.match(/^http:\/\/([^/:?#]+)(?::(\d+))?\/?$/)
  if (!match) throw new Error('NEWS_PERF_BASE_URL 只允许无凭据/query 的本地 HTTP origin')
  const host = match[1].toLowerCase()
  const trusted =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    !host.includes('.') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.endsWith('.svc') ||
    host.includes('.svc.')
  if (!trusted) throw new Error('NEWS_PERF_BASE_URL 必须指向本机或受信内网服务')
  return raw.replace(/\/$/, '')
}
