import { createHash } from 'node:crypto'

export type AuditJsonValue = null | boolean | number | string | AuditJsonValue[] | { [key: string]: AuditJsonValue }

export interface AuditSanitizerOptions {
  maxDepth?: number
  maxArrayLength?: number
  maxStringLength?: number
}

export interface SanitizedAuditPayload {
  summary: AuditJsonValue
  hash: string
}

const REDACTED = '[REDACTED]'
const MAX_DEPTH = '[MAX_DEPTH]'
const CIRCULAR = '[CIRCULAR]'
const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_ARRAY_LENGTH = 50
const DEFAULT_MAX_STRING_LENGTH = 2_000

const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'cookie',
  'authorization',
  'apikey',
  'privatekey',
  'credential',
]
const FORBIDDEN_PROMPT_KEYS = new Set([
  'prompt',
  'fullprompt',
  'systemprompt',
  'hiddenreasoning',
  'chainofthought',
  'cot',
  'messages',
])
const SENSITIVE_QUERY_PARTS = [...SENSITIVE_KEY_PARTS, 'signature', 'session', 'accesskey', 'clientkey']
const SAFE_TOKEN_USAGE_KEYS = new Set([
  'inputtokens',
  'outputtokens',
  'totaltokens',
  'cachedtokens',
  'reasoningtokens',
  'tokencount',
])

export function sanitizeAuditPayload(value: unknown, options: AuditSanitizerOptions = {}): AuditJsonValue {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new Error('maxDepth 必须为正整数')
  if (!Number.isInteger(maxArrayLength) || maxArrayLength < 1) throw new Error('maxArrayLength 必须为正整数')
  if (!Number.isInteger(maxStringLength) || maxStringLength < 1) throw new Error('maxStringLength 必须为正整数')

  const seen = new WeakSet<object>()
  const visit = (input: unknown, depth: number): AuditJsonValue => {
    if (input === null) return null
    if (typeof input === 'string') return truncateString(sanitizeUrl(input), maxStringLength)
    if (typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : String(input)
    if (typeof input === 'bigint') return input.toString()
    if (typeof input === 'undefined' || typeof input === 'function' || typeof input === 'symbol') return null
    if (input instanceof Date) return input.toISOString()
    if (depth >= maxDepth) return MAX_DEPTH
    if (typeof input !== 'object') return truncateString(String(input), maxStringLength)
    if (seen.has(input)) return CIRCULAR

    seen.add(input)
    try {
      if (Array.isArray(input)) {
        const values = input.slice(0, maxArrayLength).map((item) => visit(item, depth + 1))
        if (input.length > maxArrayLength) values.push(`[TRUNCATED:${input.length - maxArrayLength}]`)
        return values
      }

      const result: Record<string, AuditJsonValue> = {}
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        result[key] = isSensitiveKey(key) ? REDACTED : visit((input as Record<string, unknown>)[key], depth + 1)
      }
      return result
    } finally {
      seen.delete(input)
    }
  }

  return visit(value, 0)
}

export function sanitizeAndHashAuditPayload(
  value: unknown,
  options: AuditSanitizerOptions = {},
): SanitizedAuditPayload {
  const summary = sanitizeAuditPayload(value, options)
  return { summary, hash: sha256(canonicalJson(summary)) }
}

export function canonicalJson(value: AuditJsonValue): string {
  return JSON.stringify(value)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function sanitizeAuditErrorMessage(message: unknown, maxLength = 1_000): string {
  const sanitized = sanitizeAuditPayload({ message }, { maxStringLength: maxLength })
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') return REDACTED
  const value = sanitized.message
  return typeof value === 'string' ? value : REDACTED
}

export function canonicalizeExternalUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim())
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('来源 URL 仅支持 HTTP/HTTPS')
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''

  for (const key of [...parsed.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) parsed.searchParams.delete(key)
  }
  parsed.searchParams.sort()
  return parsed.toString()
}

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value.trim())) return value
  try {
    return canonicalizeExternalUrl(value)
  } catch {
    return REDACTED
  }
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}[TRUNCATED:${value.length - maxLength}]`
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (SAFE_TOKEN_USAGE_KEYS.has(normalized)) return false
  return FORBIDDEN_PROMPT_KEYS.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return SENSITIVE_QUERY_PARTS.some((part) => normalized.includes(part))
}
