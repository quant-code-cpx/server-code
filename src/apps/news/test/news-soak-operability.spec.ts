import { NewsIngestionRunStatus } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildNewsFaultReport, type NewsFaultScenarioEvidence } from '../nonfunctional/news-fault-gate'
import {
  buildNewsSoakReport,
  type NewsSoakReportInput,
  type NewsSoakTelemetrySample,
} from '../nonfunctional/news-soak-gate'
import { decideNewsRunClaim, newsRunClaimRetryAfterMs } from '../nonfunctional/news-run-recovery-policy'
import { performanceAccessTokenTtlSeconds } from '../nonfunctional/news-performance-profile'

describe('News Round 5 两小时 SOAK 与故障恢复门禁', () => {
  it('NEWS-R5-SOAK-001/002/003/004: 两小时指标、资源趋势和数据不变量全部达标才通过', () => {
    const report = buildNewsSoakReport(soakInput())

    expect(report).toEqual(
      expect.objectContaining({
        status: 'PASSED',
        profile: 'soak',
        telemetry: expect.objectContaining({
          sampleCount: 121,
          steadyStateMemoryGrowthRatio: expect.any(Number),
          maximumSampleGapMs: 60_000,
          restartDelta: 0,
        }),
      }),
    )
    expect(JSON.stringify(report)).not.toMatch(/Bearer|postgresql:\/\/|secret-token/)
  })

  it('NEWS-R5-SOAK-005: 短时、零请求、缺采样不得伪造通过', () => {
    const input = soakInput()
    input.k6Summary.state = { testRunDurationMs: 600_000 }
    input.k6Summary.metrics['http_reqs{phase:measure}'].values = { count: 0, rate: 0 }
    input.telemetry = input.telemetry.slice(0, 10)

    const report = buildNewsSoakReport(input)

    expect(report.status).toBe('FAILED')
    expect(report).toEqual(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({ key: 'load.actualDurationMs', passed: false }),
          expect.objectContaining({ key: 'metrics.requestCount', passed: false }),
          expect.objectContaining({ key: 'telemetry.sampleCount', passed: false }),
        ]),
      }),
    )
  })

  it('NEWS-R5-SOAK-003/004: 稳态内存增长、进程重启或读路径写数据必须失败', () => {
    const input = soakInput()
    input.datasetAfter.articles += 1
    input.telemetry = telemetrySamples({ finalMemoryBytes: 1_250_000_000, finalRestartCount: 1 })

    const report = buildNewsSoakReport(input)

    expect(report.status).toBe('FAILED')
    expect(report).toEqual(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({ key: 'dataset.articles.unchanged', passed: false }),
          expect.objectContaining({ key: 'telemetry.steadyStateMemoryGrowthRatio', passed: false }),
          expect.objectContaining({ key: 'telemetry.restartDelta', passed: false }),
        ]),
      }),
    )
  })

  it('NEWS-R5-SOAK-004/005: Provider 日志扫描失败不得用伪造请求数替代，也不得通过', () => {
    const input = soakInput() as NewsSoakReportInput & { externalProviderLogScanCompleted: boolean }
    input.externalProviderLogScanCompleted = false

    const report = buildNewsSoakReport(input)

    expect(report.status).toBe('FAILED')
    expect(report).toEqual(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({ key: 'externalProviderLogScanCompleted', passed: false }),
        ]),
      }),
    )
  })

  it('NEWS-R5-SOAK-001: access token TTL 必须覆盖完整 SOAK 加 30 分钟收尾窗口', () => {
    expect(performanceAccessTokenTtlSeconds('load', '10m')).toBe(2_400)
    expect(performanceAccessTokenTtlSeconds('soak', '2h')).toBe(9_000)
  })

  it('NEWS-R5-FAULT-001～005: 每个故障都必须失败可见、在场景阈值内恢复、连续成功且无重复事实', () => {
    const report = buildNewsFaultReport({
      runId: 'news-fault-round5-20260806',
      generatedAt: '2026-08-06T14:00:00.000Z',
      scenarios: ['DATABASE_NETWORK', 'REDIS_NETWORK', 'WORKER_RESTART', 'PROVIDER_FAILURE'].map((scenario) =>
        faultEvidence(scenario as NewsFaultScenarioEvidence['scenario']),
      ),
    })

    expect(report).toEqual(expect.objectContaining({ status: 'PASSED', scenarioCount: 4 }))
    expect(JSON.stringify(report)).not.toMatch(/Bearer|postgresql:\/\/|secret-token/)
  })

  it('NEWS-R5-FAULT-001/005: 未观察到受控失败、恢复超时或数据不变量破坏必须失败', () => {
    const evidence = faultEvidence('DATABASE_NETWORK')
    evidence.controlledFailureObserved = false
    evidence.recoveryDurationMs = 60_001
    evidence.dataInvariantPreserved = false

    const report = buildNewsFaultReport({
      runId: 'news-fault-round5-20260806',
      generatedAt: '2026-08-06T14:00:00.000Z',
      scenarios: [evidence],
    })

    expect(report.status).toBe('FAILED')
  })

  it('NEWS-R5-FAULT-003: 运行中断后仅过期 RUNNING 可重领，活跃 Run 必须等待', () => {
    const now = new Date('2026-08-06T14:02:00.000Z')
    expect(
      decideNewsRunClaim({
        status: NewsIngestionRunStatus.RUNNING,
        startedAt: new Date('2026-08-06T14:00:00.000Z'),
        now,
        staleAfterMs: 90_000,
      }),
    ).toBe('CLAIM')
    expect(
      decideNewsRunClaim({
        status: NewsIngestionRunStatus.RUNNING,
        startedAt: new Date('2026-08-06T14:01:30.000Z'),
        now,
        staleAfterMs: 90_000,
      }),
    ).toBe('WAIT')
    expect(
      decideNewsRunClaim({
        status: NewsIngestionRunStatus.SUCCEEDED,
        startedAt: new Date('2026-08-06T14:00:00.000Z'),
        now,
        staleAfterMs: 90_000,
      }),
    ).toBe('TERMINAL')
  })

  it('NEWS-R5-FAULT-003: 活跃 RUNNING 重试必须跨过剩余租约，不能提前耗尽队列次数', () => {
    const startedAt = new Date('2026-08-06T14:00:00.000Z')
    const now = new Date('2026-08-06T14:00:30.000Z')

    const retryAfterMs = newsRunClaimRetryAfterMs({ startedAt, now, staleAfterMs: 90_000 })

    expect(retryAfterMs).toBe(61_000)
    expect(
      decideNewsRunClaim({
        status: NewsIngestionRunStatus.RUNNING,
        startedAt,
        now: new Date(now.getTime() + retryAfterMs),
        staleAfterMs: 90_000,
      }),
    ).toBe('CLAIM')
  })

  it('NEWS-R5-SOAK/FAULT: 编排必须使用独立 Redis/schema/proxy 且正式 SOAK 不允许时长覆盖', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')
    const runner = readFileSync(join(process.cwd(), 'scripts/run-news-performance.ts'), 'utf8')

    expect(compose).toContain('news-performance-redis:')
    expect(compose).toContain('news-fault-proxy:')
    expect(compose).toContain('news-fault-redis:')
    expect(compose).toContain('NEWS_FAULT_DATABASE_SCHEMA')
    expect(compose).toContain('test/fault/news/fault-runtime.ts api')
    expect(compose).toContain('test/fault/news/fault-runtime.ts worker')
    expect(runner).toContain('collect-news-soak-telemetry')
    expect(runner).toContain("profile.profile !== 'load' && profile.profile !== 'soak'")
  })
})

function soakInput(): NewsSoakReportInput {
  return {
    runId: 'news-perf-round5-soak-20260806',
    generatedAt: '2026-08-06T14:00:00.000Z',
    profile: 'soak',
    datasetBefore: { articles: 500_000, securityLinks: 1_000_000, stocks: 1_000 },
    datasetAfter: { articles: 500_000, securityLinks: 1_000_000, stocks: 1_000 },
    load: { warmupRequests: 200, virtualUsers: 20, duration: '2h', listWeight: 80, detailWeight: 20 },
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
      state: { testRunDurationMs: 7_200_000 },
      metrics: {
        'http_req_failed{phase:measure}': { values: { rate: 0 } },
        'http_reqs{phase:measure}': { values: { count: 1_000_000, rate: 138.88 } },
        'http_req_duration{phase:measure}': {
          values: { 'p(50)': 90, 'p(95)': 200, 'p(99)': 400, max: 700 },
        },
        'http_req_duration{phase:measure,endpoint:list}': {
          values: { 'p(50)': 100, 'p(95)': 220, 'p(99)': 500, max: 750 },
        },
        'http_req_duration{phase:measure,endpoint:detail}': {
          values: { 'p(50)': 70, 'p(95)': 120, 'p(99)': 180, max: 300 },
        },
      },
    },
    telemetry: telemetrySamples(),
    telemetryCollectionErrorCount: 0,
    externalProviderRequestCount: 0,
    externalProviderLogScanCompleted: true,
  }
}

function telemetrySamples(
  overrides: { finalMemoryBytes?: number; finalRestartCount?: number } = {},
): NewsSoakTelemetrySample[] {
  return Array.from({ length: 121 }, (_, index) => ({
    sampledAt: new Date(Date.parse('2026-08-06T14:00:00.000Z') + index * 60_000).toISOString(),
    appMemoryBytes:
      1_000_000_000 + Math.round(((overrides.finalMemoryBytes ?? 1_050_000_000) - 1_000_000_000) * (index / 120)),
    appCpuPercent: 45,
    appRestartCount: index === 120 ? (overrides.finalRestartCount ?? 0) : 0,
    databaseConnections: 12 + (index % 2),
    redisConnectedClients: 3 + (index % 2),
  }))
}

function faultEvidence(scenario: NewsFaultScenarioEvidence['scenario']): NewsFaultScenarioEvidence {
  return {
    scenario,
    injectedAt: '2026-08-06T14:00:00.000Z',
    recoveredAt: '2026-08-06T14:00:30.000Z',
    recoveryDurationMs: 30_000,
    controlledFailureObserved: true,
    consecutiveSuccessesAfterRecovery: 3,
    dataInvariantPreserved: true,
    duplicateFacts: 0,
  }
}
