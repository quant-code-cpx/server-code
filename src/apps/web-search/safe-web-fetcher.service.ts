import * as http from 'node:http'
import * as https from 'node:https'
import type { LookupFunction } from 'node:net'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { Inject, Injectable } from '@nestjs/common'
import { WebSearchConfig, type IWebSearchConfig } from 'src/config/web-search.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { sha256 } from 'src/apps/agent/audit/agent-audit-sanitizer'
import { WebSearchError } from './web-search.errors'
import { SsrfPolicyService, type ResolvedWebAddress } from './ssrf-policy.service'

export interface SafeWebFetchResponse {
  requestedUrl: string
  finalUrl: string
  redirectChain: string[]
  statusCode: number
  contentType: string
  charset: string | null
  contentEncoding: string | null
  body: Buffer
  retrievedAt: Date
}

interface RawHttpResponse {
  statusCode: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

const ALLOWED_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain'])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

@Injectable()
export class SafeWebFetcherService {
  constructor(
    @Inject(WebSearchConfig.KEY) private readonly config: IWebSearchConfig,
    private readonly policy: SsrfPolicyService,
    private readonly logger: LoggerService,
  ) {}

  async fetch(rawUrl: string, parentSignal: AbortSignal): Promise<SafeWebFetchResponse> {
    const controller = new AbortController()
    const abort = () => controller.abort(parentSignal.reason)
    if (parentSignal.aborted) abort()
    else parentSignal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new WebSearchError('TIMEOUT', '网页抓取超时', true)),
      this.config.timeoutMs,
    )
    try {
      const requestedUrl = this.policy.parseAndAssert(rawUrl).toString()
      const redirectChain: string[] = []
      let current = requestedUrl
      let crossOriginRedirects = 0
      for (let redirectCount = 0; ; redirectCount += 1) {
        if (controller.signal.aborted) throw abortError(parentSignal)
        const url = this.policy.parseAndAssert(current)
        const addresses = await this.policy.resolveAndAssert(url)
        const response = await this.requestOnce(url, addresses, controller.signal)

        if (REDIRECT_STATUSES.has(response.statusCode)) {
          if (redirectCount >= this.config.fetchMaxRedirects) {
            throw new WebSearchError('BLOCKED', '网页重定向次数超过限制')
          }
          const location = singleHeader(response.headers.location)
          if (!location) throw new WebSearchError('UPSTREAM_FAILED', '网页重定向缺少 Location')
          const next = this.policy.parseAndAssert(new URL(location, url).toString())
          if (next.origin !== url.origin) crossOriginRedirects += 1
          if (crossOriginRedirects > 1) throw new WebSearchError('BLOCKED', '网页跨域重定向次数超过限制')
          redirectChain.push(next.toString())
          current = next.toString()
          continue
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new WebSearchError('UPSTREAM_FAILED', '网页服务器响应失败', response.statusCode >= 500)
        }
        const contentType = parseContentType(singleHeader(response.headers['content-type']))
        if (!ALLOWED_MIME_TYPES.has(contentType.mimeType)) throw new WebSearchError('BLOCKED', '网页 MIME 类型不允许')
        const contentEncoding = normalizeContentEncoding(singleHeader(response.headers['content-encoding']))
        const body = decodeBody(response.body, contentEncoding, this.config.fetchMaxBytes)
        this.logger.log(
          {
            operation: 'web.fetch',
            status: 'success',
            hostHash: sha256(new URL(current).hostname),
            redirects: redirectChain.length,
            bytes: body.length,
          },
          SafeWebFetcherService.name,
        )
        return {
          requestedUrl,
          finalUrl: current,
          redirectChain,
          statusCode: response.statusCode,
          contentType: contentType.mimeType,
          charset: contentType.charset,
          contentEncoding,
          body,
          retrievedAt: new Date(),
        }
      }
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      if (controller.signal.aborted) throw abortError(parentSignal)
      throw new WebSearchError('UPSTREAM_FAILED', '网页抓取请求失败', true)
    } finally {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', abort)
    }
  }

  private requestOnce(
    url: URL,
    addresses: readonly ResolvedWebAddress[],
    signal: AbortSignal,
  ): Promise<RawHttpResponse> {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(
          null,
          addresses.map((row) => ({ address: row.address, family: row.family })),
        )
        return
      }
      const selected = addresses[0]
      callback(null, selected.address, selected.family)
    }
    const transport = url.protocol === 'https:' ? https : http

    return new Promise<RawHttpResponse>((resolve, reject) => {
      const request = transport.request(url, {
        method: 'GET',
        agent: false,
        lookup,
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent': 'QuantResearchAgent/1.0 (+controlled-fetch)',
        },
      })
      request.once('response', (response) => {
        const declaredLength = Number(singleHeader(response.headers['content-length']))
        if (Number.isFinite(declaredLength) && declaredLength > this.config.fetchMaxBytes) {
          response.destroy()
          reject(new WebSearchError('RESULT_TOO_LARGE', '网页压缩前响应超过大小限制'))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          total += buffer.length
          if (total > this.config.fetchMaxBytes) {
            response.destroy(new WebSearchError('RESULT_TOO_LARGE', '网页压缩前响应超过大小限制'))
            return
          }
          chunks.push(buffer)
        })
        response.once('end', () =>
          resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
        )
        response.once('error', reject)
      })
      request.once('error', reject)
      request.end()
    })
  }
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function parseContentType(value: string | null): { mimeType: string; charset: string | null } {
  if (!value) return { mimeType: '', charset: null }
  const [mimeType, ...parameters] = value.split(';')
  const charsetParameter = parameters.find((parameter) => /^\s*charset\s*=/i.test(parameter))
  const charset =
    charsetParameter
      ?.split('=', 2)[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase() || null
  return { mimeType: mimeType.trim().toLowerCase(), charset }
}

function normalizeContentEncoding(value: string | null): string | null {
  if (!value || value.trim().toLowerCase() === 'identity') return null
  const normalized = value.trim().toLowerCase()
  if (!['gzip', 'deflate', 'br'].includes(normalized)) {
    throw new WebSearchError('BLOCKED', '网页 Content-Encoding 不允许')
  }
  return normalized
}

function decodeBody(body: Buffer, encoding: string | null, maxBytes: number): Buffer {
  try {
    const decoded =
      encoding === 'gzip'
        ? gunzipSync(body, { maxOutputLength: maxBytes })
        : encoding === 'deflate'
          ? inflateSync(body, { maxOutputLength: maxBytes })
          : encoding === 'br'
            ? brotliDecompressSync(body, { maxOutputLength: maxBytes })
            : body
    if (decoded.length > maxBytes) throw new WebSearchError('RESULT_TOO_LARGE', '网页解压后响应超过大小限制')
    return decoded
  } catch (error) {
    if (error instanceof WebSearchError) throw error
    throw new WebSearchError('RESULT_TOO_LARGE', '网页压缩内容无效或解压后超过大小限制')
  }
}

function abortError(parentSignal: AbortSignal): WebSearchError {
  return parentSignal.aborted
    ? new WebSearchError('CANCELLED', '网页抓取已取消')
    : new WebSearchError('TIMEOUT', '网页抓取超时', true)
}
