import { buildAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { FtsRetrievalService } from '../fts-retrieval.service'
import { HybridRetrievalService, mergeHits } from '../hybrid-retrieval.service'
import { OpenAiCompatibleEmbeddingProvider, sanitizeEmbeddingQuery } from '../openai-compatible-embedding.provider'
import { PgvectorRetrievalService } from '../pgvector-retrieval.service'
import type { RetrievalHit } from '../retrieval.port'

describe('Retrieval services', () => {
  const ftsConfig = buildAgentRetrievalConfig({})

  it('[SEC] FTS SQL 将 tenant/status/delete/expiry 条件写入 memory 和 report 查询本体', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          sourceType: 'REPORT',
          sourceId: 'report_owner',
          content: '现金流稳定，估值较高。',
          citationIds: ['citation_1'],
          metadata: { title: '估值研究' },
          ftsScore: 0.8,
        },
      ]),
    }
    const logger = { devLog: jest.fn() }
    const service = new FtsRetrievalService(prisma as never, logger as never, ftsConfig as never)

    const result = await service.search(
      41,
      '现金流估值',
      { sourceTypes: ['REPORT'], excludeSourceIds: ['report_old'], dataCutoff: '2026-07-20' },
      5,
    )

    const sql = prisma.$queryRaw.mock.calls[0][0]
    const statement = sql.strings.join('?')
    expect(statement).toContain('memory.user_id =')
    expect(statement).toContain('report.user_id =')
    expect(statement).toContain("memory.status = 'CONFIRMED'::ai_memory_status")
    expect(statement).toContain("report.status = 'COMPLETED'::ai_research_report_status")
    expect(statement).toContain('memory.deleted_at IS NULL')
    expect(statement).toContain('report.deleted_at IS NULL')
    expect(statement).toContain('memory.expires_at IS NULL OR memory.expires_at > now()')
    expect(sql.values.filter((value: unknown) => value === 41)).toHaveLength(2)
    expect(result.hits[0]).toEqual(
      expect.objectContaining({
        sourceType: 'REPORT',
        sourceId: 'report_owner',
        citationIds: ['citation_1'],
      }),
    )
    expect(logger.devLog.mock.calls[0][0]).not.toHaveProperty('query')

    await service.search(41, '现金%_流', { sourceTypes: ['REPORT'] }, 1)
    expect(prisma.$queryRaw.mock.calls[1][0].values).toContain('%现金\\%\\_流%')
  })

  it('[SEC] pgvector SQL 在 ANN 排序前固定 tenant/model/source filter', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) }
    const embeddings = {
      embed: jest.fn().mockResolvedValue({
        modelVersion: 'embed-v1',
        dimensions: 3,
        vectors: [[0.1, 0.2, 0.3]],
        inputTokens: 4,
      }),
    }
    const config = hybridConfig(3)
    const service = new PgvectorRetrievalService(prisma as never, embeddings, config as never)

    await service.search(77, '分析持仓: 600519.SH 市值: 100000', { sourceTypes: ['MEMORY'] }, 3)

    const sql = prisma.$queryRaw.mock.calls[0][0]
    const statement = sql.strings.join('?')
    expect(statement).toContain('chunk.user_id =')
    expect(statement).toContain('chunk.embedding_model =')
    expect(statement).toContain('chunk.chunk_version =')
    expect(statement).toContain('chunk.deleted_at IS NULL')
    expect(statement).toContain('chunk.source_type::text IN')
    expect(statement.indexOf('chunk.user_id =')).toBeLessThan(statement.indexOf('ORDER BY chunk.embedding'))
    expect(sql.values).toContain(77)
    expect(embeddings.embed).toHaveBeenCalledWith([expect.not.stringContaining('600519.SH')], 'embed-v1')
  })

  it('[SEC] embedding adapter 不记录 secret，验证顺序和维度，并脱敏持仓正文', async () => {
    const config = hybridConfig(3)
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'embed-v1',
          data: [
            { index: 1, embedding: [0.4, 0.5, 0.6] },
            { index: 0, embedding: [0.1, 0.2, 0.3] },
          ],
          usage: { prompt_tokens: 9 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const provider = new OpenAiCompatibleEmbeddingProvider(config as never, fetchImpl)

    const result = await provider.embed(['第一条', '第二条'], 'embed-v1')

    expect(result.vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
    expect(result.inputTokens).toBe(9)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://embedding.example.com/v1/embeddings')
    expect(sanitizeEmbeddingQuery('持仓: 100000，证券 600519.SH，￥50000', 200)).not.toMatch(/100000|600519\.SH|50000/)
  })

  it('[RES] embedding/pgvector 失败自动退回 FTS，不阻断会话', async () => {
    const ftsResult = {
      requestedMode: 'fts' as const,
      effectiveMode: 'fts' as const,
      fallback: false,
      hits: [hit('REPORT', 'report_1', 0.9, null)],
      latencyMs: 2,
      embeddingInputTokens: null,
    }
    const fts = { search: jest.fn().mockResolvedValue(ftsResult) }
    const vectors = { search: jest.fn().mockRejectedValue(new Error('vector unavailable')) }
    const logger = { warn: jest.fn() }
    const service = new HybridRetrievalService(
      fts as never,
      vectors as never,
      logger as never,
      hybridConfig(3) as never,
    )

    const result = await service.search(1, '查询', {}, 5)

    expect(result.requestedMode).toBe('hybrid')
    expect(result.effectiveMode).toBe('fts')
    expect(result.fallback).toBe(true)
    expect(result.hits).toEqual(ftsResult.hits)
    expect(logger.warn.mock.calls[0][0]).not.toHaveProperty('query')
  })

  it('[SEC] embedding provider 返回其他模型版本时拒绝结果', async () => {
    const config = hybridConfig(3)
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'unexpected-model',
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const provider = new OpenAiCompatibleEmbeddingProvider(config as never, fetchImpl)

    await expect(provider.embed(['查询'], 'embed-v1')).rejects.toThrow('model version')
  })

  it('[BIZ] hybrid 使用固定权重合并 score components，不由模型决定', () => {
    const merged = mergeHits(
      [hit('REPORT', 'same', 2, null), hit('REPORT', 'fts_only', 1, null)],
      [hit('REPORT', 'same', null, 0.8), hit('MEMORY', 'vector_only', null, 0.9)],
      0.35,
      0.65,
      3,
    )

    expect(merged.map((item) => item.sourceId)).toEqual(['same', 'vector_only', 'fts_only'])
    expect(merged[0].scores).toEqual({ fts: 2, vector: 0.8, hybrid: 0.87 })
    expect(merged[1].scores.hybrid).toBeCloseTo(0.585)
  })
})

function hybridConfig(dimensions: number) {
  return buildAgentRetrievalConfig({
    AGENT_RETRIEVAL_MODE: 'hybrid',
    AGENT_RETRIEVAL_EMBEDDING_BASE_URL: 'https://embedding.example.com/v1',
    AGENT_RETRIEVAL_EMBEDDING_API_KEY: 'test-secret',
    AGENT_RETRIEVAL_EMBEDDING_MODEL: 'embed-v1',
    AGENT_RETRIEVAL_EMBEDDING_DIMENSIONS: String(dimensions),
  })
}

function hit(
  sourceType: RetrievalHit['sourceType'],
  sourceId: string,
  fts: number | null,
  vector: number | null,
): RetrievalHit {
  return {
    sourceType,
    sourceId,
    chunkIndex: 0,
    content: sourceId,
    contentHash: `${sourceId}_hash`,
    citationIds: [],
    scores: { fts, vector, hybrid: fts ?? vector ?? 0 },
    metadata: {},
  }
}
