export interface NewsPerformanceReportInput {
  runId: string
  generatedAt: string
  profile: 'load'
  dataset: { articles: number; securityLinks: number; stocks: number }
  load: {
    warmupRequests: number
    virtualUsers: number
    duration: string
    listWeight: number
    detailWeight: number
  }
  environment: {
    os: string
    cpuModel: string
    cpuCores: number
    memoryBytes: number
    nodeVersion: string
    postgresVersion: string
    redisVersion: string
  }
  k6Summary: {
    state?: { testRunDurationMs?: number }
    metrics: Record<string, { values: Record<string, number | undefined> }>
  }
}

export interface NewsPerformanceMetricDistribution {
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  maxMs: number | null
}

export interface NewsPerformanceReport {
  schemaVersion: 1
  runId: string
  generatedAt: string
  status: 'PASSED' | 'FAILED'
  profile: 'load'
  dataset: NewsPerformanceReportInput['dataset']
  load: NewsPerformanceReportInput['load'] & { actualDurationMs: number | null }
  environment: NewsPerformanceReportInput['environment']
  metrics: {
    errorRate: number | null
    requestCount: number | null
    throughputPerSecond: number | null
    overall: NewsPerformanceMetricDistribution
    list: NewsPerformanceMetricDistribution
    detail: NewsPerformanceMetricDistribution
  }
  checks: Array<{
    key: string
    passed: boolean
    actual: number | string | null
    operator: '<' | '<=' | '>=' | '=='
    threshold: number | string
  }>
}

export function buildNewsPerformanceReport(_input: NewsPerformanceReportInput): NewsPerformanceReport {
  const input = validateInput(_input)
  const metrics = {
    errorRate: metricValue(input, 'http_req_failed{phase:measure}', 'rate'),
    requestCount: metricValue(input, 'http_reqs{phase:measure}', 'count'),
    throughputPerSecond: metricValue(input, 'http_reqs{phase:measure}', 'rate'),
    overall: metricDistribution(input, 'http_req_duration{phase:measure}'),
    list: metricDistribution(input, 'http_req_duration{phase:measure,endpoint:list}'),
    detail: metricDistribution(input, 'http_req_duration{phase:measure,endpoint:detail}'),
  }
  const actualDurationMs = finiteNumber(input.k6Summary?.state?.testRunDurationMs)
  const checks: NewsPerformanceReport['checks'] = [
    minimumCheck('dataset.articles', input.dataset.articles, 500_000),
    minimumCheck('dataset.securityLinks', input.dataset.securityLinks, 1_000_000),
    minimumCheck('dataset.stocks', input.dataset.stocks, 1_000),
    minimumCheck('load.warmupRequests', input.load.warmupRequests, 200),
    equalityCheck('load.virtualUsers', input.load.virtualUsers, 20),
    equalityCheck('load.duration', input.load.duration, '10m'),
    equalityCheck('load.listWeight', input.load.listWeight, 80),
    equalityCheck('load.detailWeight', input.load.detailWeight, 20),
    nullableMinimumCheck('load.actualDurationMs', actualDurationMs, 600_000),
    nullableMinimumCheck('metrics.requestCount', metrics.requestCount, 1),
    thresholdCheck('metrics.errorRate', metrics.errorRate, '<', 0.005),
    thresholdCheck('metrics.overall.p95Ms', metrics.overall.p95Ms, '<=', 500),
    thresholdCheck('metrics.list.p95Ms', metrics.list.p95Ms, '<=', 300),
    thresholdCheck('metrics.list.p99Ms', metrics.list.p99Ms, '<=', 800),
    thresholdCheck('metrics.detail.p95Ms', metrics.detail.p95Ms, '<=', 150),
  ]

  return {
    schemaVersion: 1,
    runId: input.runId,
    generatedAt: input.generatedAt,
    status: checks.every((check) => check.passed) ? 'PASSED' : 'FAILED',
    profile: 'load',
    dataset: {
      articles: input.dataset.articles,
      securityLinks: input.dataset.securityLinks,
      stocks: input.dataset.stocks,
    },
    load: {
      warmupRequests: input.load.warmupRequests,
      virtualUsers: input.load.virtualUsers,
      duration: input.load.duration,
      listWeight: input.load.listWeight,
      detailWeight: input.load.detailWeight,
      actualDurationMs,
    },
    environment: {
      os: input.environment.os,
      cpuModel: input.environment.cpuModel,
      cpuCores: input.environment.cpuCores,
      memoryBytes: input.environment.memoryBytes,
      nodeVersion: input.environment.nodeVersion,
      postgresVersion: input.environment.postgresVersion,
      redisVersion: input.environment.redisVersion,
    },
    metrics,
    checks,
  }
}

function validateInput(input: NewsPerformanceReportInput): NewsPerformanceReportInput {
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(input.runId)) {
    throw new Error('runId 必须使用 news-perf- 前缀')
  }
  if (!Number.isFinite(new Date(input.generatedAt).getTime())) throw new Error('generatedAt 必须是合法时间')
  if (input.profile !== 'load') throw new Error('正式性能报告只允许 load profile')
  return input
}

function metricDistribution(input: NewsPerformanceReportInput, metricName: string): NewsPerformanceMetricDistribution {
  return {
    p50Ms: metricValue(input, metricName, 'p(50)'),
    p95Ms: metricValue(input, metricName, 'p(95)'),
    p99Ms: metricValue(input, metricName, 'p(99)'),
    maxMs: metricValue(input, metricName, 'max'),
  }
}

function metricValue(input: NewsPerformanceReportInput, metricName: string, valueName: string): number | null {
  return finiteNumber(input.k6Summary?.metrics?.[metricName]?.values?.[valueName])
}

function minimumCheck(key: string, actual: number, threshold: number): NewsPerformanceReport['checks'][number] {
  return { key, passed: Number.isFinite(actual) && actual >= threshold, actual, operator: '>=', threshold }
}

function nullableMinimumCheck(
  key: string,
  actual: number | null,
  threshold: number,
): NewsPerformanceReport['checks'][number] {
  return { key, passed: actual != null && actual >= threshold, actual, operator: '>=', threshold }
}

function equalityCheck(
  key: string,
  actual: number | string,
  threshold: number | string,
): NewsPerformanceReport['checks'][number] {
  return { key, passed: actual === threshold, actual, operator: '==', threshold }
}

function thresholdCheck(
  key: string,
  actual: number | null,
  operator: '<' | '<=',
  threshold: number,
): NewsPerformanceReport['checks'][number] {
  return {
    key,
    passed: actual != null && (operator === '<' ? actual < threshold : actual <= threshold),
    actual,
    operator,
    threshold,
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
