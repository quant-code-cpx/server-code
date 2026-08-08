import { ConfigType, registerAs } from '@nestjs/config'
import { isIP } from 'node:net'

export const NEWS_CONFIG_TOKEN = 'news'

export interface NewsConfigEnvironment {
  NODE_ENV?: string
  NEWS_ENABLED?: string
  NEWS_AKSHARE_BRIDGE_ENABLED?: string
  NEWS_AKSHARE_BRIDGE_BASE_URL?: string
  NEWS_AKSHARE_BRIDGE_ALLOWED_HOST?: string
  NEWS_AKSHARE_BRIDGE_TOKEN?: string
  NEWS_AKSHARE_BRIDGE_TIMEOUT_MS?: string
  NEWS_GDELT_ENABLED?: string
  NEWS_GDELT_BASE_URL?: string
  NEWS_GDELT_TIMEOUT_MS?: string
  NEWS_GDELT_MIN_INTERVAL_MS?: string
  NEWS_QUEUE_CONCURRENCY?: string
  NEWS_EXCERPT_MAX_CHARS?: string
  NEWS_CURSOR_SECRET?: string
  NEWS_CURSOR_TTL_SECONDS?: string
  NEWS_FRESHNESS_GRACE_MULTIPLIER?: string
  NEWS_DETAIL_REVISION_LIMIT?: string
  NEWS_METADATA_RETENTION_DAYS?: string
  NEWS_INGESTION_RUN_RETENTION_DAYS?: string
  NEWS_QUARANTINE_RETENTION_DAYS?: string
}

export function buildNewsConfig(env: NewsConfigEnvironment) {
  const enabled = parseBoolean(env.NEWS_ENABLED, false)
  const bridgeEnabled = parseBoolean(env.NEWS_AKSHARE_BRIDGE_ENABLED, false)
  const gdeltEnabled = parseBoolean(env.NEWS_GDELT_ENABLED, false)
  const cursorSecret = env.NEWS_CURSOR_SECRET?.trim() ?? ''
  if (enabled && Buffer.byteLength(cursorSecret, 'utf8') < 32) {
    throw new Error('[News] NEWS_ENABLED=true 时 NEWS_CURSOR_SECRET 至少 32 字节')
  }

  const bridgeBaseUrl = env.NEWS_AKSHARE_BRIDGE_BASE_URL?.trim() || 'http://news-source-bridge:8080'
  const bridgeAllowedHost = env.NEWS_AKSHARE_BRIDGE_ALLOWED_HOST?.trim() || 'news-source-bridge'
  if (bridgeEnabled) assertBridgeUrl(bridgeBaseUrl, bridgeAllowedHost)

  const gdeltBaseUrl = env.NEWS_GDELT_BASE_URL?.trim() || 'https://api.gdeltproject.org/api/v2/doc/doc'
  if (gdeltEnabled && gdeltBaseUrl !== 'https://api.gdeltproject.org/api/v2/doc/doc') {
    throw new Error('[News] NEWS_GDELT_BASE_URL 必须是官方 DOC 2.0 HTTPS 地址')
  }

  const bridgeToken = env.NEWS_AKSHARE_BRIDGE_TOKEN?.trim() ?? ''
  if (bridgeEnabled && Buffer.byteLength(bridgeToken, 'utf8') < 32) {
    throw new Error('[News] Bridge 启用时 NEWS_AKSHARE_BRIDGE_TOKEN 至少 32 字节')
  }
  if (enabled && bridgeEnabled && bridgeToken === cursorSecret) {
    throw new Error('[News] NEWS_CURSOR_SECRET 不得复用 Bridge token')
  }

  return {
    enabled,
    timezone: 'Asia/Shanghai' as const,
    bridge: {
      enabled: bridgeEnabled,
      baseUrl: bridgeBaseUrl.replace(/\/$/, ''),
      token: bridgeToken,
      timeoutMs: parseInteger(
        env.NEWS_AKSHARE_BRIDGE_TIMEOUT_MS,
        'NEWS_AKSHARE_BRIDGE_TIMEOUT_MS',
        15_000,
        1_000,
        60_000,
      ),
    },
    gdelt: {
      enabled: gdeltEnabled,
      baseUrl: gdeltBaseUrl,
      timeoutMs: parseInteger(env.NEWS_GDELT_TIMEOUT_MS, 'NEWS_GDELT_TIMEOUT_MS', 60_000, 1_000, 60_000),
      minIntervalMs: parseInteger(
        env.NEWS_GDELT_MIN_INTERVAL_MS,
        'NEWS_GDELT_MIN_INTERVAL_MS',
        60_000,
        60_000,
        900_000,
      ),
    },
    queueConcurrency: parseInteger(env.NEWS_QUEUE_CONCURRENCY, 'NEWS_QUEUE_CONCURRENCY', 4, 1, 20),
    excerptMaxChars: parseInteger(env.NEWS_EXCERPT_MAX_CHARS, 'NEWS_EXCERPT_MAX_CHARS', 1_000, 100, 1_000),
    cursorSecret,
    cursorTtlSeconds: parseInteger(env.NEWS_CURSOR_TTL_SECONDS, 'NEWS_CURSOR_TTL_SECONDS', 86_400, 86_400, 86_400),
    freshnessGraceMultiplier: parseInteger(
      env.NEWS_FRESHNESS_GRACE_MULTIPLIER,
      'NEWS_FRESHNESS_GRACE_MULTIPLIER',
      3,
      1,
      10,
    ),
    detailRevisionLimit: parseInteger(env.NEWS_DETAIL_REVISION_LIMIT, 'NEWS_DETAIL_REVISION_LIMIT', 50, 1, 50),
    metadataRetentionDays: parseInteger(
      env.NEWS_METADATA_RETENTION_DAYS,
      'NEWS_METADATA_RETENTION_DAYS',
      730,
      30,
      3_650,
    ),
    ingestionRunRetentionDays: parseInteger(
      env.NEWS_INGESTION_RUN_RETENTION_DAYS,
      'NEWS_INGESTION_RUN_RETENTION_DAYS',
      90,
      30,
      365,
    ),
    quarantineRetentionDays: parseInteger(
      env.NEWS_QUARANTINE_RETENTION_DAYS,
      'NEWS_QUARANTINE_RETENTION_DAYS',
      30,
      7,
      180,
    ),
  }
}

export const NewsConfig = registerAs(NEWS_CONFIG_TOKEN, () => buildNewsConfig(process.env))
export type INewsConfig = ConfigType<typeof NewsConfig>

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`[News] 布尔配置只能是 true/false，收到 ${raw}`)
}

function parseInteger(raw: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`[News] ${name} 必须是 ${min}-${max} 的整数`)
  }
  return parsed
}

function assertBridgeUrl(baseUrl: string, allowedHost: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('[News] NEWS_AKSHARE_BRIDGE_BASE_URL 不是合法 URL')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('[News] Bridge URL 只允许无凭据、无 query/fragment 的 HTTP(S) origin')
  }
  if (parsed.hostname !== allowedHost) {
    throw new Error('[News] Bridge host 不在 NEWS_AKSHARE_BRIDGE_ALLOWED_HOST 白名单')
  }
  const normalizedHost = parsed.hostname.toLowerCase()
  const internalDnsName =
    !normalizedHost.includes('.') ||
    normalizedHost.endsWith('.internal') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.svc') ||
    normalizedHost.includes('.svc.')
  if (isIP(normalizedHost) !== 0 || normalizedHost === 'localhost' || !internalDnsName) {
    throw new Error('[News] Bridge host 必须是受信内网 DNS 名称')
  }
}
