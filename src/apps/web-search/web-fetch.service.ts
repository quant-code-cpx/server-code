import { Injectable } from '@nestjs/common'
import { AiSearchFetchStatus, type AiSearchSource } from '@prisma/client'
import { CitationRepository } from 'src/apps/agent/audit/citation.repository'
import { sha256 } from 'src/apps/agent/audit/agent-audit-sanitizer'
import { LoggerService } from 'src/shared/logger/logger.service'
import { HtmlContentExtractor, type ExtractedSectionLocator, type WebExtractMode } from './html-content.extractor'
import { SafeWebFetcherService } from './safe-web-fetcher.service'
import { SourceClassifierService } from './source-classifier.service'
import { UrlTokenService } from './url-token.service'
import { WebSearchError } from './web-search.errors'
import type { WebSourceType } from './web-search.provider'

export interface WebFetchInput {
  urlToken: string
  maxCharacters?: number
  extract?: WebExtractMode
}

export interface WebFetchContext {
  userId: number
  runId: string
  abortSignal: AbortSignal
}

export interface WebFetchResult {
  sourceId: string
  canonicalUrl: string
  finalUrl: string
  title: string
  publisher: string | null
  author: string | null
  sourceType: WebSourceType
  publishedAt: string | null
  retrievedAt: string
  mimeType: string
  language: string | null
  contentHash: string
  text: string
  sections: ExtractedSectionLocator[]
  truncated: boolean
  extractionVersion: string
  untrustedExternalContent: true
  riskFlags: string[]
  warningCodes: string[]
}

@Injectable()
export class WebFetchService {
  constructor(
    private readonly urlTokens: UrlTokenService,
    private readonly citations: CitationRepository,
    private readonly fetcher: SafeWebFetcherService,
    private readonly extractor: HtmlContentExtractor,
    private readonly classifier: SourceClassifierService,
    private readonly logger: LoggerService,
  ) {}

  async fetch(context: WebFetchContext, input: WebFetchInput): Promise<WebFetchResult> {
    const maxCharacters = input.maxCharacters ?? 30_000
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1_000 || maxCharacters > 100_000) {
      throw new WebSearchError('INVALID_ARGUMENT', 'maxCharacters 必须是 1000-100000 的整数')
    }
    const extract = input.extract ?? 'ARTICLE'
    if (!['ARTICLE', 'VISIBLE_TEXT', 'METADATA_ONLY'].includes(extract)) {
      throw new WebSearchError('INVALID_ARGUMENT', 'extract 模式无效')
    }
    const claims = this.urlTokens.verify(input.urlToken, context)
    let source: AiSearchSource
    try {
      source = await this.citations.findSearchSourceById(claims.sourceId)
    } catch {
      throw new WebSearchError('DATA_NOT_FOUND', 'URL token 对应来源不存在')
    }
    if (sha256(source.canonicalUrl) !== claims.urlHash) {
      throw new WebSearchError('BLOCKED', 'URL token 与来源 URL 不一致')
    }

    try {
      const fetched = await this.fetcher.fetch(source.canonicalUrl, context.abortSignal)
      const extracted = this.extractor.extract(fetched, maxCharacters, extract)
      if (extract !== 'METADATA_ONLY' && !extracted.text) {
        throw new WebSearchError('DATA_NOT_FOUND', '网页没有可提取的静态正文')
      }
      const toolSourceType = this.classifier.fromPersistenceType(
        source.sourceType,
        metadataValue(source, 'toolSourceType'),
      )
      const persisted = await this.citations.createSearchSource({
        firstSeenUserId: context.userId,
        firstSeenRunId: context.runId,
        sourceType: this.classifier.toPersistenceType(toolSourceType),
        url: source.canonicalUrl,
        canonicalizationVersion: source.canonicalizationVersion,
        title: extracted.title ?? source.title,
        publisher: extracted.publisher ?? source.publisher,
        author: extracted.author ?? source.author,
        publishedAt: extracted.publishedAt ?? source.publishedAt,
        fetchedAt: fetched.retrievedAt,
        contentHash: extracted.contentHash,
        mimeType: fetched.contentType,
        language: extracted.language ?? source.language,
        fetchStatus: AiSearchFetchStatus.FETCHED,
        metadata: {
          finalUrl: fetched.finalUrl,
          redirectChain: fetched.redirectChain,
          extractionVersion: extracted.extractionVersion,
          toolSourceType,
          riskFlags: extracted.riskFlags,
          sections: extracted.sections,
          untrustedExternalContent: true,
        },
      })
      this.logger.log(
        {
          operation: 'web.extract',
          sourceId: persisted.id,
          contentHash: extracted.contentHash,
          characters: extracted.text.length,
          sections: extracted.sections.length,
          truncated: extracted.truncated,
          riskFlags: extracted.riskFlags,
        },
        WebFetchService.name,
      )
      return {
        sourceId: persisted.id,
        canonicalUrl: source.canonicalUrl,
        finalUrl: fetched.finalUrl,
        title: extracted.title ?? source.title,
        publisher: extracted.publisher ?? source.publisher,
        author: extracted.author ?? source.author,
        sourceType: toolSourceType,
        publishedAt: (extracted.publishedAt ?? source.publishedAt)?.toISOString() ?? null,
        retrievedAt: fetched.retrievedAt.toISOString(),
        mimeType: fetched.contentType,
        language: extracted.language ?? source.language,
        contentHash: extracted.contentHash,
        text: extracted.text,
        sections: extracted.sections,
        truncated: extracted.truncated,
        extractionVersion: extracted.extractionVersion,
        untrustedExternalContent: true,
        riskFlags: extracted.riskFlags,
        warningCodes: extracted.warnings,
      }
    } catch (error) {
      await this.persistFailure(context, source, error)
      throw error
    }
  }

  private async persistFailure(context: WebFetchContext, source: AiSearchSource, error: unknown): Promise<void> {
    const webError = error instanceof WebSearchError ? error : new WebSearchError('UPSTREAM_FAILED', '网页抓取失败')
    const fetchStatus = webError.code === 'BLOCKED' ? AiSearchFetchStatus.BLOCKED : AiSearchFetchStatus.FAILED
    try {
      await this.citations.createSearchSource({
        firstSeenUserId: context.userId,
        firstSeenRunId: context.runId,
        sourceType: source.sourceType,
        url: source.canonicalUrl,
        canonicalizationVersion: source.canonicalizationVersion,
        title: source.title,
        publisher: source.publisher,
        author: source.author,
        publishedAt: source.publishedAt,
        fetchedAt: new Date(),
        contentHash: sha256(`fetch-failure:${source.id}:${webError.code}`),
        mimeType: source.mimeType,
        language: source.language,
        fetchStatus,
        metadata: { errorClass: webError.code },
      })
    } catch {
      this.logger.warn({ operation: 'web.fetch.persist_failure', errorClass: webError.code }, WebFetchService.name)
    }
  }
}

function metadataValue(source: AiSearchSource, key: string): unknown {
  const metadata = source.metadata
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return undefined
  return (metadata as Record<string, unknown>)[key]
}
