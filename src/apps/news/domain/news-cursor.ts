import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { NewsHttpException } from '../news.errors'
import { sha256, stableJson } from './news-identity'

export interface NewsCursorPayloadV1 {
  version: 1
  expiresAt: string
  snapshotAt: string
  effectiveAfter: string
  effectiveBefore: string
  queryHash: string
  scopeFingerprint: string
  timelineSortAt: string
  firstSeenAt: string
  articleId: string
}

export class NewsCursorCodec {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  encode(payload: Omit<NewsCursorPayloadV1, 'version' | 'expiresAt'>, now: Date): string {
    const complete: NewsCursorPayloadV1 = {
      version: 1,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1_000).toISOString(),
      ...payload,
    }
    const body = deflateRawSync(Buffer.from(stableJson(complete), 'utf8'), { level: 9 }).toString('base64url')
    const signature = this.sign(body)
    const token = `${body}.${signature}`
    if (token.length > 512) throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    return token
  }

  decode(token: string, now: Date): NewsCursorPayloadV1 {
    if (!token || token.length > 512) throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    const [body, signature, extra] = token.split('.')
    if (!body || !signature || extra) throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    const expected = Buffer.from(this.sign(body), 'utf8')
    const actual = Buffer.from(signature, 'utf8')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    }

    let parsed: unknown
    try {
      const compressed = Buffer.from(body, 'base64url')
      if (compressed.length > 512) throw new Error('cursor body 过大')
      parsed = JSON.parse(inflateRawSync(compressed, { maxOutputLength: 2_048 }).toString('utf8'))
    } catch {
      throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    }
    if (!isPayload(parsed)) throw NewsHttpException.fromKey('NEWS_CURSOR_INVALID')
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) throw NewsHttpException.fromKey('NEWS_CURSOR_EXPIRED')
    return parsed
  }

  hashQuery(value: unknown): string {
    return sha256(stableJson(value))
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body, 'utf8').digest('base64url')
  }
}

function isPayload(value: unknown): value is NewsCursorPayloadV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = [
    'expiresAt',
    'snapshotAt',
    'effectiveAfter',
    'effectiveBefore',
    'queryHash',
    'scopeFingerprint',
    'timelineSortAt',
    'firstSeenAt',
    'articleId',
  ]
  if (input.version !== 1 || keys.some((key) => typeof input[key] !== 'string')) return false
  if (!/^[a-f0-9]{64}$/.test(input.queryHash as string) || !/^[a-f0-9]{64}$/.test(input.scopeFingerprint as string))
    return false
  if (!/^[a-z0-9]{20,32}$/.test(input.articleId as string)) return false
  return ['expiresAt', 'snapshotAt', 'effectiveAfter', 'effectiveBefore', 'timelineSortAt', 'firstSeenAt'].every(
    (key) => !Number.isNaN(Date.parse(input[key] as string)),
  )
}
