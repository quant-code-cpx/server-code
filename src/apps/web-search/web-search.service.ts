import { Inject, Injectable } from '@nestjs/common'
import { AiSearchFetchStatus } from '@prisma/client'
import { domainToASCII } from 'node:url'
import { CitationRepository } from 'src/apps/agent/audit/citation.repository'
import { sha256 } from 'src/apps/agent/audit/agent-audit-sanitizer'
import { LoggerService } from 'src/shared/logger/logger.service'
import { SourceClassifierService } from './source-classifier.service'
import { SsrfPolicyService } from './ssrf-policy.service'
import { UrlTokenService } from './url-token.service'
import { WebSearchError } from './web-search.errors'
import {
  WEB_SEARCH_PROVIDER,
  type ProviderSearchHit,
  type ProviderSearchQuery,
  type WebSearchProvider,
  type WebSourceType,
} from './web-search.provider'

export interface WebSearchInput {
  query: string
  resultLimit: number
  publishedAfter?: string
  publishedBefore?: string
  domains?: string[]
  language?: 'zh-CN' | 'en'
  sourceTypes?: WebSourceType[]
}

export interface WebSearchContext {
  userId: number
  runId: string
  abortSignal: AbortSignal
}

export interface WebSearchResultHit {
  sourceId: string
  urlToken: string
  canonicalUrl: string
  title: string
  snippet: string
  publisher: string | null
  sourceType: WebSourceType
  publishedAt: string | null
  retrievedAt: string
  rank: number
}

export interface WebSearchResult {
  provider: string
  queryHash: string
  results: WebSearchResultHit[]
  truncated: boolean
  retrievedAt: string
  warningCodes: string[]
}

@Injectable()
export class WebSearchService {
  constructor(
    @Inject(WEB_SEARCH_PROVIDER) private readonly provider: WebSearchProvider,
    private readonly policy: SsrfPolicyService,
    private readonly classifier: SourceClassifierService,
    private readonly urlTokens: UrlTokenService,
    private readonly citations: CitationRepository,
    private readonly logger: LoggerService,
  ) {}

  async search(context: WebSearchContext, input: WebSearchInput): Promise<WebSearchResult> {
    const normalized = normalizeInput(input)
    const providerQuery: ProviderSearchQuery = {
      query: normalized.query,
      resultLimit: normalized.resultLimit,
      publishedAfter: normalized.publishedAfter,
      publishedBefore: normalized.publishedBefore,
      domains: normalized.domains,
      language: normalized.language,
    }
    const startedAt = Date.now()
    const retrievedAt = new Date()
    const providerResult = await this.provider.search(providerQuery, context.abortSignal)
    const seen = new Set<string>()
    const results: WebSearchResultHit[] = []
    let rejected = 0
    let injectionSuspected = false

    for (const hit of providerResult.hits) {
      if (results.length >= normalized.resultLimit) break
      try {
        const canonicalUrl = canonicalizeSearchUrl(this.policy.parseAndAssert(hit.url))
        if (seen.has(canonicalUrl)) continue
        seen.add(canonicalUrl)
        if (!matchesDomains(canonicalUrl, normalized.domains)) continue
        if (!matchesPublishedWindow(hit.publishedAt, normalized.publishedAfter, normalized.publishedBefore)) continue
        const sourceType = this.classifier.classify(new URL(canonicalUrl), hit.publisher)
        if (containsPromptInjection(`${hit.title}\n${hit.snippet}`)) injectionSuspected = true
        if (normalized.sourceTypes.length && !normalized.sourceTypes.includes(sourceType)) continue

        const metadataHash = searchMetadataHash(canonicalUrl, hit, providerResult.provider)
        const source = await this.citations.createSearchSource({
          firstSeenUserId: context.userId,
          firstSeenRunId: context.runId,
          sourceType: this.classifier.toPersistenceType(sourceType),
          url: canonicalUrl,
          canonicalizationVersion: 'web-url-v1',
          title: normalizeText(hit.title, 1_000) || new URL(canonicalUrl).hostname,
          publisher: normalizeText(hit.publisher ?? '', 500) || new URL(canonicalUrl).hostname,
          publishedAt: hit.publishedAt ?? null,
          fetchedAt: retrievedAt,
          contentHash: metadataHash,
          language: normalizeText(hit.language ?? '', 32) || normalized.language || null,
          fetchStatus: AiSearchFetchStatus.METADATA_ONLY,
          metadata: {
            provider: providerResult.provider,
            providerRank: results.length + 1,
            toolSourceType: sourceType,
            snippetHash: sha256(normalizeText(hit.snippet, 2_000)),
            snippetCitable: false,
          },
        })
        const urlToken = this.urlTokens.issue({
          sourceId: source.id,
          userId: context.userId,
          runId: context.runId,
          urlHash: sha256(source.canonicalUrl),
        })
        results.push({
          sourceId: source.id,
          urlToken,
          canonicalUrl,
          title: normalizeText(hit.title, 1_000) || new URL(canonicalUrl).hostname,
          snippet: normalizeText(hit.snippet, 2_000),
          publisher: normalizeText(hit.publisher ?? '', 500) || null,
          sourceType,
          publishedAt: hit.publishedAt?.toISOString() ?? null,
          retrievedAt: retrievedAt.toISOString(),
          rank: results.length + 1,
        })
      } catch (error) {
        if (error instanceof WebSearchError && ['BLOCKED', 'INVALID_ARGUMENT'].includes(error.code)) {
          rejected += 1
          continue
        }
        throw error
      }
    }
    if (!results.length) throw new WebSearchError('DATA_NOT_FOUND', '搜索未返回符合安全与来源条件的结果')
    const queryHash = sha256(normalized.query)
    this.logger.log(
      {
        operation: 'web.search',
        provider: providerResult.provider,
        queryHash,
        resultCount: results.length,
        rejected,
        durationMs: Date.now() - startedAt,
      },
      WebSearchService.name,
    )
    return {
      provider: providerResult.provider,
      queryHash,
      results,
      truncated: providerResult.truncated || providerResult.hits.length > results.length,
      retrievedAt: retrievedAt.toISOString(),
      warningCodes: [
        'SEARCH_SNIPPET_NOT_CITABLE',
        ...(rejected ? ['SEARCH_RESULTS_REJECTED_BY_POLICY'] : []),
        ...(injectionSuspected ? ['SEARCH_SNIPPET_PROMPT_INJECTION_SUSPECTED'] : []),
      ],
    }
  }
}

interface NormalizedSearchInput {
  query: string
  resultLimit: number
  publishedAfter?: Date
  publishedBefore?: Date
  domains: string[]
  language?: 'zh-CN' | 'en'
  sourceTypes: WebSourceType[]
}

function normalizeInput(input: WebSearchInput): NormalizedSearchInput {
  const query = normalizeText(input.query, 256)
  if (query.length < 2) throw new WebSearchError('INVALID_ARGUMENT', '搜索词长度必须是 2-256 字符')
  if (!Number.isInteger(input.resultLimit) || input.resultLimit < 1 || input.resultLimit > 10) {
    throw new WebSearchError('INVALID_ARGUMENT', 'resultLimit 必须是 1-10 的整数')
  }
  const publishedAfter = parseOptionalDate(input.publishedAfter, 'publishedAfter')
  const publishedBefore = parseOptionalDate(input.publishedBefore, 'publishedBefore')
  if (publishedAfter && publishedBefore && publishedAfter > publishedBefore) {
    throw new WebSearchError('INVALID_ARGUMENT', 'publishedAfter 不能晚于 publishedBefore')
  }
  const domains = [...new Set((input.domains ?? []).map(normalizeDomain))]
  if (domains.length > 20) throw new WebSearchError('INVALID_ARGUMENT', 'domains 最多 20 个')
  return {
    query,
    resultLimit: input.resultLimit,
    publishedAfter,
    publishedBefore,
    domains,
    language: input.language,
    sourceTypes: [...new Set(input.sourceTypes ?? [])],
  }
}

function canonicalizeSearchUrl(url: URL): string {
  const trackingKeys = new Set(['fbclid', 'gclid', 'spm', 'from', 'ref', 'source'])
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || trackingKeys.has(key.toLowerCase())) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  return url.toString()
}

function normalizeDomain(value: string): string {
  const normalized = domainToASCII(
    value
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, ''),
  )
  if (!normalized || normalized.length > 253 || !/^[a-z0-9.-]+$/.test(normalized) || normalized.includes('..')) {
    throw new WebSearchError('INVALID_ARGUMENT', 'domains 包含无效域名')
  }
  return normalized
}

function matchesDomains(url: string, domains: readonly string[]): boolean {
  if (!domains.length) return true
  const hostname = new URL(url).hostname.toLowerCase()
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function matchesPublishedWindow(value: Date | null | undefined, after?: Date, before?: Date): boolean {
  if (!after && !before) return true
  if (!value) return false
  return (!after || value >= after) && (!before || value <= before)
}

function searchMetadataHash(url: string, hit: ProviderSearchHit, provider: string): string {
  return sha256(
    JSON.stringify({
      url,
      title: normalizeText(hit.title, 1_000),
      snippet: normalizeText(hit.snippet, 2_000),
      publisher: normalizeText(hit.publisher ?? '', 500),
      publishedAt: hit.publishedAt?.toISOString() ?? null,
      provider,
    }),
  )
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function parseOptionalDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new WebSearchError('INVALID_ARGUMENT', `${name} 必须是有效 date-time`)
  return parsed
}

function containsPromptInjection(value: string): boolean {
  return /ignore (all |any )?(previous|prior) instructions?|system prompt|developer message|调用工具|忽略.{0,12}(之前|以上|先前).{0,8}(指令|要求)/iu.test(
    value,
  )
}
