import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildNewsPerformanceReport, type NewsPerformanceReportInput } from '../nonfunctional/news-performance-gate'
import {
  buildNewsCanaryMonitorConfig,
  createNewsCanaryMonitorState,
  recordNewsCanaryObservation,
  runNewsCanaryMonitorCycle,
  type NewsCanaryTradingCalendarWindow,
} from '../nonfunctional/news-canary-monitor'
import { loadSseNewsCanaryTradingCalendar } from '../nonfunctional/news-canary-trading-calendar.repository'
import {
  acquireNewsCanaryMonitorLock,
  readNewsCanaryMonitorState,
  writeNewsCanaryMonitorState,
} from '../nonfunctional/news-canary-monitor-store'
import type { NewsCanaryReport } from '../nonfunctional/news-canary'
import { buildHttpThrottleConfig } from 'src/config/http-throttle.config'
import { mergeNewsListRepositoryRows, type NewsListRepositoryRow } from '../news.repository'

describe('News Round 4 性能实测与连续 Canary 门禁', () => {
  describe('性能报告', () => {
    it('NEWS-R4-PERF-001/002/003: 50 万数据与正式负载全部达标才通过', () => {
      const report = buildNewsPerformanceReport(performanceInput())

      expect(report.status).toBe('PASSED')
      expect(report.dataset).toEqual({ articles: 500_000, securityLinks: 1_000_000, stocks: 1_000 })
      expect(report.load).toEqual(expect.objectContaining({ warmupRequests: 200, virtualUsers: 20, duration: '10m' }))
      expect(report.metrics).toEqual(
        expect.objectContaining({
          errorRate: 0.004,
          throughputPerSecond: 125,
          overall: expect.objectContaining({ p50Ms: 90, p95Ms: 490, p99Ms: 700, maxMs: 900 }),
          list: expect.objectContaining({ p95Ms: 299, p99Ms: 799 }),
          detail: expect.objectContaining({ p95Ms: 149 }),
        }),
      )
      expect(report.checks.every((check) => check.passed)).toBe(true)
      expect(JSON.stringify(report)).not.toContain('secret-token')
      expect(JSON.stringify(report)).not.toContain('postgresql://')
    })

    it('NEWS-R4-PERF-001/004: 数据量不足、指标缺失或超阈值保留 FAILED 证据', () => {
      const input = performanceInput()
      input.dataset.articles = 499_999
      delete input.k6Summary.metrics['http_req_duration{phase:measure,endpoint:detail}']
      input.k6Summary.metrics['http_req_failed{phase:measure}'].values.rate = 0.006

      const report = buildNewsPerformanceReport(input)

      expect(report.status).toBe('FAILED')
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'dataset.articles', passed: false, actual: 499_999 }),
          expect.objectContaining({ key: 'metrics.errorRate', passed: false, actual: 0.006 }),
          expect.objectContaining({ key: 'metrics.detail.p95Ms', passed: false, actual: null }),
        ]),
      )
    })

    it('NEWS-R4-PERF-004: setup 失败导致 0 个测量请求时不得伪造 PASSED', () => {
      const input = performanceInput()
      input.k6Summary.state = { testRunDurationMs: 4_000 }
      input.k6Summary.metrics['http_reqs{phase:measure}'].values = { count: 0, rate: 0 }
      for (const [metricName, metric] of Object.entries(input.k6Summary.metrics)) {
        if (metricName.includes('phase:measure') && metricName.includes('duration')) {
          metric.values = { 'p(50)': 0, 'p(95)': 0, 'p(99)': 0, max: 0 }
        }
      }

      const report = buildNewsPerformanceReport(input)

      expect(report.status).toBe('FAILED')
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'load.actualDurationMs', passed: false, actual: 4_000 }),
          expect.objectContaining({ key: 'metrics.requestCount', passed: false, actual: 0 }),
        ]),
      )
    })

    it('NEWS-R4-PERF-007: 生产限流默认不变，性能专用 API 可显式使用独立预算', () => {
      expect(buildHttpThrottleConfig({})).toEqual({ ttlMs: 10_000, limit: 20 })
      expect(buildHttpThrottleConfig({ HTTP_THROTTLE_LIMIT: '1000000', HTTP_THROTTLE_TTL_MS: '10000' })).toEqual({
        ttlMs: 10_000,
        limit: 1_000_000,
      })
      expect(() => buildHttpThrottleConfig({ HTTP_THROTTLE_LIMIT: '0' })).toThrow('HTTP_THROTTLE_LIMIT')
    })

    it('NEWS-R4-PERF-008: 关键字快照分支合并后仍保持游标次序、去重和限制', () => {
      const stable = [repositoryRow('a', 4), repositoryRow('c', 2)]
      const changed = [repositoryRow('b', 3), repositoryRow('a', 1)]

      expect(mergeNewsListRepositoryRows(stable, changed, 3).map((row) => row.articleId)).toEqual(['a', 'b', 'c'])
    })

    it('NEWS-R4-PERF-008: 关键字 SQL 分离稳定 Article trigram 与快照后变更分支', () => {
      const repository = readFileSync(join(process.cwd(), 'src/apps/news/news.repository.ts'), 'utf8')
      const migration = readFileSync(
        join(process.cwd(), 'prisma/migrations/20260806203000_news_keyword_snapshot_index/migration.sql'),
        'utf8',
      )

      expect(repository).toContain('a.updated_at <=')
      expect(repository).toContain('a.updated_at >')
      expect(repository).toContain("(a.title || ' ' || COALESCE(a.excerpt, '')) ILIKE")
      expect(repository).toContain("(r.title || ' ' || COALESCE(r.excerpt, '')) ILIKE")
      expect(migration).toContain('news_articles_updated_at_idx')
    })

    it('NEWS-R4-PERF-002/003: k6 固定 200 次预热、list p95 300ms 与脱敏 summary 产物', () => {
      const script = readFileSync(join(process.cwd(), 'test/performance/news/read-load.js'), 'utf8')

      expect(script).toContain('const WARMUP_REQUESTS = 200')
      expect(script).toContain("'http_req_duration{phase:measure,endpoint:list}': ['p(95)<300', 'p(99)<800']")
      expect(script).toContain("summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)']")
      expect(script).toContain('export function handleSummary(data)')
      expect(script).toContain('NEWS_PERF_SUMMARY_PATH')
    })

    it('NEWS-R4-PERF-006: 50 万实灌只在隔离事务内放宽 statement timeout', () => {
      const script = readFileSync(join(process.cwd(), 'scripts/seed-news-performance.ts'), 'utf8')

      expect(script).toContain("SET LOCAL statement_timeout = '3600s'")
      expect(script).toContain("SET LOCAL transaction_timeout = '3600s'")
      expect(script).not.toContain('ALTER DATABASE')
      expect(script).not.toContain('ALTER SYSTEM')
    })
  })

  describe('连续 Canary 记账与调度', () => {
    it('NEWS-R4-CANARY-001/002: 默认关闭；显式开启后使用 Provider 独立正式周期', () => {
      expect(buildNewsCanaryMonitorConfig({})).toEqual(expect.objectContaining({ enabled: false }))
      expect(
        buildNewsCanaryMonitorConfig({
          NEWS_CANARY_MONITOR_ENABLED: 'true',
          NEWS_CANARY_MONITOR_PROVIDERS: 'AKSHARE,GDELT',
        }),
      ).toEqual(
        expect.objectContaining({
          enabled: true,
          providers: ['AKSHARE', 'GDELT'],
          intervalMsByProvider: { AKSHARE: 86_400_000, GDELT: 900_000 },
        }),
      )
    })

    it('NEWS-R4-CANARY-004: 同上海日重跑不重复累加，跨观测日成功 +1，失败归零', () => {
      let state = createNewsCanaryMonitorState(new Date('2026-08-06T01:00:00.000Z'))
      const calendar = canaryTradingCalendar()
      state = recordCanaryObservation(
        state,
        'AKSHARE',
        canaryReport('PASSED', '2026-08-06T01:00:00.000Z'),
        86_400_000,
        calendar,
      )
      state = recordCanaryObservation(
        state,
        'AKSHARE',
        canaryReport('PASSED', '2026-08-06T12:00:00.000Z'),
        86_400_000,
        calendar,
      )
      expect(state.providers.AKSHARE.observations).toHaveLength(1)
      expect(state.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(1)

      state = recordCanaryObservation(
        state,
        'AKSHARE',
        canaryReport('PASSED', '2026-08-07T01:00:00.000Z'),
        86_400_000,
        calendar,
      )
      expect(state.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(2)

      state = recordCanaryObservation(
        state,
        'AKSHARE',
        canaryReport('FAILED', '2026-08-10T01:00:00.000Z'),
        86_400_000,
        calendar,
      )
      expect(state.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(0)
      expect(state.providers.AKSHARE.observations).toHaveLength(3)
    })

    it('NEWS-R4-CANARY-003: 失败后本周期不立即重试，只等待下一 dueAt', async () => {
      const config = buildNewsCanaryMonitorConfig({
        NEWS_CANARY_MONITOR_ENABLED: 'true',
        NEWS_CANARY_MONITOR_PROVIDERS: 'GDELT',
      })
      const runner = jest.fn().mockResolvedValue(canaryReport('FAILED', '2026-08-06T01:00:00.000Z'))
      const now = new Date('2026-08-06T01:00:00.000Z')

      const first = await runCanaryCycle({
        config,
        state: createNewsCanaryMonitorState(now),
        now,
        runProvider: runner,
        loadTradingCalendar: async () => canaryTradingCalendar(),
      })
      const second = await runCanaryCycle({
        config,
        state: first.state,
        now,
        runProvider: runner,
        loadTradingCalendar: async () => canaryTradingCalendar(),
      })

      expect(runner).toHaveBeenCalledTimes(1)
      expect(first.results).toEqual([{ providerKey: 'GDELT', status: 'FAILED' }])
      expect(second.results).toEqual([])
      expect(new Date(first.state.providers.GDELT.nextDueAt ?? 0).getTime()).toBe(now.getTime() + 900_000)
    })

    it('NEWS-R6-CANARY-001: 跨周末成功只累计 SSE 开市日，历史闭市日观测不冒充交易日', () => {
      const calendar = canaryTradingCalendar()
      let state = createNewsCanaryMonitorState(new Date('2026-08-06T01:00:00.000Z'))
      for (const at of [
        '2026-08-06T01:00:00.000Z',
        '2026-08-07T01:00:00.000Z',
        '2026-08-08T01:00:00.000Z',
        '2026-08-10T01:00:00.000Z',
      ]) {
        state = recordCanaryObservation(state, 'AKSHARE', canaryReport('PASSED', at), 86_400_000, calendar)
      }

      expect(state.providers.AKSHARE.observations).toHaveLength(4)
      expect(state.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(3)
    })

    it('NEWS-R6-CANARY-002/003: 漏掉中间开市日或开市日失败都会打断旧 streak', () => {
      const calendar = canaryTradingCalendar()
      let missed = createNewsCanaryMonitorState(new Date('2026-08-06T01:00:00.000Z'))
      missed = recordCanaryObservation(
        missed,
        'AKSHARE',
        canaryReport('PASSED', '2026-08-06T01:00:00.000Z'),
        86_400_000,
        calendar,
      )
      missed = recordCanaryObservation(
        missed,
        'AKSHARE',
        canaryReport('PASSED', '2026-08-10T01:00:00.000Z'),
        86_400_000,
        calendar,
      )
      expect(missed.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(1)

      let failed = createNewsCanaryMonitorState(new Date('2026-08-06T01:00:00.000Z'))
      for (const [status, at] of [
        ['PASSED', '2026-08-06T01:00:00.000Z'],
        ['FAILED', '2026-08-07T01:00:00.000Z'],
        ['PASSED', '2026-08-10T01:00:00.000Z'],
      ] as const) {
        failed = recordCanaryObservation(failed, 'AKSHARE', canaryReport(status, at), 86_400_000, calendar)
      }
      expect(failed.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(1)
    })

    it('NEWS-R6-CANARY-004: AKShare 在 SSE 闭市日不打上游，直接调度到下一开市日同一上海时刻', async () => {
      const config = buildNewsCanaryMonitorConfig({ NEWS_CANARY_MONITOR_ENABLED: 'true' })
      const runner = jest.fn().mockResolvedValue(canaryReport('PASSED', '2026-08-08T12:31:00.000Z'))
      const now = new Date('2026-08-08T12:31:00.000Z')

      const cycle = await runCanaryCycle({
        config,
        state: createNewsCanaryMonitorState(now),
        now,
        runProvider: runner,
        loadTradingCalendar: async () => canaryTradingCalendar(),
      })

      expect(runner).not.toHaveBeenCalled()
      expect(cycle.results).toEqual([{ providerKey: 'AKSHARE', status: 'SKIPPED_NON_TRADING_DAY' }])
      expect(cycle.state.providers.AKSHARE.observations).toHaveLength(0)
      expect(cycle.state.providers.AKSHARE.consecutiveSuccessfulObservationDays).toBe(0)
      expect(cycle.state.providers.AKSHARE.nextDueAt).toBe('2026-08-10T12:31:00.000Z')
    })

    it('NEWS-R6-CANARY-006: SSE 日历缺失时 fail-closed，不调用上游且按 poll interval 重试', async () => {
      const config = buildNewsCanaryMonitorConfig({ NEWS_CANARY_MONITOR_ENABLED: 'true' })
      const runner = jest.fn().mockResolvedValue(canaryReport('PASSED', '2026-08-07T12:31:00.000Z'))
      const now = new Date('2026-08-07T12:31:00.000Z')
      const unavailableLoaders: Array<() => Promise<NewsCanaryTradingCalendarWindow>> = [
        async () => {
          throw new Error('calendar unavailable')
        },
        async () => ({
          exchange: 'SSE',
          entries: [{ calendarDate: '2026-08-08', isOpen: false }],
        }),
      ]

      for (const loadTradingCalendar of unavailableLoaders) {
        const cycle = await runCanaryCycle({
          config,
          state: createNewsCanaryMonitorState(now),
          now,
          runProvider: runner,
          loadTradingCalendar,
        })

        expect(cycle.results).toEqual([{ providerKey: 'AKSHARE', status: 'CALENDAR_UNAVAILABLE' }])
        expect(cycle.state.providers.AKSHARE.observations).toHaveLength(0)
        expect(cycle.state.providers.AKSHARE.nextDueAt).toBe('2026-08-07T12:32:00.000Z')
      }
      expect(runner).not.toHaveBeenCalled()
    })

    it('NEWS-R6-CANARY-007: 运行适配器只读取 SSE 小窗口并把数据库开市标志转换为领域契约', async () => {
      const findSseCalendarEntries = jest.fn().mockResolvedValue([
        { calendarDate: new Date('2026-08-07T00:00:00.000Z'), isOpen: '1' },
        { calendarDate: new Date('2026-08-08T00:00:00.000Z'), isOpen: '0' },
      ])

      const calendar = await loadSseNewsCanaryTradingCalendar(
        { findSseCalendarEntries },
        new Date('2026-08-07T12:31:00.000Z'),
      )

      expect(calendar).toEqual({
        exchange: 'SSE',
        entries: [
          { calendarDate: '2026-08-07', isOpen: true },
          { calendarDate: '2026-08-08', isOpen: false },
        ],
      })
      expect(findSseCalendarEntries).toHaveBeenCalledWith({
        fromDate: new Date('2026-05-09T00:00:00.000Z'),
        toDate: new Date('2026-11-05T00:00:00.000Z'),
      })

      const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')
      const monitorService = compose.slice(
        compose.indexOf('  news-canary-monitor:'),
        compose.indexOf('  # ── Agent BullMQ Worker'),
      )
      expect(monitorService).toContain('@database:5432/quant_db?schema=public&connection_limit=2')
      expect(monitorService).toContain('database:\n        condition: service_healthy')
      expect(monitorService).toContain('pnpm exec prisma generate && pnpm run news:canary:monitor')
    })

    it('NEWS-R4-CANARY-005/006: 状态原子写入 0600，同目录只允许一个 monitor 锁', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'news-canary-monitor-'))
      try {
        const statePath = join(directory, 'state.json')
        const state = createNewsCanaryMonitorState(new Date('2026-08-06T01:00:00.000Z'))
        await writeNewsCanaryMonitorState(statePath, state)

        expect(await readNewsCanaryMonitorState(statePath)).toEqual(state)
        expect((await stat(statePath)).mode & 0o777).toBe(0o600)
        expect(await readFile(statePath, 'utf8')).not.toContain('.tmp')

        const release = await acquireNewsCanaryMonitorLock(directory)
        await expect(acquireNewsCanaryMonitorLock(directory)).rejects.toThrow('已有 Canary monitor 运行')
        await release()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })
})

function performanceInput(): NewsPerformanceReportInput {
  return {
    runId: 'news-perf-round4-20260806',
    generatedAt: '2026-08-06T01:00:00.000Z',
    profile: 'load',
    dataset: { articles: 500_000, securityLinks: 1_000_000, stocks: 1_000 },
    load: { warmupRequests: 200, virtualUsers: 20, duration: '10m', listWeight: 80, detailWeight: 20 },
    environment: {
      os: 'darwin arm64',
      cpuModel: 'test-cpu',
      cpuCores: 10,
      memoryBytes: 16_000_000_000,
      nodeVersion: 'v22.0.0',
      postgresVersion: 'PostgreSQL 17',
      redisVersion: '7.4',
    },
    k6Summary: {
      state: { testRunDurationMs: 600_000 },
      metrics: {
        'http_req_failed{phase:measure}': { values: { rate: 0.004 } },
        'http_reqs{phase:measure}': { values: { count: 75_000, rate: 125 } },
        'http_req_duration{phase:measure}': {
          values: { 'p(50)': 90, 'p(95)': 490, 'p(99)': 700, max: 900 },
        },
        'http_req_duration{phase:measure,endpoint:list}': {
          values: { 'p(50)': 80, 'p(95)': 299, 'p(99)': 799, max: 850 },
        },
        'http_req_duration{phase:measure,endpoint:detail}': {
          values: { 'p(50)': 100, 'p(95)': 149, 'p(99)': 300, max: 500 },
        },
      },
    },
  }
}

function canaryReport(status: NewsCanaryReport['status'], at: string): NewsCanaryReport {
  return {
    schemaVersion: 1,
    status,
    startedAt: at,
    finishedAt: at,
    evidence: [],
  }
}

function canaryTradingCalendar(): NewsCanaryTradingCalendarWindow {
  return {
    exchange: 'SSE',
    entries: [
      { calendarDate: '2026-08-06', isOpen: true },
      { calendarDate: '2026-08-07', isOpen: true },
      { calendarDate: '2026-08-08', isOpen: false },
      { calendarDate: '2026-08-09', isOpen: false },
      { calendarDate: '2026-08-10', isOpen: true },
      { calendarDate: '2026-08-11', isOpen: true },
    ],
  }
}

function recordCanaryObservation(
  state: ReturnType<typeof createNewsCanaryMonitorState>,
  providerKey: 'AKSHARE' | 'GDELT',
  report: NewsCanaryReport,
  intervalMs: number,
  calendar: NewsCanaryTradingCalendarWindow,
): ReturnType<typeof createNewsCanaryMonitorState> {
  return recordNewsCanaryObservation(state, providerKey, report, intervalMs, calendar)
}

async function runCanaryCycle(options: {
  config: ReturnType<typeof buildNewsCanaryMonitorConfig>
  state: ReturnType<typeof createNewsCanaryMonitorState>
  now: Date
  runProvider: (providerKey: 'AKSHARE' | 'GDELT') => Promise<NewsCanaryReport>
  loadTradingCalendar: (now: Date) => Promise<NewsCanaryTradingCalendarWindow>
}): Promise<{
  state: ReturnType<typeof createNewsCanaryMonitorState>
  results: Array<{ providerKey: 'AKSHARE' | 'GDELT'; status: string }>
}> {
  return runNewsCanaryMonitorCycle(options)
}

function repositoryRow(articleId: string, second: number): NewsListRepositoryRow {
  const at = new Date(`2026-08-06T04:00:0${second}.000Z`)
  return {
    articleId,
    revision: 1,
    contentType: 'NEWS',
    sourceType: 'MEDIA',
    title: articleId,
    excerpt: null,
    publisher: null,
    canonicalUrl: null,
    publishedAt: at,
    publishedDate: null,
    publishedPrecision: 'SECOND',
    firstSeenAt: at,
    timelineSortAt: at,
    securityCodes: [],
    providerKeys: [],
    qualityFlags: [],
  }
}
