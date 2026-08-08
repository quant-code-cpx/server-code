import { Inject, Injectable } from '@nestjs/common'
import { NewsIngestionRunStatus, Prisma } from '@prisma/client'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { PrismaService } from 'src/shared/prisma.service'
import { sha256 } from './domain/news-identity'
import { NEWS_CLOCK, type NewsClock, type NewsContentTypeValue, type NewsSourceTypeValue } from './domain/news.types'
import type { NewsCoverageResponseDto, NewsCoverageWarningDto, NewsFeedCoverageDto } from './dto/news-response.dto'
import { NewsHttpException } from './news.errors'
import { NewsProviderRegistry } from './providers/news-provider.registry'

type CoverageFilter = {
  contentTypes?: readonly NewsContentTypeValue[]
  sourceTypes?: readonly NewsSourceTypeValue[]
  feedKeys?: readonly string[]
}

type CoverageWarningCode = NewsCoverageWarningDto['code']
type FeedEvaluation = {
  feed: NewsFeedCoverageDto
  warnings: Array<{ code: CoverageWarningCode; observedAt: string }>
}

@Injectable()
export class NewsCoverageService {
  private readonly transientWarningSince = new Map<string, string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NewsProviderRegistry,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
    @Inject(NEWS_CLOCK) private readonly clock: NewsClock,
  ) {}

  async getCoverage(filter?: CoverageFilter): Promise<NewsCoverageResponseDto> {
    this.assertEnabled()
    const now = this.clock.now()
    const capabilities = this.registry.relevantCapabilities(filter)
    const evaluations = await Promise.all(capabilities.map((capability) => this.feedCoverage(capability, now)))
    const feeds = evaluations.map((evaluation) => evaluation.feed)
    const warnings = evaluations.flatMap(warningForFeed)
    const requiredFeeds = feeds.filter((feed) => feed.requiredForCompleteness)
    const coverageUnknownHealth = await this.prisma.newsFeedHealth.findUnique({
      where: { providerKey_feedKey: { providerKey: 'NEWS', feedKey: 'ALL' } },
    })
    const coverageUnknownObservedAt = this.resolveWarningSince(
      'NEWS',
      'ALL',
      requiredFeeds.length === 0 ? ['COVERAGE_UNKNOWN'] : [],
      coverageUnknownHealth?.warningSince,
      now,
    ).get('COVERAGE_UNKNOWN')
    if (requiredFeeds.length === 0) {
      warnings.push({
        warningId: sha256('COVERAGE_UNKNOWN:NEWS:ALL').slice(0, 24),
        code: 'COVERAGE_UNKNOWN',
        severity: 'WARNING',
        affectsCompleteness: true,
        providerKey: null,
        providerDisplayName: null,
        feedKey: null,
        feedDisplayName: null,
        publicMessage: '当前筛选没有可证明完整性的新闻源',
        dataThrough: null,
        observedAt: coverageUnknownObservedAt!,
      })
    }
    const affectsCompleteness = warnings.some((warning) => warning.affectsCompleteness)
    const anyEnabled = feeds.some((feed) => feed.status !== 'DISABLED')
    const overallStatus: NewsCoverageResponseDto['overallStatus'] = !anyEnabled
      ? 'DISABLED'
      : requiredFeeds.some((feed) => feed.status !== 'READY') || affectsCompleteness
        ? 'DEGRADED'
        : 'READY'
    const readyRequiredWatermarks = requiredFeeds
      .filter((feed) => feed.status !== 'DISABLED' && feed.dataThrough)
      .map((feed) => Date.parse(feed.dataThrough!))
    const dataThrough =
      requiredFeeds.length > 0 && readyRequiredWatermarks.length === requiredFeeds.length
        ? new Date(Math.min(...readyRequiredWatermarks)).toISOString()
        : null

    return {
      generatedAt: now.toISOString(),
      overallStatus,
      dataThrough,
      partial: affectsCompleteness,
      warnings: warnings.sort(compareWarnings).slice(0, 50),
      feeds,
    }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw NewsHttpException.fromKey('NEWS_MODULE_DISABLED')
  }

  private async feedCoverage(
    capability: ReturnType<NewsProviderRegistry['allCapabilities']>[number],
    now: Date,
  ): Promise<FeedEvaluation> {
    const health = await this.prisma.newsFeedHealth.findUnique({
      where: { providerKey_feedKey: { providerKey: capability.providerKey, feedKey: capability.feedKey } },
    })
    const lastSuccessfulAt = health?.lastSuccessfulAt ?? null
    const dataThrough = health?.dataThrough ?? null
    const freshnessSeconds =
      capability.scheduleMode === 'SCHEDULED' && lastSuccessfulAt
        ? Math.max(0, Math.floor((now.getTime() - lastSuccessfulAt.getTime()) / 1_000))
        : null
    const consecutiveFailures = health?.consecutiveFailures ?? 0
    const stale =
      capability.scheduleMode === 'SCHEDULED' &&
      capability.expectedIntervalSeconds != null &&
      freshnessSeconds != null &&
      freshnessSeconds > capability.expectedIntervalSeconds * this.config.freshnessGraceMultiplier

    const warningCodes: CoverageWarningCode[] = []
    if (!capability.enabled) {
      warningCodes.push('FEED_DISABLED')
    } else {
      if (
        health?.circuitState === 'OPEN' ||
        health?.circuitState === 'HALF_OPEN' ||
        consecutiveFailures >= 3 ||
        health?.lastPublicErrorCode === 'UPSTREAM_SCHEMA_CHANGED'
      ) {
        warningCodes.push(
          health?.lastPublicErrorCode === 'UPSTREAM_SCHEMA_CHANGED' ? 'FEED_SCHEMA_CHANGED' : 'FEED_UNAVAILABLE',
        )
      }
      if (stale) warningCodes.push('FEED_STALE')
      if (capability.scheduleMode === 'SCHEDULED' && !lastSuccessfulAt) {
        warningCodes.push('NO_SUCCESSFUL_SYNC')
      }
      if (health?.potentiallyTruncated) warningCodes.push('POTENTIALLY_TRUNCATED')
      if (health?.lastRunStatus === NewsIngestionRunStatus.PARTIAL) warningCodes.push('PARTIAL_INGESTION')
    }

    const status: NewsFeedCoverageDto['status'] = !capability.enabled
      ? 'DISABLED'
      : warningCodes.length
        ? 'DEGRADED'
        : 'READY'
    const reasonCode = warningCodes[0] ?? null
    const publicReason = reasonCode ? publicMessageForWarning(reasonCode) : null
    const observedAtByCode = this.resolveWarningSince(
      capability.providerKey,
      capability.feedKey,
      warningCodes,
      health?.warningSince,
      now,
    )
    return {
      feed: {
        providerKey: capability.providerKey,
        providerDisplayName: capability.providerDisplayName,
        feedKey: capability.feedKey,
        feedDisplayName: capability.feedDisplayName,
        sourceType: capability.sourceType,
        contentTypes: [...capability.contentTypes],
        scheduleMode: capability.scheduleMode,
        requiredForCompleteness: capability.requiredForCompleteness,
        status,
        lastSuccessfulAt: lastSuccessfulAt?.toISOString() ?? null,
        dataThrough: dataThrough?.toISOString() ?? null,
        expectedIntervalSeconds: capability.expectedIntervalSeconds,
        freshnessSeconds,
        consecutiveFailures,
        potentiallyTruncated: health?.potentiallyTruncated ?? false,
        reasonCode,
        publicReason,
      },
      warnings: warningCodes.map((code) => ({ code, observedAt: observedAtByCode.get(code)! })),
    }
  }

  private resolveWarningSince(
    providerKey: string,
    feedKey: string,
    reasonCodes: readonly CoverageWarningCode[],
    raw: Prisma.JsonValue | undefined,
    now: Date,
  ): Map<CoverageWarningCode, string> {
    const prefix = `${providerKey}:${feedKey}:`
    const activeCodes = new Set(reasonCodes)
    for (const transientKey of this.transientWarningSince.keys()) {
      if (!transientKey.startsWith(prefix)) continue
      const code = transientKey.slice(prefix.length) as CoverageWarningCode
      if (!activeCodes.has(code)) this.transientWarningSince.delete(transientKey)
    }

    const current = jsonRecord(raw)
    const resolved = new Map<CoverageWarningCode, string>()
    for (const reasonCode of reasonCodes) {
      const key = `${prefix}${reasonCode}`
      const persisted = typeof current[reasonCode] === 'string' ? current[reasonCode] : null
      const observedAt = persisted ?? this.transientWarningSince.get(key) ?? now.toISOString()
      this.transientWarningSince.set(key, observedAt)
      resolved.set(reasonCode, observedAt)
    }
    return resolved
  }
}

function warningForFeed(evaluation: FeedEvaluation): NewsCoverageWarningDto[] {
  const { feed } = evaluation
  const affectsCompleteness = feed.requiredForCompleteness
  return evaluation.warnings.map(({ code, observedAt }) => ({
    warningId: sha256(`${code}:${feed.providerKey}:${feed.feedKey}`).slice(0, 24),
    code,
    severity: code === 'FEED_DISABLED' ? 'INFO' : code === 'FEED_UNAVAILABLE' ? 'ERROR' : 'WARNING',
    affectsCompleteness,
    providerKey: feed.providerKey,
    providerDisplayName: feed.providerDisplayName,
    feedKey: feed.feedKey,
    feedDisplayName: feed.feedDisplayName,
    publicMessage: publicMessageForWarning(code),
    dataThrough: feed.dataThrough,
    observedAt,
  }))
}

function publicMessageForWarning(code: CoverageWarningCode): string {
  const messages: Record<CoverageWarningCode, string> = {
    FEED_UNAVAILABLE: '新闻源当前不可用',
    FEED_STALE: '新闻源数据已过期',
    FEED_DISABLED: '该新闻源未启用',
    NO_SUCCESSFUL_SYNC: '新闻源尚未完成首次同步',
    FEED_SCHEMA_CHANGED: '新闻源响应结构已变化',
    POTENTIALLY_TRUNCATED: '新闻源本次返回可能被截断',
    PARTIAL_INGESTION: '部分新闻未能成功入库',
    SOURCE_WINDOW_LIMITED: '新闻源可观测窗口有限',
    COVERAGE_UNKNOWN: '当前无法确认新闻覆盖完整性',
  }
  return messages[code]
}

function jsonRecord(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function compareWarnings(left: NewsCoverageWarningDto, right: NewsCoverageWarningDto): number {
  const severity = { ERROR: 0, WARNING: 1, INFO: 2 }
  return (
    severity[left.severity] - severity[right.severity] ||
    (left.providerKey ?? '').localeCompare(right.providerKey ?? '') ||
    (left.feedKey ?? '').localeCompare(right.feedKey ?? '') ||
    left.code.localeCompare(right.code)
  )
}
