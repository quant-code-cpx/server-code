import { isIP } from 'node:net'

const PROFILE_DEFAULTS = {
  smoke: { virtualUsers: 1, duration: '10s', errorRate: 0.01, p95Ms: 1_000 },
  load: { virtualUsers: 20, duration: '10m', errorRate: 0.005, p95Ms: 500 },
  stress: { virtualUsers: 40, duration: '5m', errorRate: 0.05, p95Ms: 800 },
  soak: { virtualUsers: 20, duration: '2h', errorRate: 0.005, p95Ms: 500 },
} as const

export type NewsPerformanceProfileName = keyof typeof PROFILE_DEFAULTS

export interface NewsPerformanceEnvironment {
  NEWS_PERF_ENABLED?: string
  NEWS_PERF_PROFILE?: string
  NEWS_PERF_BASE_URL?: string
  NEWS_PERF_DATASET_ID?: string
  NEWS_PERF_DATABASE_SCHEMA?: string
  NEWS_PERF_DURATION?: string
  NEWS_PERF_VUS?: string
  [key: string]: string | undefined
}

export interface NewsPerformanceProfile {
  enabled: boolean
  profile?: NewsPerformanceProfileName
  baseUrl?: string
  datasetId?: string
  databaseSchema?: string
  virtualUsers?: number
  duration?: string
  listWeight?: 80
  detailWeight?: 20
  thresholds?: { errorRate: number; p95Ms: number }
  maximumSteadyStateMemoryGrowthRatio?: number
}

export function performanceAccessTokenTtlSeconds(profile: NewsPerformanceProfileName, duration: string): number {
  if (!(profile in PROFILE_DEFAULTS)) throw new Error('NEWS_PERF_PROFILE 只允许 smoke/load/stress/soak')
  const match = duration.match(/^(\d+)(s|m|h)$/)
  if (!match) throw new Error('NEWS_PERF_DURATION 必须是正整数加 s/m/h')
  const amount = Number(match[1])
  const multiplier = match[2] === 'h' ? 3_600 : match[2] === 'm' ? 60 : 1
  const durationSeconds = amount * multiplier
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86_400) {
    throw new Error('NEWS_PERF_DURATION 必须在 1 秒到 24 小时之间')
  }
  return durationSeconds + 1_800
}

export function buildNewsPerformanceProfile(env: NewsPerformanceEnvironment): NewsPerformanceProfile {
  const enabled = parseBoolean(env.NEWS_PERF_ENABLED, false)
  if (!enabled) return { enabled: false }

  const profile = parseProfile(env.NEWS_PERF_PROFILE)
  const defaults = PROFILE_DEFAULTS[profile]
  const baseUrl = validateBaseUrl(env.NEWS_PERF_BASE_URL)
  const datasetId = env.NEWS_PERF_DATASET_ID?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,47}$/.test(datasetId)) {
    throw new Error('NEWS_PERF_DATASET_ID 必须使用 news-perf- 前缀')
  }
  const databaseSchema = env.NEWS_PERF_DATABASE_SCHEMA?.trim() ?? ''
  if (!/^news_perf_[a-z0-9_]{1,48}$/.test(databaseSchema)) {
    throw new Error('NEWS_PERF_DATABASE_SCHEMA 必须是隔离的 news_perf_* schema')
  }

  return {
    enabled: true,
    profile,
    baseUrl,
    datasetId,
    databaseSchema,
    virtualUsers: parsePositiveInteger(env.NEWS_PERF_VUS, defaults.virtualUsers, 'NEWS_PERF_VUS'),
    duration: parseDuration(env.NEWS_PERF_DURATION, defaults.duration),
    listWeight: 80,
    detailWeight: 20,
    thresholds: { errorRate: defaults.errorRate, p95Ms: defaults.p95Ms },
    ...(profile === 'soak' ? { maximumSteadyStateMemoryGrowthRatio: 0.15 } : {}),
  }
}

function parseProfile(raw: string | undefined): NewsPerformanceProfileName {
  const value = raw?.trim() || 'smoke'
  if (!(value in PROFILE_DEFAULTS)) throw new Error('NEWS_PERF_PROFILE 只允许 smoke/load/stress/soak')
  return value as NewsPerformanceProfileName
}

function validateBaseUrl(raw: string | undefined): string {
  let url: URL
  try {
    url = new URL(raw?.trim() || 'http://localhost:3000')
  } catch {
    throw new Error('NEWS_PERF_BASE_URL 不是合法 URL')
  }
  const hostname = url.hostname.toLowerCase()
  const ipKind = isIP(hostname)
  const isLoopbackIp = hostname === '127.0.0.1' || hostname === '::1'
  const isTrustedDns =
    hostname === 'localhost' ||
    (!hostname.includes('.') && ipKind === 0) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.svc') ||
    hostname.includes('.svc.')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (ipKind !== 0 && !isLoopbackIp) ||
    (!isTrustedDns && !isLoopbackIp)
  ) {
    throw new Error('NEWS_PERF_BASE_URL 必须指向本机或受信内网服务')
  }
  return url.origin
}

function parseDuration(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback
  if (!/^\d+(?:s|m|h)$/.test(value) || Number.parseInt(value, 10) <= 0) {
    throw new Error('NEWS_PERF_DURATION 必须是正整数加 s/m/h')
  }
  return value
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error(`${name} 必须是 1-200 的整数`)
  return value
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('NEWS_PERF_ENABLED 只能是 true/false')
}
