import { createHash } from 'node:crypto'
import type { NewsContentTypeValue, NewsPublishedPrecisionValue, NewsSourceTypeValue } from './news.types'

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function computeNewsIdentity(input: {
  canonicalUrl: string | null
  providerKey: string
  feedKey: string
  upstreamId: string
}): string {
  return input.canonicalUrl
    ? sha256(`url:v1\n${input.canonicalUrl}`)
    : sha256(`provider:v1\n${input.providerKey}\n${input.feedKey}\n${input.upstreamId}`)
}

export function computeSyntheticUpstreamId(input: {
  publisher: string | null
  normalizedTitle: string
  normalizedExcerpt: string | null
  sourceTime: string | null
}): string {
  return `synthetic:v1:${sha256(
    `${input.publisher ?? ''}\n${input.normalizedTitle}\n${input.normalizedExcerpt ?? ''}\n${input.sourceTime ?? ''}`,
  )}`
}

export function computeNewsContentHash(input: {
  contentType: NewsContentTypeValue
  sourceType: NewsSourceTypeValue
  canonicalUrl: string | null
  alternateUrls: readonly string[]
  normalizedTitle: string
  normalizedExcerpt: string | null
  publisher: string | null
  publishedAt: Date | null
  publishedDate: string | null
  publishedPrecision: NewsPublishedPrecisionValue
  language: string | null
  sourceCountry: string | null
  qualityFlags: readonly string[]
}): string {
  return sha256(
    [
      'content:v1',
      input.contentType,
      input.sourceType,
      input.canonicalUrl ?? '',
      stableJson(input.alternateUrls),
      input.normalizedTitle,
      input.normalizedExcerpt ?? '',
      input.publisher ?? '',
      input.publishedAt?.toISOString() ?? '',
      input.publishedDate ?? '',
      input.publishedPrecision,
      input.language ?? '',
      input.sourceCountry ?? '',
      stableJson(input.qualityFlags),
    ].join('\n'),
  )
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}
