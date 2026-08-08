import { computeNewsContentHash, computeNewsIdentity, computeSyntheticUpstreamId, sha256 } from './news-identity'
import { normalizeAlternateUrls, normalizeNewsUrl } from './news-url'
import { assertPublishedTimeInvariant, timelineSortAt } from './news-time'
import {
  NEWS_QUALITY_FLAGS,
  type NewsQualityFlag,
  type NewsSourceTypeValue,
  type NormalizedNewsItem,
  type ProviderNewsItem,
} from './news.types'

export const NEWS_NORMALIZER_VERSION = 'news-normalizer-v1'
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu

export function normalizeNewsItem(input: {
  providerKey: string
  feedKey: string
  sourceType: NewsSourceTypeValue
  item: ProviderNewsItem
  retrievedAt: Date
  maxChars?: number
}): NormalizedNewsItem {
  const maxChars = input.maxChars ?? 1_000
  const flags = new Set<string>(input.item.qualityFlags ?? [])
  const normalizedExcerptResult = normalizeAndLimit(input.item.excerpt, maxChars)
  if (normalizedExcerptResult.truncated) flags.add('TRUNCATED')

  let normalizedTitleResult = normalizeAndLimit(input.item.title, maxChars)
  if (!normalizedTitleResult.value) {
    const generated = normalizedExcerptResult.value
      ? `${takeCodePoints(normalizedExcerptResult.value, 80)}…`
      : '未命名快讯'
    normalizedTitleResult = { value: generated, truncated: false }
    flags.add('GENERATED_TITLE')
  }
  if (normalizedTitleResult.truncated) flags.add('TRUNCATED')

  const canonicalUrl = normalizeNewsUrl(input.item.canonicalUrl)
  const alternateAll = normalizeAlternateUrls(input.item.alternateUrls, canonicalUrl)
  const alternateUrls = alternateAll.slice(0, 20)
  if (alternateAll.length > 20) flags.add('TRUNCATED')
  if (!canonicalUrl) flags.add('MISSING_CANONICAL_URL')
  if (input.item.publishedPrecision === 'UNKNOWN') flags.add('PUBLISHED_TIME_UNKNOWN')
  if (!input.item.publishedAt && input.item.sourceDiscoveredAt) flags.add('SOURCE_DISCOVERY_TIME_ONLY')

  assertPublishedTimeInvariant({
    precision: input.item.publishedPrecision,
    publishedAt: input.item.publishedAt,
    publishedDate: input.item.publishedDate,
  })

  const publisherResult = normalizeAndLimit(input.item.publisher, 256)
  if (publisherResult.truncated) flags.add('TRUNCATED')
  const qualityFlags = sortQualityFlags(flags)
  const upstreamId =
    input.item.upstreamId.trim() ||
    computeSyntheticUpstreamId({
      publisher: publisherResult.value,
      normalizedTitle: normalizedTitleResult.value!,
      normalizedExcerpt: normalizedExcerptResult.value,
      sourceTime:
        input.item.publishedAt?.toISOString() ??
        input.item.publishedDate ??
        input.item.sourceDiscoveredAt?.toISOString() ??
        null,
    })
  const identityHash = computeNewsIdentity({
    canonicalUrl,
    providerKey: input.providerKey,
    feedKey: input.feedKey,
    upstreamId,
  })
  const contentHash = computeNewsContentHash({
    contentType: input.item.contentType,
    sourceType: input.sourceType,
    canonicalUrl,
    alternateUrls,
    normalizedTitle: normalizedTitleResult.value!,
    normalizedExcerpt: normalizedExcerptResult.value,
    publisher: publisherResult.value,
    publishedAt: input.item.publishedAt,
    publishedDate: input.item.publishedDate,
    publishedPrecision: input.item.publishedPrecision,
    language: input.item.language,
    sourceCountry: input.item.sourceCountry,
    qualityFlags,
  })

  return {
    ...input.item,
    providerKey: input.providerKey,
    feedKey: input.feedKey,
    sourceType: input.sourceType,
    upstreamId,
    title: normalizedTitleResult.value!,
    excerpt: normalizedExcerptResult.value,
    publisher: publisherResult.value,
    canonicalUrl,
    alternateUrls,
    securityHints: [...new Set(input.item.securityHints.map((value) => value.trim()).filter(Boolean))].sort(),
    rawPayloadHash: /^[a-f0-9]{64}$/.test(input.item.rawPayloadHash)
      ? input.item.rawPayloadHash
      : sha256(input.item.rawPayloadHash),
    identityHash,
    contentHash,
    canonicalUrlHash: canonicalUrl ? sha256(canonicalUrl) : null,
    normalizedTitle: normalizedTitleResult.value!,
    normalizedExcerpt: normalizedExcerptResult.value,
    timelineSortAt: timelineSortAt({
      precision: input.item.publishedPrecision,
      publishedAt: input.item.publishedAt,
      publishedDate: input.item.publishedDate,
      firstSeenAt: input.retrievedAt,
    }),
    qualityFlags,
  }
}

export function choosePrimarySourceType(left: NewsSourceTypeValue, right: NewsSourceTypeValue): NewsSourceTypeValue {
  const priority: Record<NewsSourceTypeValue, number> = {
    REGULATOR: 7,
    EXCHANGE: 6,
    COMPANY: 5,
    INSTITUTION: 4,
    MEDIA: 3,
    AGGREGATOR: 2,
    OTHER: 1,
  }
  return priority[left] >= priority[right] ? left : right
}

export function sortQualityFlags(values: Iterable<NewsQualityFlag>): string[] {
  const order = new Map<string, number>(NEWS_QUALITY_FLAGS.map((flag, index) => [flag, index]))
  return [...new Set(values)]
    .sort((left, right) => {
      const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.localeCompare(right)
    })
    .slice(0, 16)
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(ZERO_WIDTH, '').replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim()
}

function normalizeAndLimit(value: string | null, limit: number): { value: string | null; truncated: boolean } {
  if (value == null) return { value: null, truncated: false }
  const normalized = normalizeText(value)
  if (!normalized) return { value: null, truncated: false }
  const codePoints = Array.from(normalized)
  return codePoints.length <= limit
    ? { value: normalized, truncated: false }
    : { value: codePoints.slice(0, limit).join(''), truncated: true }
}

function takeCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('')
}
