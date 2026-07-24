export const AGENT_EMBEDDING_PROVIDER = Symbol('AGENT_EMBEDDING_PROVIDER')

export interface EmbeddingBatch {
  modelVersion: string
  dimensions: number
  vectors: number[][]
  inputTokens: number | null
}

export interface EmbeddingProvider {
  embed(texts: readonly string[], modelVersion: string): Promise<EmbeddingBatch>
}
