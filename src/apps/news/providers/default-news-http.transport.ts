import { Injectable } from '@nestjs/common'
import type { NewsHttpRequest, NewsHttpTransport } from '../domain/news.types'
import { NewsProviderError } from './news-provider.errors'

@Injectable()
export class DefaultNewsHttpTransport implements NewsHttpTransport {
  async requestJson<T>(request: NewsHttpRequest): Promise<T> {
    const timeout = AbortSignal.timeout(request.timeoutMs)
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetch(request.url, {
        method: request.method,
        signal,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...request.headers,
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      })
    } catch (error) {
      if (signal.aborted) throw new NewsProviderError('UPSTREAM_TIMEOUT', true, '上游请求超时')
      throw new NewsProviderError('UPSTREAM_UNAVAILABLE', true, sanitizeError(error))
    }

    const maxBytes = request.maxResponseBytes ?? 2_000_000
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > maxBytes) throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, '上游响应超过大小限制')
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, '上游响应超过大小限制')
    }
    if (response.status === 429) {
      throw new NewsProviderError(
        'UPSTREAM_RATE_LIMITED',
        true,
        '上游请求受限',
        parseRetryAfter(response.headers.get('retry-after')),
      )
    }
    if (response.status >= 500)
      throw new NewsProviderError('UPSTREAM_UNAVAILABLE', true, `上游 HTTP ${response.status}`)
    if (!response.ok) throw new NewsProviderError('INVALID_ARGUMENT', false, `上游 HTTP ${response.status}`)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, '上游返回非法 JSON')
    }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 15 * 60_000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.min(date - Date.now(), 15 * 60_000))
}

function sanitizeError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'NETWORK_ERROR'
  return `上游网络错误 (${code.slice(0, 40)})`
}
