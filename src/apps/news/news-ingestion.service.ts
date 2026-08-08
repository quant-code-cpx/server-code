import { Inject, Injectable, Logger } from '@nestjs/common'
import { NewsIngestionRunStatus } from '@prisma/client'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { computeNewsContentHash, sha256, stableJson } from './domain/news-identity'
import { normalizeNewsItem, sortQualityFlags } from './domain/news-normalizer'
import { NEWS_CLOCK, type NewsClock, type ProviderNewsItem } from './domain/news.types'
import { NewsCircuitBreakerService } from './news-circuit-breaker.service'
import {
  newsIngestionPublicErrorMessage,
  NewsRepository,
  type PreparedNewsItem,
  type QuarantinedNewsItem,
} from './news.repository'
import { NewsProviderError } from './providers/news-provider.errors'
import { NewsProviderRegistry } from './providers/news-provider.registry'
import { decideNewsRunClaim, newsRunClaimRetryAfterMs } from './nonfunctional/news-run-recovery-policy'

const TERMINAL = new Set<NewsIngestionRunStatus>([
  NewsIngestionRunStatus.SUCCEEDED,
  NewsIngestionRunStatus.PARTIAL,
  NewsIngestionRunStatus.CANCELLED,
])
const RUN_STALE_AFTER_MS = 90_000

@Injectable()
export class NewsIngestionService {
  private readonly logger = new Logger(NewsIngestionService.name)

  constructor(
    private readonly repository: NewsRepository,
    private readonly registry: NewsProviderRegistry,
    private readonly circuit: NewsCircuitBreakerService,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
    @Inject(NEWS_CLOCK) private readonly clock: NewsClock,
  ) {}

  async executeRun(runId: string, signal = new AbortController().signal): Promise<void> {
    const run = await this.repository.getRun(runId)
    if (!run) throw new NewsProviderError('INVALID_ARGUMENT', false, 'News ingestion run 不存在')
    if (TERMINAL.has(run.status)) return
    const now = this.clock.now()
    const claimDecision = decideNewsRunClaim({
      status: run.status,
      startedAt: run.startedAt,
      now,
      staleAfterMs: RUN_STALE_AFTER_MS,
    })
    const claimed = await this.repository.markRunRunning(run.id, now, RUN_STALE_AFTER_MS)
    if (!claimed) {
      if (claimDecision === 'WAIT') {
        throw new NewsProviderError(
          'UPSTREAM_UNAVAILABLE',
          true,
          'News ingestion run 等待过期重领',
          newsRunClaimRetryAfterMs({ startedAt: run.startedAt!, now, staleAfterMs: RUN_STALE_AFTER_MS }),
        )
      }
      return
    }

    try {
      await this.repository.refreshCommandStatus(run.commandId)
      const capability = this.registry.getCapability(run.providerKey, run.feedKey)
      const provider = this.registry.getProvider(run.providerKey, run.feedKey)
      const cursor = await this.repository.ensureCursor(run.providerKey, run.feedKey, run.partitionKey)
      await this.circuit.acquire(run.providerKey, run.feedKey)
      const requestSpec = jsonObject(run.command?.requestSpec)
      const batch = await provider.fetch(
        {
          feedKey: run.feedKey,
          partitionKey: run.partitionKey,
          providerCursor: jsonObject(cursor.providerCursor),
          securityCodes: run.operation === 'BACKFILL_SECURITY_NOTICES' ? [run.partitionKey] : undefined,
          windowStart: requestSpec.beginDate ? localDate(requestSpec.beginDate, false) : undefined,
          windowEnd: requestSpec.endDate ? localDate(requestSpec.endDate, true) : undefined,
        },
        signal,
      )
      if (
        batch.schemaVersion !== 1 ||
        batch.providerKey !== run.providerKey ||
        batch.feedKey !== run.feedKey ||
        batch.partitionKey !== run.partitionKey
      ) {
        throw new NewsProviderError('UPSTREAM_SCHEMA_CHANGED', false, 'Provider batch 与运行契约不一致')
      }

      const items: PreparedNewsItem[] = []
      const quarantined: QuarantinedNewsItem[] = [...(batch.rejectedItems ?? [])]
      for (let index = 0; index < batch.items.length; index += 1) {
        const item = batch.items[index]
        try {
          const normalized = normalizeNewsItem({
            providerKey: run.providerKey,
            feedKey: run.feedKey,
            sourceType: capability.sourceType,
            item,
            retrievedAt: batch.retrievedAt,
            maxChars: this.config.excerptMaxChars,
          })
          const security = await this.repository.resolveSecurityHints(normalized.securityHints)
          const qualityFlags = sortQualityFlags([
            ...normalized.qualityFlags,
            ...(security.unresolved.length ? ['UNRESOLVED_SECURITY'] : []),
          ])
          items.push({
            ...normalized,
            qualityFlags,
            contentHash: computeNewsContentHash({ ...normalized, qualityFlags }),
            resolvedSecurityCodes: security.resolved,
          })
        } catch (error) {
          quarantined.push(toQuarantine(item, index, error))
        }
      }
      await this.repository.commitBatch({
        runId: run.id,
        cursorId: cursor.id,
        cursorVersion: cursor.version,
        dataThroughBefore: cursor.watermarkAt,
        batch,
        capability,
        items,
        quarantined,
      })
      try {
        await this.circuit.recordSuccess(run.providerKey, run.feedKey)
      } catch (error) {
        this.logger.warn(
          `News circuit success update failed after run commit: runId=${run.id}, provider=${run.providerKey}, feed=${run.feedKey}, error=${errorMessage(error)}`,
        )
      }
      try {
        await this.repository.refreshCommandStatus(run.commandId)
      } catch (error) {
        this.logger.warn(
          `News command projection refresh failed after run commit: runId=${run.id}, commandId=${run.commandId ?? 'none'}, error=${errorMessage(error)}`,
        )
      }
    } catch (error) {
      const providerError = asProviderError(error)
      await this.repository.markRunFailed({
        runId: run.id,
        providerKey: run.providerKey,
        feedKey: run.feedKey,
        partitionKey: run.partitionKey,
        errorCode: providerError.code,
        errorMessage: newsIngestionPublicErrorMessage(providerError.code)!,
      })
      await this.circuit.recordFailure(
        run.providerKey,
        run.feedKey,
        providerError.code === 'UPSTREAM_SCHEMA_CHANGED' || providerError.code === 'INVALID_ARGUMENT',
      )
      await this.repository.refreshCommandStatus(run.commandId)
      throw providerError
    }
  }

  async cleanup(): Promise<{ metadataCleared: number; quarantineDeleted: number; runsDeleted: number }> {
    return this.repository.cleanup(this.clock.now(), {
      metadataDays: this.config.metadataRetentionDays,
      runDays: this.config.ingestionRunRetentionDays,
      quarantineDays: this.config.quarantineRetentionDays,
    })
  }
}

function toQuarantine(item: ProviderNewsItem, index: number, error: unknown): QuarantinedNewsItem {
  const message = error instanceof Error ? error.message : String(error)
  return {
    itemKeyHash: sha256(`${item.upstreamId || index}:${item.rawPayloadHash || ''}`),
    rawPayloadHash: /^[a-f0-9]{64}$/.test(item.rawPayloadHash) ? item.rawPayloadHash : sha256(stableJson(item)),
    errorCode: error instanceof NewsProviderError ? error.code : 'ITEM_NORMALIZATION_FAILED',
    errorMessage: message,
    fieldManifest: {
      index,
      fields: Object.keys(item).sort(),
      titleLength: typeof item.title === 'string' ? Array.from(item.title).length : null,
      hasCanonicalUrl: Boolean(item.canonicalUrl),
    },
    retryable: error instanceof NewsProviderError && error.retryable,
  }
}

function asProviderError(error: unknown): NewsProviderError {
  if (error instanceof NewsProviderError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new NewsProviderError('INTERNAL_ERROR', true, message.slice(0, 500))
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200)
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function localDate(value: unknown, endOfDay: boolean): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`)
}
