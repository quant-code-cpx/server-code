import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AgentRetrievalConfig, type IAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { chunkRetrievalSource, selectBestLexicalChunk } from './retrieval-chunker'
import type {
  RetrievalFilters,
  RetrievalHit,
  RetrievalPort,
  RetrievalSearchResult,
  RetrievalSourceType,
} from './retrieval.port'

interface FtsRow {
  sourceType: RetrievalSourceType
  sourceId: string
  content: string
  citationIds: string[]
  metadata: Record<string, unknown>
  ftsScore: number
}

@Injectable()
export class FtsRetrievalService implements RetrievalPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    @Inject(AgentRetrievalConfig.KEY) private readonly config: IAgentRetrievalConfig,
  ) {}

  async search(
    userId: number,
    query: string,
    filters: RetrievalFilters,
    limit: number,
  ): Promise<RetrievalSearchResult> {
    requireSearchInput(userId, query, limit)
    const startedAt = Date.now()
    const sourceTypes = normalizeSourceTypes(filters.sourceTypes)
    const excludeSourceIds = normalizeSourceIds(filters.excludeSourceIds)
    const boundedLimit = Math.min(limit, this.config.maxHits)
    const normalizedQuery = query.normalize('NFKC').trim()
    const substringPattern = `%${escapeLikePattern(normalizedQuery)}%`
    const candidates = await this.prisma.$queryRaw<FtsRow[]>(Prisma.sql`
      WITH sources AS (
        SELECT
          'MEMORY'::text AS "sourceType",
          memory.id::text AS "sourceId",
          concat_ws(' ', memory.category::text, memory.key, memory.value::text) AS content,
          ARRAY_REMOVE(ARRAY[memory.source_message_id::text], NULL)::text[] AS "citationIds",
          jsonb_build_object(
            'category', memory.category::text,
            'sensitivity', memory.sensitivity::text,
            'version', memory.version,
            'validFrom', memory.valid_from
          ) AS metadata,
          memory.updated_at AS "sortAt",
          NULL::date AS "dataAsOf"
        FROM ai_user_memories memory
        WHERE memory.user_id = ${userId}
          AND memory.status = 'CONFIRMED'::ai_memory_status
          AND memory.deleted_at IS NULL
          AND (memory.expires_at IS NULL OR memory.expires_at > now())
        UNION ALL
        SELECT
          'REPORT'::text AS "sourceType",
          report.id::text AS "sourceId",
          concat_ws(' ', report.title, report.summary, report.content_text) AS content,
          COALESCE(
            ARRAY(
              SELECT citation->>'citationId'
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(report.citation_manifest) = 'array' THEN report.citation_manifest
                  ELSE '[]'::jsonb
                END
              ) citation
              WHERE citation ? 'citationId'
            ),
            ARRAY[]::text[]
          ) AS "citationIds",
          jsonb_build_object(
            'title', report.title,
            'version', report.version,
            'dataAsOf', report.data_as_of,
            'runId', report.run_id,
            'messageId', report.message_id
          ) AS metadata,
          report.updated_at AS "sortAt",
          report.data_as_of AS "dataAsOf"
        FROM ai_research_reports report
        WHERE report.user_id = ${userId}
          AND report.status = 'COMPLETED'::ai_research_report_status
          AND report.deleted_at IS NULL
      ),
      search_query AS (
        SELECT websearch_to_tsquery('simple', ${normalizedQuery}) AS value
      )
      SELECT
        source."sourceType",
        source."sourceId",
        source.content,
        source."citationIds",
        source.metadata,
        (
          ts_rank_cd(to_tsvector('simple', source.content), search_query.value, 32)
          + CASE WHEN source.content ILIKE ${substringPattern} ESCAPE '\' THEN 1 ELSE 0 END
        )::float8 AS "ftsScore"
      FROM sources source
      CROSS JOIN search_query
      WHERE source."sourceType" IN (${Prisma.join(sourceTypes)})
        ${excludeSourceIds.length ? Prisma.sql`AND source."sourceId" NOT IN (${Prisma.join(excludeSourceIds)})` : Prisma.empty}
        ${
          filters.dataCutoff
            ? Prisma.sql`AND (source."dataAsOf" IS NULL OR source."dataAsOf" <= ${filters.dataCutoff}::date)`
            : Prisma.empty
        }
        AND (
          (numnode(search_query.value) > 0 AND to_tsvector('simple', source.content) @@ search_query.value)
          OR source.content ILIKE ${substringPattern} ESCAPE '\'
        )
      ORDER BY "ftsScore" DESC, source."sortAt" DESC, source."sourceId" ASC
      LIMIT ${Math.max(boundedLimit, this.config.ftsCandidates)}
    `)
    const hits = candidates
      .map((row) => this.toHit(row, query))
      .filter((hit): hit is RetrievalHit => hit !== null)
      .slice(0, boundedLimit)
    const latencyMs = Date.now() - startedAt
    this.logger.devLog(
      {
        message: 'Agent FTS retrieval completed',
        mode: 'fts',
        queryHash: sha256(query),
        resultCount: hits.length,
        latencyMs,
      },
      FtsRetrievalService.name,
    )
    return {
      requestedMode: 'fts',
      effectiveMode: 'fts',
      fallback: false,
      hits,
      latencyMs,
      embeddingInputTokens: null,
    }
  }

  private toHit(row: FtsRow, query: string): RetrievalHit | null {
    const chunks = chunkRetrievalSource({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      content: row.content,
      version: this.config.chunkVersion,
      maxChars: this.config.chunkChars,
      overlapChars: this.config.chunkOverlapChars,
    })
    const chunk = selectBestLexicalChunk(chunks, query)
    if (!chunk) return null
    const fts = finiteScore(row.ftsScore)
    return {
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentHash: chunk.contentHash,
      citationIds: [...new Set((row.citationIds ?? []).filter(Boolean))],
      scores: { fts, vector: null, hybrid: fts },
      metadata: row.metadata ?? {},
    }
  }
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

function requireSearchInput(userId: number, query: string, limit: number): void {
  if (!Number.isInteger(userId) || userId < 1) throw new Error('retrieval userId 非法')
  if (!query.trim() || query.length > 20_000) throw new Error('retrieval query 非法')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('retrieval limit 非法')
}

function finiteScore(value: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
