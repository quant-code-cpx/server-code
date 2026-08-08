import { buildNewsConfig, type NewsConfigEnvironment } from 'src/config/news.config'
import { shanghaiCompactDate } from '../domain/news-time'
import { AKSHARE_FEEDS } from '../providers/akshare-news.provider'
import { GDELT_TOPICS, parseGdeltSeenDate } from '../providers/gdelt-news.provider'

const CANARY_PROVIDER_KEYS = ['AKSHARE', 'GDELT'] as const
type NewsCanaryProviderKey = (typeof CANARY_PROVIDER_KEYS)[number]

export interface NewsCanaryEnvironment extends NewsConfigEnvironment {
  NEWS_CANARY_ENABLED?: string
  NEWS_CANARY_PROVIDERS?: string
  NEWS_CANARY_SECURITY?: string
  [key: string]: string | undefined
}

export interface NewsCanaryProbe {
  providerKey: NewsCanaryProviderKey
  providerVersion: string
  feedKey: string
  method: 'GET' | 'POST'
  url: string
  body?: Readonly<Record<string, unknown>>
  timeoutMs: number
}

export interface NewsCanaryPlan {
  enabled: boolean
  probes: readonly NewsCanaryProbe[]
  gdeltMinIntervalMs: number
}

export interface NewsCanaryEvidence extends Record<string, unknown> {
  providerKey: NewsCanaryProviderKey
  providerVersion: string
  feedKey: string
  observedAt: string
  elapsedMs: number
  status: number
  ok: boolean
  itemCount: number
  requestId: string | null
  fieldManifest: string[]
  nullCountByField: Record<string, number>
  potentiallyTruncated: boolean
  errorCode: string | null
}

export interface NewsCanaryReport {
  schemaVersion: 1
  status: 'DISABLED' | 'PASSED' | 'FAILED'
  startedAt: string
  finishedAt: string
  evidence: NewsCanaryEvidence[]
}

export interface NewsCanaryHttpResponse {
  status: number
  json(): Promise<unknown>
}

export type NewsCanaryFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST'
    headers?: Readonly<Record<string, string>>
    body?: string
    signal: AbortSignal
  },
) => Promise<NewsCanaryHttpResponse>

export interface RunNewsCanaryOptions {
  env: NewsCanaryEnvironment
  fetcher: NewsCanaryFetch
  sleep: (milliseconds: number) => Promise<void>
  now: () => Date
}

export function buildNewsCanaryPlan(env: NewsCanaryEnvironment, at = new Date()): NewsCanaryPlan {
  const enabled = parseBoolean(env.NEWS_CANARY_ENABLED, false, 'NEWS_CANARY_ENABLED')
  if (!enabled) return { enabled: false, probes: [], gdeltMinIntervalMs: 60_000 }

  const providerKeys = parseProviderKeys(env.NEWS_CANARY_PROVIDERS)
  const includeAkshare = providerKeys.includes('AKSHARE')
  const includeGdelt = providerKeys.includes('GDELT')
  const config = buildNewsConfig({
    ...env,
    NEWS_ENABLED: 'false',
    NEWS_AKSHARE_BRIDGE_ENABLED: includeAkshare ? 'true' : 'false',
    NEWS_GDELT_ENABLED: includeGdelt ? 'true' : 'false',
  })
  const probes: NewsCanaryProbe[] = []

  if (includeAkshare) {
    const date = shanghaiCompactDate(at)
    const backfillBeginDate = shanghaiCompactDate(new Date(at.getTime() - 30 * 86_400_000))
    const security = parseSecurity(env.NEWS_CANARY_SECURITY)
    const base = config.bridge.baseUrl
    const common = {
      providerKey: 'AKSHARE' as const,
      providerVersion: 'AKShare 1.18.81',
      method: 'POST' as const,
      timeoutMs: config.bridge.timeoutMs,
    }
    probes.push(
      {
        ...common,
        feedKey: AKSHARE_FEEDS.EASTMONEY,
        url: `${base}/v1/feeds/eastmoney/latest`,
        body: {},
      },
      {
        ...common,
        feedKey: AKSHARE_FEEDS.CLS,
        url: `${base}/v1/feeds/cls/latest`,
        body: { scope: 'ALL' },
      },
      {
        ...common,
        feedKey: AKSHARE_FEEDS.NOTICE_TODAY,
        url: `${base}/v1/notices/daily`,
        body: { date },
      },
      {
        ...common,
        feedKey: AKSHARE_FEEDS.NOTICE_BACKFILL,
        url: `${base}/v1/notices/security/range`,
        body: { security, beginDate: backfillBeginDate, endDate: date },
      },
    )
  }

  if (includeGdelt) {
    for (const [feedKey, query] of Object.entries(GDELT_TOPICS)) {
      const url = new URL(config.gdelt.baseUrl)
      url.searchParams.set('query', query)
      url.searchParams.set('mode', 'artlist')
      url.searchParams.set('format', 'json')
      url.searchParams.set('sort', 'datedesc')
      url.searchParams.set('timespan', '45min')
      url.searchParams.set('maxrecords', '250')
      probes.push({
        providerKey: 'GDELT',
        providerVersion: 'GDELT DOC 2.0',
        feedKey,
        method: 'GET',
        url: url.toString(),
        timeoutMs: config.gdelt.timeoutMs,
      })
    }
  }

  return { enabled: true, probes, gdeltMinIntervalMs: config.gdelt.minIntervalMs }
}

export async function runNewsProviderCanary(options: RunNewsCanaryOptions): Promise<NewsCanaryReport> {
  const startedAt = options.now()
  const plan = buildNewsCanaryPlan(options.env, startedAt)
  if (!plan.enabled) {
    const finishedAt = options.now()
    return {
      schemaVersion: 1,
      status: 'DISABLED',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      evidence: [],
    }
  }

  const evidence: NewsCanaryEvidence[] = []
  let gdeltProbeCount = 0
  for (const probe of plan.probes) {
    if (probe.providerKey === 'GDELT') {
      if (gdeltProbeCount > 0) await options.sleep(plan.gdeltMinIntervalMs)
      gdeltProbeCount += 1
    }
    const probeEvidence = await executeProbe(probe, options)
    evidence.push(probeEvidence)
    if (
      probe.providerKey === 'GDELT' &&
      ['UPSTREAM_RATE_LIMITED', 'UPSTREAM_TIMEOUT'].includes(probeEvidence.errorCode ?? '')
    ) {
      break
    }
  }
  const finishedAt = options.now()
  return {
    schemaVersion: 1,
    status: evidence.every((item) => item.ok) ? 'PASSED' : 'FAILED',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    evidence,
  }
}

async function executeProbe(probe: NewsCanaryProbe, options: RunNewsCanaryOptions): Promise<NewsCanaryEvidence> {
  const before = options.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), probe.timeoutMs)
  try {
    const response = await options.fetcher(probe.url, {
      method: probe.method,
      headers:
        probe.providerKey === 'AKSHARE'
          ? {
              authorization: `Bearer ${options.env.NEWS_AKSHARE_BRIDGE_TOKEN ?? ''}`,
              'content-type': 'application/json',
            }
          : undefined,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
      signal: controller.signal,
    })
    if (response.status === 429) {
      return failedEvidence(probe, options.now(), before, response.status, 'UPSTREAM_RATE_LIMITED')
    }
    if (response.status < 200 || response.status >= 300) {
      return failedEvidence(probe, options.now(), before, response.status, 'UPSTREAM_UNAVAILABLE')
    }
    const payload = await response.json()
    const summary = probe.providerKey === 'AKSHARE' ? summarizeBridge(payload) : summarizeGdelt(payload)
    const observedAt = options.now()
    return {
      providerKey: probe.providerKey,
      providerVersion: probe.providerVersion,
      feedKey: probe.feedKey,
      observedAt: observedAt.toISOString(),
      elapsedMs: elapsedMilliseconds(before, observedAt),
      status: response.status,
      ok: true,
      itemCount: summary.itemCount,
      requestId: summary.requestId,
      fieldManifest: summary.fieldManifest,
      nullCountByField: summary.nullCountByField,
      potentiallyTruncated: summary.potentiallyTruncated,
      errorCode: null,
    }
  } catch (error) {
    const errorCode = controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : toCanaryErrorCode(error)
    return failedEvidence(probe, options.now(), before, 0, errorCode)
  } finally {
    clearTimeout(timeout)
  }
}

interface CanarySummary {
  itemCount: number
  requestId: string | null
  fieldManifest: string[]
  nullCountByField: Record<string, number>
  potentiallyTruncated: boolean
}

function summarizeBridge(payload: unknown): CanarySummary {
  const envelope = asRecord(payload)
  if (
    envelope.schemaVersion !== 1 ||
    !Array.isArray(envelope.items) ||
    typeof envelope.requestId !== 'string' ||
    !isTimestamp(envelope.retrievedAt)
  ) {
    throw new CanarySchemaError()
  }
  const items = envelope.items.map((item) => {
    const record = asRecord(item)
    if (
      typeof record.title !== 'string' ||
      !['NOTICE', 'NEWS', 'FLASH'].includes(String(record.contentType)) ||
      !['SECOND', 'MINUTE', 'DATE', 'UNKNOWN'].includes(String(record.publishedPrecision))
    ) {
      throw new CanarySchemaError()
    }
    if (record.publishedAt != null && !isTimestamp(record.publishedAt)) throw new CanarySchemaError()
    if (record.publishedDate != null && !isCalendarDate(record.publishedDate)) throw new CanarySchemaError()
    return record
  })
  return {
    itemCount: items.length,
    requestId: envelope.requestId,
    ...summarizeFields(items),
    potentiallyTruncated:
      Array.isArray(envelope.warnings) &&
      envelope.warnings.some((warning) => asRecord(warning).code === 'POTENTIALLY_TRUNCATED'),
  }
}

function summarizeGdelt(payload: unknown): CanarySummary {
  const response = asRecord(payload)
  if (!Array.isArray(response.articles)) throw new CanarySchemaError()
  const articles = response.articles.map((article) => {
    const record = asRecord(article)
    if (
      typeof record.url !== 'string' ||
      record.url.length === 0 ||
      typeof record.title !== 'string' ||
      record.title.length === 0 ||
      typeof record.seendate !== 'string'
    ) {
      throw new CanarySchemaError()
    }
    try {
      parseGdeltSeenDate(record.seendate)
    } catch {
      throw new CanarySchemaError()
    }
    return record
  })
  return {
    itemCount: articles.length,
    requestId: null,
    ...summarizeFields(articles),
    potentiallyTruncated: articles.length >= 250,
  }
}

function summarizeFields(items: Array<Record<string, unknown>>): {
  fieldManifest: string[]
  nullCountByField: Record<string, number>
} {
  const fieldManifest = [...new Set(items.flatMap((item) => Object.keys(item)))].sort()
  const nullCountByField = Object.fromEntries(
    fieldManifest.map((field) => [field, items.reduce((count, item) => count + (item[field] == null ? 1 : 0), 0)]),
  )
  return { fieldManifest, nullCountByField }
}

function failedEvidence(
  probe: NewsCanaryProbe,
  observedAt: Date,
  before: Date,
  status: number,
  errorCode: string,
): NewsCanaryEvidence {
  return {
    providerKey: probe.providerKey,
    providerVersion: probe.providerVersion,
    feedKey: probe.feedKey,
    observedAt: observedAt.toISOString(),
    elapsedMs: elapsedMilliseconds(before, observedAt),
    status,
    ok: false,
    itemCount: 0,
    requestId: null,
    fieldManifest: [],
    nullCountByField: {},
    potentiallyTruncated: false,
    errorCode,
  }
}

function parseProviderKeys(raw: string | undefined): NewsCanaryProviderKey[] {
  const values = (raw?.trim() || CANARY_PROVIDER_KEYS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (values.length === 0 || values.some((value) => !CANARY_PROVIDER_KEYS.includes(value as NewsCanaryProviderKey))) {
    throw new Error('NEWS_CANARY_PROVIDERS 只允许 AKSHARE/GDELT')
  }
  return [...new Set(values)] as NewsCanaryProviderKey[]
}

function parseSecurity(raw: string | undefined): string {
  const security = raw?.trim() || '000001'
  if (!/^\d{6}$/.test(security)) throw new Error('NEWS_CANARY_SECURITY 必须是 6 位证券代码')
  return security
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw == null || raw.trim() === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} 只能是 true/false`)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanarySchemaError()
  return value as Record<string, unknown>
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  )
}

function elapsedMilliseconds(before: Date, after: Date): number {
  return Math.max(0, after.getTime() - before.getTime())
}

function toCanaryErrorCode(error: unknown): string {
  return error instanceof CanarySchemaError ? 'UPSTREAM_SCHEMA_CHANGED' : 'UPSTREAM_UNAVAILABLE'
}

class CanarySchemaError extends Error {}
