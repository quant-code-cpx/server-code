import type { NewsPerformanceReportInput } from './news-performance-gate'

export interface NewsSoakTelemetrySample {
  sampledAt: string
  appMemoryBytes: number
  appCpuPercent: number
  appRestartCount: number
  databaseConnections: number
  redisConnectedClients: number
}

export interface NewsSoakReportInput {
  runId: string
  generatedAt: string
  profile: 'soak'
  datasetBefore: NewsPerformanceReportInput['dataset']
  datasetAfter: NewsPerformanceReportInput['dataset']
  load: NewsPerformanceReportInput['load']
  environment: NewsPerformanceReportInput['environment']
  k6Summary: NewsPerformanceReportInput['k6Summary']
  telemetry: NewsSoakTelemetrySample[]
  telemetryCollectionErrorCount: number
  externalProviderLogScanCompleted: boolean
  externalProviderRequestCount: number
}

export interface NewsSoakReport {
  schemaVersion: 1
  runId: string
  generatedAt: string
  status: 'PASSED' | 'FAILED'
  profile: 'soak'
  datasetBefore: NewsPerformanceReportInput['dataset']
  datasetAfter: NewsPerformanceReportInput['dataset']
  load: NewsPerformanceReportInput['load'] & { actualDurationMs: number | null }
  environment: NewsPerformanceReportInput['environment']
  metrics: {
    errorRate: number | null
    requestCount: number | null
    throughputPerSecond: number | null
    overallP95Ms: number | null
    listP95Ms: number | null
    listP99Ms: number | null
    detailP95Ms: number | null
  }
  telemetry: {
    sampleCount: number
    maximumSampleGapMs: number | null
    steadyStateMemoryGrowthRatio: number | null
    firstMemoryMedianBytes: number | null
    lastMemoryMedianBytes: number | null
    peakMemoryBytes: number | null
    restartDelta: number | null
    databaseConnectionMedianGrowth: number | null
    redisClientMedianGrowth: number | null
    peakCpuPercent: number | null
  }
  externalProviderRequestCount: number
  externalProviderLogScanCompleted: boolean
  telemetryCollectionErrorCount: number
  checks: Array<{
    key: string
    passed: boolean
    actual: number | string | boolean | null
    operator: '<' | '<=' | '>=' | '=='
    threshold: number | string | boolean
  }>
}

export function buildNewsSoakReport(_input: NewsSoakReportInput): NewsSoakReport {
  const input = validateInput(_input)
  const actualDurationMs = finiteNumber(input.k6Summary.state?.testRunDurationMs)
  const metrics = {
    errorRate: metricValue(input, 'http_req_failed{phase:measure}', 'rate'),
    requestCount: metricValue(input, 'http_reqs{phase:measure}', 'count'),
    throughputPerSecond: metricValue(input, 'http_reqs{phase:measure}', 'rate'),
    overallP95Ms: metricValue(input, 'http_req_duration{phase:measure}', 'p(95)'),
    listP95Ms: metricValue(input, 'http_req_duration{phase:measure,endpoint:list}', 'p(95)'),
    listP99Ms: metricValue(input, 'http_req_duration{phase:measure,endpoint:list}', 'p(99)'),
    detailP95Ms: metricValue(input, 'http_req_duration{phase:measure,endpoint:detail}', 'p(95)'),
  }
  const telemetry = summarizeTelemetry(input.telemetry)
  const checks: NewsSoakReport['checks'] = [
    minimumCheck('datasetBefore.articles', input.datasetBefore.articles, 500_000),
    minimumCheck('datasetBefore.securityLinks', input.datasetBefore.securityLinks, 1_000_000),
    minimumCheck('datasetBefore.stocks', input.datasetBefore.stocks, 1_000),
    equalityCheck('dataset.articles.unchanged', input.datasetAfter.articles, input.datasetBefore.articles),
    equalityCheck(
      'dataset.securityLinks.unchanged',
      input.datasetAfter.securityLinks,
      input.datasetBefore.securityLinks,
    ),
    equalityCheck('dataset.stocks.unchanged', input.datasetAfter.stocks, input.datasetBefore.stocks),
    minimumCheck('load.warmupRequests', input.load.warmupRequests, 200),
    equalityCheck('load.virtualUsers', input.load.virtualUsers, 20),
    equalityCheck('load.duration', input.load.duration, '2h'),
    equalityCheck('load.listWeight', input.load.listWeight, 80),
    equalityCheck('load.detailWeight', input.load.detailWeight, 20),
    nullableMinimumCheck('load.actualDurationMs', actualDurationMs, 7_200_000),
    nullableMinimumCheck('metrics.requestCount', metrics.requestCount, 1),
    nullableMaximumCheck('metrics.errorRate', metrics.errorRate, 0.005, '<'),
    nullableMaximumCheck('metrics.overallP95Ms', metrics.overallP95Ms, 500),
    nullableMaximumCheck('metrics.listP95Ms', metrics.listP95Ms, 300),
    nullableMaximumCheck('metrics.listP99Ms', metrics.listP99Ms, 800),
    nullableMaximumCheck('metrics.detailP95Ms', metrics.detailP95Ms, 150),
    minimumCheck('telemetry.sampleCount', telemetry.sampleCount, 120),
    nullableMaximumCheck('telemetry.maximumSampleGapMs', telemetry.maximumSampleGapMs, 90_000),
    nullableMaximumCheck('telemetry.steadyStateMemoryGrowthRatio', telemetry.steadyStateMemoryGrowthRatio, 0.15),
    equalityCheck('telemetry.restartDelta', telemetry.restartDelta ?? -1, 0),
    nullableMaximumCheck('telemetry.databaseConnectionMedianGrowth', telemetry.databaseConnectionMedianGrowth, 2),
    nullableMaximumCheck('telemetry.redisClientMedianGrowth', telemetry.redisClientMedianGrowth, 2),
    equalityCheck('externalProviderLogScanCompleted', input.externalProviderLogScanCompleted, true),
    equalityCheck('externalProviderRequestCount', input.externalProviderRequestCount, 0),
  ]
  return {
    schemaVersion: 1,
    runId: input.runId,
    generatedAt: input.generatedAt,
    status: checks.every((check) => check.passed) ? 'PASSED' : 'FAILED',
    profile: 'soak',
    datasetBefore: { ...input.datasetBefore },
    datasetAfter: { ...input.datasetAfter },
    load: { ...input.load, actualDurationMs },
    environment: { ...input.environment },
    metrics,
    telemetry,
    externalProviderRequestCount: input.externalProviderRequestCount,
    externalProviderLogScanCompleted: input.externalProviderLogScanCompleted,
    telemetryCollectionErrorCount: input.telemetryCollectionErrorCount,
    checks,
  }
}

function validateInput(input: NewsSoakReportInput): NewsSoakReportInput {
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(input.runId)) {
    throw new Error('runId 必须使用 news-perf- 前缀')
  }
  if (!Number.isFinite(new Date(input.generatedAt).getTime())) throw new Error('generatedAt 必须是合法时间')
  if (input.profile !== 'soak') throw new Error('SOAK 报告只允许 soak profile')
  return input
}

function summarizeTelemetry(samples: NewsSoakTelemetrySample[]): NewsSoakReport['telemetry'] {
  const sorted = [...samples].sort((left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt))
  const sampleTimes = sorted.map((sample) => Date.parse(sample.sampledAt))
  if (sampleTimes.some((value) => !Number.isFinite(value))) throw new Error('telemetry sampledAt 必须是合法时间')
  const gaps = sampleTimes.slice(1).map((value, index) => value - sampleTimes[index])
  const first = sorted.slice(0, 10)
  const last = sorted.slice(-10)
  const firstMemoryMedianBytes = median(first.map((sample) => sample.appMemoryBytes))
  const lastMemoryMedianBytes = median(last.map((sample) => sample.appMemoryBytes))
  const steadyStateMemoryGrowthRatio =
    firstMemoryMedianBytes != null && firstMemoryMedianBytes > 0 && lastMemoryMedianBytes != null
      ? (lastMemoryMedianBytes - firstMemoryMedianBytes) / firstMemoryMedianBytes
      : null
  return {
    sampleCount: sorted.length,
    maximumSampleGapMs: gaps.length ? Math.max(...gaps) : null,
    steadyStateMemoryGrowthRatio,
    firstMemoryMedianBytes,
    lastMemoryMedianBytes,
    peakMemoryBytes: maximum(sorted.map((sample) => sample.appMemoryBytes)),
    restartDelta: sorted.length ? sorted.at(-1)!.appRestartCount - sorted[0].appRestartCount : null,
    databaseConnectionMedianGrowth: medianGrowth(first, last, 'databaseConnections'),
    redisClientMedianGrowth: medianGrowth(first, last, 'redisConnectedClients'),
    peakCpuPercent: maximum(sorted.map((sample) => sample.appCpuPercent)),
  }
}

function medianGrowth(
  first: NewsSoakTelemetrySample[],
  last: NewsSoakTelemetrySample[],
  key: 'databaseConnections' | 'redisConnectedClients',
): number | null {
  const start = median(first.map((sample) => sample[key]))
  const end = median(last.map((sample) => sample[key]))
  return start == null || end == null ? null : end - start
}

function median(values: number[]): number | null {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function maximum(values: number[]): number | null {
  return values.length && values.every(Number.isFinite) ? Math.max(...values) : null
}

function metricValue(input: NewsSoakReportInput, metricName: string, valueName: string): number | null {
  return finiteNumber(input.k6Summary.metrics?.[metricName]?.values?.[valueName])
}

function minimumCheck(key: string, actual: number, threshold: number): NewsSoakReport['checks'][number] {
  return { key, passed: Number.isFinite(actual) && actual >= threshold, actual, operator: '>=', threshold }
}

function nullableMinimumCheck(key: string, actual: number | null, threshold: number): NewsSoakReport['checks'][number] {
  return { key, passed: actual != null && actual >= threshold, actual, operator: '>=', threshold }
}

function nullableMaximumCheck(
  key: string,
  actual: number | null,
  threshold: number,
  operator: '<' | '<=' = '<=',
): NewsSoakReport['checks'][number] {
  return {
    key,
    passed: actual != null && (operator === '<' ? actual < threshold : actual <= threshold),
    actual,
    operator,
    threshold,
  }
}

function equalityCheck(
  key: string,
  actual: number | string | boolean,
  threshold: number | string | boolean,
): NewsSoakReport['checks'][number] {
  return { key, passed: actual === threshold, actual, operator: '==', threshold }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
