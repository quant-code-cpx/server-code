import { ConfigType, registerAs } from '@nestjs/config'

export const WEB_SEARCH_CONFIG_TOKEN = 'webSearch'

export type WebSearchProviderName = 'disabled' | 'fake' | 'brave'

export interface WebSearchConfigEnvironment {
  AGENT_SEARCH_PROVIDER?: string
  AGENT_SEARCH_API_KEY?: string
  AGENT_SEARCH_BASE_URL?: string
  AGENT_SEARCH_TIMEOUT_MS?: string
  AGENT_FETCH_MAX_BYTES?: string
  AGENT_FETCH_MAX_REDIRECTS?: string
  AGENT_URL_TOKEN_SECRET?: string
  AGENT_URL_TOKEN_TTL_SECONDS?: string
}

const SUPPORTED_PROVIDERS = new Set<WebSearchProviderName>(['disabled', 'fake', 'brave'])
const DEFAULT_BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export function buildWebSearchConfig(env: WebSearchConfigEnvironment, nodeEnv = 'development') {
  const provider = (env.AGENT_SEARCH_PROVIDER?.trim().toLowerCase() || 'disabled') as WebSearchProviderName
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`[WebSearch] AGENT_SEARCH_PROVIDER 不支持：${provider}`)
  }
  if (nodeEnv === 'production' && provider === 'fake') {
    throw new Error('[WebSearch] 生产环境禁止 fake search provider')
  }

  const apiKey = optionalValue(env.AGENT_SEARCH_API_KEY)
  const urlTokenSecret = optionalValue(env.AGENT_URL_TOKEN_SECRET)
  if (provider === 'brave' && !apiKey) throw new Error('[WebSearch] Brave provider 必须配置 AGENT_SEARCH_API_KEY')
  if (provider !== 'disabled' && (!urlTokenSecret || urlTokenSecret.length < 32)) {
    throw new Error('[WebSearch] 启用搜索时 AGENT_URL_TOKEN_SECRET 长度必须至少 32 字符')
  }
  if (urlTokenSecret && urlTokenSecret.length < 32) {
    throw new Error('[WebSearch] AGENT_URL_TOKEN_SECRET 长度必须至少 32 字符')
  }

  return {
    provider,
    apiKey,
    baseUrl: provider === 'brave' ? parseBraveEndpoint(env.AGENT_SEARCH_BASE_URL) : null,
    timeoutMs: parseInteger(env.AGENT_SEARCH_TIMEOUT_MS, 'AGENT_SEARCH_TIMEOUT_MS', 10_000, 500, 60_000),
    fetchMaxBytes: parseInteger(env.AGENT_FETCH_MAX_BYTES, 'AGENT_FETCH_MAX_BYTES', 1_000_000, 16_384, 5_000_000),
    fetchMaxRedirects: parseInteger(env.AGENT_FETCH_MAX_REDIRECTS, 'AGENT_FETCH_MAX_REDIRECTS', 3, 0, 5),
    urlTokenSecret,
    urlTokenTtlSeconds: parseInteger(env.AGENT_URL_TOKEN_TTL_SECONDS, 'AGENT_URL_TOKEN_TTL_SECONDS', 900, 30, 3_600),
  }
}

export const WebSearchConfig = registerAs(WEB_SEARCH_CONFIG_TOKEN, () =>
  buildWebSearchConfig(process.env, process.env.NODE_ENV),
)

export type IWebSearchConfig = ConfigType<typeof WebSearchConfig>

function parseBraveEndpoint(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_BRAVE_ENDPOINT
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('[WebSearch] AGENT_SEARCH_BASE_URL 必须是有效 URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.search.brave.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/res/v1/web/search'
  ) {
    throw new Error('[WebSearch] Brave endpoint 必须是官方 HTTPS 默认端口 web search 地址')
  }
  return url.toString()
}

function optionalValue(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[WebSearch] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
