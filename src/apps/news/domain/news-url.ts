const TRACKING_KEYS = new Set(['spm', 'from', 'from_source', 'source', 'track', 'tracking_id'])

export function normalizeNewsUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  if (raw.length > 8_192) throw new Error('NEWS_URL_TOO_LONG')

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('NEWS_URL_INVALID')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('NEWS_URL_PROTOCOL_INVALID')
  }

  url.hash = ''
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = ''
  }
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_KEYS.has(key.toLowerCase()))
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
  url.search = ''
  for (const [key, value] of kept) url.searchParams.append(key, value)

  const normalized = url.toString()
  if (normalized.length > 4_096) throw new Error('NEWS_URL_TOO_LONG')
  return normalized
}

export function normalizeAlternateUrls(values: readonly string[], canonicalUrl: string | null): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = normalizeNewsUrl(value)
    if (normalized && normalized !== canonicalUrl) unique.add(normalized)
  }
  return [...unique].sort()
}
