import { sha256, stableJson } from './news-identity'
import type { RejectedProviderNewsItem } from './news.types'
import { NewsProviderError } from '../providers/news-provider.errors'

export function rejectProviderItem(item: unknown, index: number, error: unknown): RejectedProviderNewsItem {
  const record = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}
  const rawPayloadHash =
    typeof record.rawPayloadHash === 'string' && /^[a-f0-9]{64}$/.test(record.rawPayloadHash)
      ? record.rawPayloadHash
      : sha256(stableJson(item))
  const upstreamId = typeof record.upstreamId === 'string' ? record.upstreamId : String(index)
  const message = error instanceof Error ? error.message : String(error)

  return {
    itemKeyHash: sha256(`${upstreamId}:${rawPayloadHash}`),
    rawPayloadHash,
    errorCode: error instanceof NewsProviderError ? error.code : 'ITEM_MAPPING_FAILED',
    errorMessage: message.slice(0, 500),
    fieldManifest: {
      index,
      fields: Object.keys(record).sort(),
      titleLength: typeof record.title === 'string' ? Array.from(record.title).length : null,
      hasCanonicalUrl: Boolean(record.canonicalUrl),
    },
    retryable: error instanceof NewsProviderError && error.retryable,
  }
}
