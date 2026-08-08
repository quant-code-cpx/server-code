import { Inject, Injectable } from '@nestjs/common'
import { formatPrismaDate } from './domain/news-time'
import { NEWS_CLOCK, type NewsClock } from './domain/news.types'
import type { NewsHighlightsRequestDto } from './dto/news-request.dto'
import type {
  NewsCoverageResponseDto,
  NewsHighlightItemDto,
  NewsHighlightsResponseDto,
  NewsImpactReasonCode,
} from './dto/news-response.dto'
import { NewsRepository, type NewsListRepositoryRow } from './news.repository'

const RANKING_VERSION = 'impact-v1' as const
const CRITICAL_THRESHOLD = 75
const MAJOR_THRESHOLD = 55
const MINIMUM_HIGHLIGHT_COUNT = 3
const FRESH_CACHE_MS = 60_000
const STALE_CACHE_MS = 15 * 60_000
const CANDIDATE_LIMIT = 60
export const NEWS_HIGHLIGHTS_COVERAGE = Symbol('NEWS_HIGHLIGHTS_COVERAGE')

const BREAKING_TERMS = [
  '停牌',
  '复牌',
  '重大',
  '重组',
  '收购',
  '破产',
  '退市',
  '处罚',
  '调查',
  '暴雷',
  '降息',
  '加息',
  '降准',
  '盈利预警',
] as const
const MARKET_WIDE_TERMS = ['央行', '证监会', '国务院', '美联储', '汇率', 'A股', '沪深', '港股'] as const

type RankedCandidate = {
  row: NewsListRepositoryRow
  impactScore: number
  reasonCodes: NewsImpactReasonCode[]
  effectiveAt: Date
}

type ClusteredCandidate = RankedCandidate & {
  corroboratingSourceCount: number
  relatedArticleCount: number
}

type CacheEntry = {
  cachedAt: Date
  response: NewsHighlightsResponseDto
}

type HighlightsCoverage = {
  getCoverage(): Promise<NewsCoverageResponseDto>
}

@Injectable()
export class NewsHighlightsService {
  private cache: CacheEntry | null = null

  constructor(
    private readonly repository: NewsRepository,
    @Inject(NEWS_HIGHLIGHTS_COVERAGE) private readonly coverageService: HighlightsCoverage,
    @Inject(NEWS_CLOCK) private readonly clock: NewsClock,
  ) {}

  async getHighlights(dto: NewsHighlightsRequestDto): Promise<NewsHighlightsResponseDto> {
    const now = this.clock.now()
    const fresh = this.cached(now, FRESH_CACHE_MS)
    if (fresh) return limitResponse(fresh, dto.limit)

    try {
      const [rows, coverage] = await Promise.all([
        this.repository.listHighlightCandidates(now, CANDIDATE_LIMIT),
        this.coverageService.getCoverage(),
      ])
      const response = createHighlightsResponse(rows, coverage, now, 5)
      this.cache = { cachedAt: now, response }
      return limitResponse(response, dto.limit)
    } catch (error) {
      const stale = this.cached(now, STALE_CACHE_MS)
      if (stale) {
        return limitResponse(
          { ...stale, generatedAt: now.toISOString(), partial: true, rankingStatus: 'STALE' },
          dto.limit,
        )
      }

      try {
        const rows = await this.repository.listRecentArticles(now, 5)
        const response = recentFallback(rows, now, 5)
        this.cache = { cachedAt: now, response }
        return limitResponse(response, dto.limit)
      } catch {
        throw error
      }
    }
  }

  private cached(now: Date, maximumAgeMs: number): NewsHighlightsResponseDto | null {
    if (!this.cache || now.getTime() - this.cache.cachedAt.getTime() > maximumAgeMs) return null
    return this.cache.response
  }
}

export function createHighlightsResponse(
  rows: NewsListRepositoryRow[],
  coverage: NewsCoverageResponseDto,
  now: Date,
  limit: number,
): NewsHighlightsResponseDto {
  if (rows.length === 0) {
    return {
      generatedAt: now.toISOString(),
      dataThrough: coverage.dataThrough,
      partial: coverage.partial,
      warnings: coverage.warnings,
      rankingVersion: RANKING_VERSION,
      rankingStatus: 'READY',
      displayMode: 'HIGHLIGHTS',
      items: [],
    }
  }

  const clusters = clusterCandidates(rows.map((row) => rankCandidate(row, now)))
  const highlights = clusters.filter((candidate) => candidate.impactScore >= MAJOR_THRESHOLD)
  if (highlights.length < MINIMUM_HIGHLIGHT_COUNT) {
    return {
      ...recentFallback(rows, now, limit),
      dataThrough: coverage.dataThrough,
      partial: coverage.partial,
      warnings: coverage.warnings,
    }
  }

  return {
    generatedAt: now.toISOString(),
    dataThrough: coverage.dataThrough,
    partial: coverage.partial,
    warnings: coverage.warnings,
    rankingVersion: RANKING_VERSION,
    rankingStatus: 'READY',
    displayMode: 'HIGHLIGHTS',
    items: highlights.slice(0, limit).map((candidate) => mapHighlight(candidate, false)),
  }
}

export function rankHighlightCandidates(rows: NewsListRepositoryRow[], now: Date): NewsHighlightItemDto[] {
  return clusterCandidates(rows.map((row) => rankCandidate(row, now))).map((candidate) =>
    mapHighlight(candidate, false),
  )
}

function recentFallback(rows: NewsListRepositoryRow[], now: Date, limit: number): NewsHighlightsResponseDto {
  const recent = [...rows]
    .map((row) => rankCandidate(row, now))
    .sort(compareRecent)
    .slice(0, limit)
    .map((candidate) =>
      mapHighlight(
        { ...candidate, corroboratingSourceCount: candidate.row.providerKeys.length, relatedArticleCount: 0 },
        true,
      ),
    )
  return {
    generatedAt: now.toISOString(),
    dataThrough: newestDataThrough(rows),
    partial: true,
    warnings: [],
    rankingVersion: RANKING_VERSION,
    rankingStatus: 'RECENT_FALLBACK',
    displayMode: 'RECENT',
    items: recent,
  }
}

function rankCandidate(row: NewsListRepositoryRow, now: Date): RankedCandidate {
  const reasons = new Set<NewsImpactReasonCode>()
  const searchable = `${row.title} ${row.excerpt ?? ''}`.normalize('NFKC')
  const hasBreakingEvent = BREAKING_TERMS.some((term) => searchable.includes(term))
  const hasMarketWideImpact = MARKET_WIDE_TERMS.some((term) => searchable.includes(term))

  const sourceAuthority = sourceScore(row.sourceType)
  const eventSeverity = eventSeverityScore(row.contentType, hasBreakingEvent)
  const marketCoverage = marketCoverageScore(row, hasMarketWideImpact)

  if (hasBreakingEvent) reasons.add('BREAKING_EVENT')
  if (hasMarketWideImpact) reasons.add('MARKET_WIDE')
  if (['REGULATOR', 'EXCHANGE', 'COMPANY'].includes(row.sourceType)) {
    reasons.add('AUTHORITATIVE_SOURCE')
  }
  if (row.securityCodes.length > 0) {
    reasons.add('SECURITY_RELEVANCE')
  }

  const effectiveAt = effectiveTime(row)
  const ageHours = Math.max(0, (now.getTime() - effectiveAt.getTime()) / 3_600_000)
  const freshness = freshnessScore(ageHours)
  if (freshness > 0) reasons.add('FRESHNESS')
  const qualityPenalty = Math.min(30, qualityFlags(row.qualityFlags).length * 5)

  return {
    row,
    impactScore: Math.max(0, sourceAuthority + eventSeverity + marketCoverage + freshness - qualityPenalty),
    reasonCodes: [...reasons].sort(),
    effectiveAt,
  }
}

function clusterCandidates(candidates: RankedCandidate[]): ClusteredCandidate[] {
  const ordered = [...candidates].sort(compareRanked)
  const clusters: RankedCandidate[][] = []
  for (const candidate of ordered) {
    const cluster = clusters.find((items) => sameStory(items[0].row.title, candidate.row.title))
    if (cluster) cluster.push(candidate)
    else clusters.push([candidate])
  }

  return clusters
    .map((cluster) => {
      const representative = [...cluster].sort(compareRanked)[0]
      const providers = new Set(cluster.flatMap((candidate) => candidate.row.providerKeys))
      const corroboration = corroborationScore(providers.size)
      return {
        ...representative,
        impactScore: representative.impactScore + corroboration,
        reasonCodes:
          corroboration > 0
            ? [...new Set([...representative.reasonCodes, 'CORROBORATED' as const])].sort()
            : representative.reasonCodes,
        corroboratingSourceCount: providers.size,
        relatedArticleCount: cluster.length - 1,
      }
    })
    .sort(compareRanked)
}

function mapHighlight(candidate: ClusteredCandidate, recent: boolean): NewsHighlightItemDto {
  const row = candidate.row
  return {
    articleId: row.articleId,
    revision: row.revision,
    contentType: row.contentType,
    sourceType: row.sourceType,
    title: row.title,
    excerpt: row.excerpt,
    publisher: row.publisher,
    canonicalUrl: row.canonicalUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedDate: formatPrismaDate(row.publishedDate),
    publishedPrecision: row.publishedPrecision,
    firstSeenAt: row.firstSeenAt.toISOString(),
    securityCodes: row.securityCodes,
    providerKeys: row.providerKeys,
    qualityFlags: qualityFlags(row.qualityFlags),
    impactLevel: recent
      ? 'RECENT'
      : candidate.impactScore >= CRITICAL_THRESHOLD
        ? 'CRITICAL'
        : candidate.impactScore >= MAJOR_THRESHOLD
          ? 'MAJOR'
          : 'RECENT',
    impactScore: candidate.impactScore,
    reasonCodes: candidate.reasonCodes,
    corroboratingSourceCount: Math.max(1, candidate.corroboratingSourceCount),
    relatedArticleCount: candidate.relatedArticleCount,
  }
}

function sourceScore(sourceType: NewsListRepositoryRow['sourceType']): number {
  return { REGULATOR: 25, EXCHANGE: 22, COMPANY: 18, INSTITUTION: 15, MEDIA: 10, AGGREGATOR: 5, OTHER: 0 }[sourceType]
}

function eventSeverityScore(contentType: NewsListRepositoryRow['contentType'], hasBreakingEvent: boolean): number {
  const baseScore = { NOTICE: 18, FLASH: 12, NEWS: 6 }[contentType]
  return Math.min(35, baseScore + (hasBreakingEvent ? 17 : 0))
}

function marketCoverageScore(row: NewsListRepositoryRow, hasMarketWideImpact: boolean): number {
  if (hasMarketWideImpact) return 15
  if (row.securityCodes.length >= 3) return 10
  if (row.securityCodes.length > 0) return 5
  return 0
}

function freshnessScore(ageHours: number): number {
  if (ageHours <= 2) return 10
  if (ageHours <= 6) return 8
  if (ageHours <= 24) return 5
  if (ageHours <= 72) return 2
  return 0
}

function corroborationScore(sourceCount: number): number {
  if (sourceCount >= 3) return 15
  if (sourceCount >= 2) return 10
  return 0
}

function effectiveTime(row: NewsListRepositoryRow): Date {
  if (row.publishedAt) return row.publishedAt
  if (row.publishedDate) return row.publishedDate
  return row.firstSeenAt
}

function newestDataThrough(rows: NewsListRepositoryRow[]): string | null {
  if (rows.length === 0) return null
  return new Date(Math.max(...rows.map((row) => effectiveTime(row).getTime()))).toISOString()
}

function compareRanked(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.impactScore - left.impactScore ||
    right.effectiveAt.getTime() - left.effectiveAt.getTime() ||
    right.row.firstSeenAt.getTime() - left.row.firstSeenAt.getTime() ||
    left.row.articleId.localeCompare(right.row.articleId)
  )
}

function compareRecent(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.effectiveAt.getTime() - left.effectiveAt.getTime() ||
    right.row.firstSeenAt.getTime() - left.row.firstSeenAt.getTime() ||
    left.row.articleId.localeCompare(right.row.articleId)
  )
}

function sameStory(left: string, right: string): boolean {
  const leftTokens = titleTokens(left)
  const rightTokens = titleTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return false
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  const union = new Set([...leftTokens, ...rightTokens]).size
  return intersection / union >= 0.6
}

function titleTokens(title: string): Set<string> {
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
  if (normalized.length < 2) return new Set(normalized ? [normalized] : [])
  return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)))
}

function qualityFlags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function limitResponse(response: NewsHighlightsResponseDto, limit: number): NewsHighlightsResponseDto {
  return { ...response, items: response.items.slice(0, limit) }
}
