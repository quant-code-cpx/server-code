export type AgentPerformanceMode = 'baseline' | 'gate'

export interface AgentPerformanceThresholds {
  maxP95Ms?: number
  maxP99Ms?: number
  minThroughputPerSecond?: number
}

export interface AgentPerformanceConfig {
  mode: AgentPerformanceMode
  maxErrorRate: number
  thresholds: {
    rest: AgentPerformanceThresholds
    run: AgentPerformanceThresholds
    replay: AgentPerformanceThresholds
  }
}

export interface AgentPerformanceMetrics {
  attempts: number
  errors: number
  errorRate: number
  averageMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  throughputPerSecond: number
}

export function calculateAgentPerformanceMetrics(input: {
  latenciesMs: readonly number[]
  errors: number
  wallTimeMs: number
  throughputCount?: number
}): AgentPerformanceMetrics {
  if (input.latenciesMs.length === 0) throw new Error('性能样本不能为空')
  if (input.latenciesMs.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('性能样本必须为非负有限数')
  }
  if (!Number.isInteger(input.errors) || input.errors < 0 || input.errors > input.latenciesMs.length) {
    throw new Error('性能错误数非法')
  }
  if (!Number.isFinite(input.wallTimeMs) || input.wallTimeMs <= 0) throw new Error('性能 wallTimeMs 必须大于 0')
  const throughputCount = input.throughputCount ?? input.latenciesMs.length - input.errors
  if (!Number.isFinite(throughputCount) || throughputCount < 0) throw new Error('性能 throughputCount 非法')

  const sorted = [...input.latenciesMs].sort((left, right) => left - right)
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  return {
    attempts: sorted.length,
    errors: input.errors,
    errorRate: round(input.errors / sorted.length),
    averageMs: round(average),
    p50Ms: round(nearestRank(sorted, 0.5)),
    p95Ms: round(nearestRank(sorted, 0.95)),
    p99Ms: round(nearestRank(sorted, 0.99)),
    maxMs: round(sorted.at(-1)!),
    throughputPerSecond: round(throughputCount / (input.wallTimeMs / 1_000)),
  }
}

export function parseAgentPerformanceConfig(env: Record<string, string | undefined>): AgentPerformanceConfig {
  const mode = env.AGENT_PERF_MODE?.trim() || 'baseline'
  if (mode !== 'baseline' && mode !== 'gate') throw new Error('AGENT_PERF_MODE 必须为 baseline 或 gate')
  const thresholds = {
    rest: readThresholds(env, 'REST', 'RPS'),
    run: readThresholds(env, 'RUN', 'RPS'),
    replay: readThresholds(env, 'REPLAY', 'EPS'),
  }
  if (mode === 'gate' && !Object.values(thresholds).some(hasThreshold)) {
    throw new Error('AGENT_PERF_MODE=gate 时至少配置一个产品阈值')
  }
  return {
    mode,
    maxErrorRate: readRatio(env.AGENT_PERF_MAX_ERROR_RATE, 'AGENT_PERF_MAX_ERROR_RATE', 0),
    thresholds,
  }
}

export function assertAgentPerformanceGate(
  label: string,
  metrics: AgentPerformanceMetrics,
  config: {
    mode: AgentPerformanceMode
    maxErrorRate: number
    thresholds: AgentPerformanceThresholds
  },
): void {
  if (metrics.errorRate > config.maxErrorRate) {
    throw new Error(`${label} 错误率 ${formatPercent(metrics.errorRate)} > ${formatPercent(config.maxErrorRate)}`)
  }
  if (config.mode === 'baseline') return
  const failures: string[] = []
  if (config.thresholds.maxP95Ms != null && metrics.p95Ms > config.thresholds.maxP95Ms) {
    failures.push(`p95 ${metrics.p95Ms}ms > ${config.thresholds.maxP95Ms}ms`)
  }
  if (config.thresholds.maxP99Ms != null && metrics.p99Ms > config.thresholds.maxP99Ms) {
    failures.push(`p99 ${metrics.p99Ms}ms > ${config.thresholds.maxP99Ms}ms`)
  }
  if (
    config.thresholds.minThroughputPerSecond != null &&
    metrics.throughputPerSecond < config.thresholds.minThroughputPerSecond
  ) {
    failures.push(`吞吐 ${metrics.throughputPerSecond}/s < ${config.thresholds.minThroughputPerSecond}/s`)
  }
  if (failures.length > 0) throw new Error(`${label} 性能门禁失败：${failures.join('；')}`)
}

function readThresholds(
  env: Record<string, string | undefined>,
  category: 'REST' | 'RUN' | 'REPLAY',
  throughputUnit: 'RPS' | 'EPS',
): AgentPerformanceThresholds {
  const p95Name = `AGENT_PERF_${category}_MAX_P95_MS`
  const p99Name = `AGENT_PERF_${category}_MAX_P99_MS`
  const throughputName = `AGENT_PERF_${category}_MIN_${throughputUnit}`
  return compact({
    maxP95Ms: readPositive(env[p95Name], p95Name),
    maxP99Ms: readPositive(env[p99Name], p99Name),
    minThroughputPerSecond: readPositive(env[throughputName], throughputName),
  })
}

function readPositive(raw: string | undefined, name: string): number | undefined {
  if (raw == null || !raw.trim()) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为正数`)
  return value
}

function readRatio(raw: string | undefined, name: string, fallback: number): number {
  if (raw == null || !raw.trim()) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} 必须为 0-1 数值`)
  return value
}

function compact(value: AgentPerformanceThresholds): AgentPerformanceThresholds {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function hasThreshold(value: AgentPerformanceThresholds): boolean {
  return Object.keys(value).length > 0
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function formatPercent(value: number): string {
  return `${round(value * 100)}%`
}
