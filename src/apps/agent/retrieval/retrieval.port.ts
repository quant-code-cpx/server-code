export const AGENT_RETRIEVAL = Symbol('AGENT_RETRIEVAL')

export type RetrievalMode = 'fts' | 'hybrid'
export type RetrievalSourceType = 'MEMORY' | 'REPORT'

export interface RetrievalFilters {
  sourceTypes?: readonly RetrievalSourceType[]
  excludeSourceIds?: readonly string[]
  dataCutoff?: string | null
}

export interface RetrievalScores {
  fts: number | null
  vector: number | null
  hybrid: number
}

export interface RetrievalHit {
  sourceType: RetrievalSourceType
  sourceId: string
  chunkIndex: number
  content: string
  contentHash: string
  citationIds: string[]
  scores: RetrievalScores
  metadata: Record<string, unknown>
}

export interface RetrievalSearchResult {
  requestedMode: RetrievalMode
  effectiveMode: RetrievalMode
  fallback: boolean
  hits: RetrievalHit[]
  latencyMs: number
  embeddingInputTokens: number | null
}

export interface RetrievalPort {
  search(userId: number, query: string, filters: RetrievalFilters, limit: number): Promise<RetrievalSearchResult>
}
