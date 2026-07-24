import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AgentRetrievalConfig, type IAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { FtsRetrievalService } from './fts-retrieval.service'
import { PgvectorRetrievalService } from './pgvector-retrieval.service'
import type { RetrievalFilters, RetrievalHit, RetrievalPort, RetrievalSearchResult } from './retrieval.port'

@Injectable()
export class HybridRetrievalService implements RetrievalPort {
  constructor(
    private readonly fts: FtsRetrievalService,
    private readonly vectors: PgvectorRetrievalService,
    private readonly logger: LoggerService,
    @Inject(AgentRetrievalConfig.KEY) private readonly config: IAgentRetrievalConfig,
  ) {}

  async search(
    userId: number,
    query: string,
    filters: RetrievalFilters,
    limit: number,
  ): Promise<RetrievalSearchResult> {
    const startedAt = Date.now()
    const [ftsResult, vectorResult] = await Promise.allSettled([
      this.fts.search(userId, query, filters, Math.max(limit, this.config.ftsCandidates)),
      this.vectors.search(userId, query, filters, Math.max(limit, this.config.maxHits)),
    ])
    if (ftsResult.status === 'rejected') throw ftsResult.reason
    if (vectorResult.status === 'rejected') {
      this.logger.warn(
        {
          message: 'Agent hybrid retrieval fallback to FTS',
          queryHash: sha256(query),
          errorType: errorType(vectorResult.reason),
        },
        HybridRetrievalService.name,
      )
      return {
        ...ftsResult.value,
        requestedMode: 'hybrid',
        fallback: true,
        latencyMs: Date.now() - startedAt,
      }
    }
    return {
      requestedMode: 'hybrid',
      effectiveMode: 'hybrid',
      fallback: false,
      hits: mergeHits(
        ftsResult.value.hits,
        vectorResult.value.hits,
        this.config.ftsWeight,
        this.config.vectorWeight,
        Math.min(limit, this.config.maxHits),
      ),
      latencyMs: Date.now() - startedAt,
      embeddingInputTokens: vectorResult.value.embeddingInputTokens,
    }
  }
}

export function mergeHits(
  ftsHits: readonly RetrievalHit[],
  vectorHits: readonly RetrievalHit[],
  ftsWeight: number,
  vectorWeight: number,
  limit: number,
): RetrievalHit[] {
  const merged = new Map<string, RetrievalHit>()
  const maxFts = Math.max(0, ...ftsHits.map((hit) => hit.scores.fts ?? 0))
  for (const hit of [...ftsHits, ...vectorHits]) {
    const key = `${hit.sourceType}:${hit.sourceId}:${hit.chunkIndex}:${hit.contentHash}`
    const current = merged.get(key)
    merged.set(key, current ? combine(current, hit) : cloneHit(hit))
  }
  return [...merged.values()]
    .map((hit) => {
      const normalizedFts = maxFts > 0 ? (hit.scores.fts ?? 0) / maxFts : 0
      const vector = hit.scores.vector ?? 0
      return {
        ...hit,
        scores: {
          fts: hit.scores.fts,
          vector: hit.scores.vector,
          hybrid: ftsWeight * normalizedFts + vectorWeight * vector,
        },
      }
    })
    .sort(
      (left, right) =>
        right.scores.hybrid - left.scores.hybrid ||
        left.sourceType.localeCompare(right.sourceType) ||
        left.sourceId.localeCompare(right.sourceId) ||
        left.chunkIndex - right.chunkIndex,
    )
    .slice(0, limit)
}

function combine(left: RetrievalHit, right: RetrievalHit): RetrievalHit {
  return {
    ...left,
    citationIds: [...new Set([...left.citationIds, ...right.citationIds])],
    scores: {
      fts: left.scores.fts ?? right.scores.fts,
      vector: left.scores.vector ?? right.scores.vector,
      hybrid: 0,
    },
    metadata: { ...right.metadata, ...left.metadata },
  }
}

function cloneHit(hit: RetrievalHit): RetrievalHit {
  return {
    ...hit,
    citationIds: [...hit.citationIds],
    scores: { ...hit.scores },
    metadata: { ...hit.metadata },
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorType(value: unknown): string {
  return value instanceof Error ? value.constructor.name : typeof value
}
