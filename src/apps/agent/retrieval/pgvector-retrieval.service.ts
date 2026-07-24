import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AgentRetrievalConfig, type IAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { PrismaService } from 'src/shared/prisma.service'
import { AGENT_EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding.provider'
import { sanitizeEmbeddingQuery } from './openai-compatible-embedding.provider'
import type {
  RetrievalFilters,
  RetrievalHit,
  RetrievalPort,
  RetrievalSearchResult,
  RetrievalSourceType,
} from './retrieval.port'

interface VectorRow {
  sourceType: RetrievalSourceType
  sourceId: string
  chunkIndex: number
  content: string
  contentHash: string
  citationIds: unknown
  metadata: unknown
  vectorScore: number
}

@Injectable()
export class PgvectorRetrievalService implements RetrievalPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(AgentRetrievalConfig.KEY) private readonly config: IAgentRetrievalConfig,
  ) {}

  async search(
    userId: number,
    query: string,
    filters: RetrievalFilters,
    limit: number,
  ): Promise<RetrievalSearchResult> {
    const startedAt = Date.now()
    const sanitized = sanitizeEmbeddingQuery(query, this.config.embedding.maxInputChars)
    const embedded = await this.embeddings.embed([sanitized], this.config.embedding.model as string)
    const vector = toVectorLiteral(embedded.vectors[0], this.config.embedding.dimensions)
    const sourceTypes = normalizeSourceTypes(filters.sourceTypes)
    const excludeSourceIds = normalizeSourceIds(filters.excludeSourceIds)
    const boundedLimit = Math.min(limit, this.config.maxHits)
    const rows = await this.prisma.$queryRaw<VectorRow[]>(Prisma.sql`
      WITH settings AS (
        SELECT
          set_config('hnsw.ef_search', ${String(this.config.hnswEfSearch)}, true),
          set_config('ivfflat.probes', ${String(this.config.ivfflatProbes)}, true)
      )
      SELECT
        chunk.source_type::text AS "sourceType",
        chunk.source_id::text AS "sourceId",
        chunk.chunk_index AS "chunkIndex",
        chunk.content,
        chunk.content_hash AS "contentHash",
        chunk.citation_ids AS "citationIds",
        chunk.metadata,
        GREATEST(0, LEAST(1, 1 - (chunk.embedding <=> ${vector}::vector)))::float8 AS "vectorScore"
      FROM ai_retrieval_chunks chunk
      CROSS JOIN settings
      WHERE chunk.user_id = ${userId}
        AND chunk.embedding_model = ${embedded.modelVersion}
        AND chunk.chunk_version = ${this.config.chunkVersion}
        AND chunk.deleted_at IS NULL
        AND chunk.source_type::text IN (${Prisma.join(sourceTypes)})
        ${excludeSourceIds.length ? Prisma.sql`AND chunk.source_id NOT IN (${Prisma.join(excludeSourceIds)})` : Prisma.empty}
        ${
          filters.dataCutoff
            ? Prisma.sql`AND (
                NOT (chunk.metadata ? 'dataAsOf')
                OR (chunk.metadata->>'dataAsOf')::date <= ${filters.dataCutoff}::date
              )`
            : Prisma.empty
        }
      ORDER BY chunk.embedding <=> ${vector}::vector, chunk.source_id, chunk.chunk_index
      LIMIT ${boundedLimit}
    `)
    return {
      requestedMode: 'hybrid',
      effectiveMode: 'hybrid',
      fallback: false,
      hits: rows.map(toHit),
      latencyMs: Date.now() - startedAt,
      embeddingInputTokens: embedded.inputTokens,
    }
  }
}

function toHit(row: VectorRow): RetrievalHit {
  const vector = clampScore(row.vectorScore)
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    contentHash: row.contentHash,
    citationIds: stringArray(row.citationIds),
    scores: { fts: null, vector, hybrid: vector },
    metadata: record(row.metadata),
  }
}

function toVectorLiteral(vector: readonly number[], dimensions: number): string {
  if (vector.length !== dimensions || !vector.every(Number.isFinite)) throw new Error('embedding vector 非法')
  return `[${vector.map((value) => Number(value).toString()).join(',')}]`
}

function normalizeSourceTypes(values: readonly RetrievalSourceType[] | undefined): RetrievalSourceType[] {
  const supported = new Set<RetrievalSourceType>(['MEMORY', 'REPORT'])
  const normalized = [...new Set(values?.filter((value) => supported.has(value)) ?? [...supported])]
  if (normalized.length === 0) throw new Error('retrieval sourceTypes 不能为空')
  return normalized
}

function normalizeSourceIds(values: readonly string[] | undefined): string[] {
  const normalized = [...new Set((values ?? []).filter((value) => /^[A-Za-z0-9_-]{1,64}$/.test(value)))]
  if (normalized.length !== (values ?? []).length) throw new Error('retrieval excludeSourceIds 非法')
  return normalized
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function clampScore(value: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0
}
