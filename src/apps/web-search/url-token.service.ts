import { createHmac, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { WebSearchConfig, type IWebSearchConfig } from 'src/config/web-search.config'
import { WebSearchError } from './web-search.errors'

interface CompactUrlTokenClaims {
  v: 1
  s: string
  u: number
  r: string
  h: string
  e: number
}

export interface SignedUrlTokenClaims {
  sourceId: string
  userId: number
  runId: string
  urlHash: string
  expiresAt: number
}

export interface IssueUrlTokenCommand {
  sourceId: string
  userId: number
  runId: string
  urlHash: string
}

@Injectable()
export class UrlTokenService {
  constructor(@Inject(WebSearchConfig.KEY) private readonly config: IWebSearchConfig) {}

  issue(command: IssueUrlTokenCommand): string {
    const secret = this.secret()
    const claims: CompactUrlTokenClaims = {
      v: 1,
      s: requireText(command.sourceId, 'sourceId', 32),
      u: requireUserId(command.userId),
      r: requireText(command.runId, 'runId', 32),
      h: requireHash(command.urlHash),
      e: Math.floor(Date.now() / 1_000) + this.config.urlTokenTtlSeconds,
    }
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
    const signature = sign(payload, secret)
    const token = `${payload}.${signature}`
    if (token.length > 512) throw new WebSearchError('INVALID_ARGUMENT', 'URL token 超过长度限制')
    return token
  }

  verify(token: string, expected: { userId: number; runId: string }): SignedUrlTokenClaims {
    const secret = this.secret()
    const normalized = requireText(token, 'urlToken', 512)
    const parts = normalized.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidToken()
    const actual = Buffer.from(parts[1], 'base64url')
    const expectedSignature = Buffer.from(sign(parts[0], secret), 'base64url')
    if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) throw invalidToken()

    let claims: CompactUrlTokenClaims
    try {
      claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as CompactUrlTokenClaims
    } catch {
      throw invalidToken()
    }
    if (
      claims.v !== 1 ||
      claims.u !== requireUserId(expected.userId) ||
      claims.r !== requireText(expected.runId, 'runId', 32) ||
      !Number.isSafeInteger(claims.e) ||
      claims.e <= Math.floor(Date.now() / 1_000)
    ) {
      throw invalidToken()
    }
    return {
      sourceId: requireText(claims.s, 'sourceId', 32),
      userId: claims.u,
      runId: claims.r,
      urlHash: requireHash(claims.h),
      expiresAt: claims.e,
    }
  }

  private secret(): Buffer {
    if (!this.config.urlTokenSecret) throw new WebSearchError('UPSTREAM_FAILED', 'URL token 服务未配置')
    return Buffer.from(this.config.urlTokenSecret, 'utf8')
  }
}

function sign(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')
}

function invalidToken(): WebSearchError {
  return new WebSearchError('BLOCKED', 'URL token 无效、已过期或不属于当前执行')
}

function requireUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidToken()
  return value
}

function requireHash(value: string): string {
  const normalized = value?.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw invalidToken()
  return normalized
}

function requireText(value: string, name: string, maxLength: number): string {
  const normalized = value?.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new WebSearchError('INVALID_ARGUMENT', `${name} 无效`)
  }
  return normalized
}
