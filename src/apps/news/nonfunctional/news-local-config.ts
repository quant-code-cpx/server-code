import { randomBytes } from 'node:crypto'

export interface PrepareNewsLocalConfigOptions {
  generateSecret?: () => string
}

export interface NewsLocalConfigEvidence {
  changedKeys: string[]
  newsEnabled: boolean
  akshareBridgeEnabled: boolean
  gdeltEnabled: boolean
  cursorSecretBytes: number
  bridgeTokenBytes: number
  gdeltMinIntervalMs: number
  gdeltTimeoutMs: number
}

export interface PreparedNewsLocalConfig {
  content: string
  evidence: NewsLocalConfigEvidence
}

export function prepareNewsLocalConfig(
  content: string,
  options: PrepareNewsLocalConfigOptions = {},
): PreparedNewsLocalConfig {
  const generateSecret = options.generateSecret ?? (() => randomBytes(32).toString('hex'))
  const current = readTargetValues(content)
  const cursorSecret = validSecret(current.NEWS_CURSOR_SECRET)
    ? current.NEWS_CURSOR_SECRET
    : generateValidSecret(generateSecret)
  let bridgeToken = validSecret(current.NEWS_AKSHARE_BRIDGE_TOKEN)
    ? current.NEWS_AKSHARE_BRIDGE_TOKEN
    : generateValidSecret(generateSecret, cursorSecret)
  if (bridgeToken === cursorSecret) bridgeToken = generateValidSecret(generateSecret, cursorSecret)

  const desired: Record<NewsLocalConfigKey, string> = {
    NEWS_ENABLED: 'true',
    NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
    NEWS_AKSHARE_BRIDGE_BASE_URL: 'http://news-source-bridge:8080',
    NEWS_AKSHARE_BRIDGE_ALLOWED_HOST: 'news-source-bridge',
    NEWS_AKSHARE_BRIDGE_TOKEN: bridgeToken,
    NEWS_AKSHARE_BRIDGE_TIMEOUT_MS: '60000',
    NEWS_GDELT_ENABLED: 'false',
    NEWS_GDELT_BASE_URL: 'https://api.gdeltproject.org/api/v2/doc/doc',
    NEWS_GDELT_TIMEOUT_MS: '60000',
    NEWS_GDELT_MIN_INTERVAL_MS: '60000',
    NEWS_CURSOR_SECRET: cursorSecret,
    NEWS_CANARY_MONITOR_ENABLED: 'true',
    NEWS_CANARY_MONITOR_PROVIDERS: 'AKSHARE',
    NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS: '86400000',
    NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS: '900000',
    NEWS_CANARY_MONITOR_POLL_INTERVAL_MS: '60000',
    NEWS_CANARY_MONITOR_STATE_DIR: 'storage/news-canary',
    NEWS_CANARY_MONITOR_ONCE: 'false',
  }
  const result = rewriteTargetValues(content, desired)

  return {
    content: result.content,
    evidence: {
      changedKeys: result.changedKeys,
      newsEnabled: true,
      akshareBridgeEnabled: true,
      gdeltEnabled: false,
      cursorSecretBytes: Buffer.byteLength(cursorSecret, 'utf8'),
      bridgeTokenBytes: Buffer.byteLength(bridgeToken, 'utf8'),
      gdeltMinIntervalMs: 60_000,
      gdeltTimeoutMs: 60_000,
    },
  }
}

const NEWS_LOCAL_CONFIG_KEYS = [
  'NEWS_ENABLED',
  'NEWS_AKSHARE_BRIDGE_ENABLED',
  'NEWS_AKSHARE_BRIDGE_BASE_URL',
  'NEWS_AKSHARE_BRIDGE_ALLOWED_HOST',
  'NEWS_AKSHARE_BRIDGE_TOKEN',
  'NEWS_AKSHARE_BRIDGE_TIMEOUT_MS',
  'NEWS_GDELT_ENABLED',
  'NEWS_GDELT_BASE_URL',
  'NEWS_GDELT_TIMEOUT_MS',
  'NEWS_GDELT_MIN_INTERVAL_MS',
  'NEWS_CURSOR_SECRET',
  'NEWS_CANARY_MONITOR_ENABLED',
  'NEWS_CANARY_MONITOR_PROVIDERS',
  'NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS',
  'NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS',
  'NEWS_CANARY_MONITOR_POLL_INTERVAL_MS',
  'NEWS_CANARY_MONITOR_STATE_DIR',
  'NEWS_CANARY_MONITOR_ONCE',
] as const
type NewsLocalConfigKey = (typeof NEWS_LOCAL_CONFIG_KEYS)[number]
const NEWS_LOCAL_CONFIG_KEY_SET = new Set<string>(NEWS_LOCAL_CONFIG_KEYS)

function validSecret(value: string | undefined): value is string {
  return Boolean(
    value &&
    Buffer.byteLength(value, 'utf8') >= 32 &&
    !/(?:replace|change[-_ ]?me|example|placeholder|your[-_ ]?secret)/i.test(value),
  )
}

function generateValidSecret(generateSecret: () => string, excluded?: string): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = generateSecret()
    if (validSecret(value) && value !== excluded) return value
  }
  throw new Error('无法生成独立且不少于 32 字节的 News secret')
}

function readTargetValues(content: string): Partial<Record<NewsLocalConfigKey, string>> {
  const values: Partial<Record<NewsLocalConfigKey, string>> = {}
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseAssignment(line)
    if (parsed && NEWS_LOCAL_CONFIG_KEY_SET.has(parsed.key)) {
      values[parsed.key as NewsLocalConfigKey] = parsed.value
    }
  }
  return values
}

function rewriteTargetValues(
  content: string,
  desired: Record<NewsLocalConfigKey, string>,
): { content: string; changedKeys: string[] } {
  const originalLines = content.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  const seen = new Set<NewsLocalConfigKey>()
  const output: string[] = []
  const changed = new Set<string>()

  for (const line of originalLines) {
    const parsed = parseAssignment(line)
    if (!parsed || !NEWS_LOCAL_CONFIG_KEY_SET.has(parsed.key)) {
      if (line || output.length > 0) output.push(line)
      continue
    }
    const key = parsed.key as NewsLocalConfigKey
    if (seen.has(key)) {
      changed.add(key)
      continue
    }
    seen.add(key)
    const nextLine = `${key}=${desired[key]}`
    output.push(nextLine)
    if (line !== nextLine) changed.add(key)
  }

  const missing = NEWS_LOCAL_CONFIG_KEYS.filter((key) => !seen.has(key))
  if (missing.length > 0) {
    if (output.length > 0 && output.at(-1) !== '') output.push('')
    output.push('# 新闻时事模块本地联调（由 news:local:prepare 管理）')
    for (const key of missing) {
      output.push(`${key}=${desired[key]}`)
      changed.add(key)
    }
  }

  return { content: `${output.join('\n')}\n`, changedKeys: [...changed].sort() }
}

function parseAssignment(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
  return match ? { key: match[1], value: match[2] } : null
}
