import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_RETRIEVAL_CONFIG_TOKEN = 'agentRetrieval'

export type AgentRetrievalMode = 'fts' | 'hybrid'

export interface AgentRetrievalConfigEnvironment {
  AGENT_RETRIEVAL_MODE?: string
  AGENT_RETRIEVAL_MAX_HITS?: string
  AGENT_RETRIEVAL_FTS_CANDIDATES?: string
  AGENT_RETRIEVAL_FTS_WEIGHT?: string
  AGENT_RETRIEVAL_VECTOR_WEIGHT?: string
  AGENT_RETRIEVAL_CHUNK_CHARS?: string
  AGENT_RETRIEVAL_CHUNK_OVERLAP_CHARS?: string
  AGENT_RETRIEVAL_EMBEDDING_BASE_URL?: string
  AGENT_RETRIEVAL_EMBEDDING_BASE_URL_ALLOWLIST?: string
  AGENT_RETRIEVAL_EMBEDDING_API_KEY?: string
  AGENT_RETRIEVAL_EMBEDDING_MODEL?: string
  AGENT_RETRIEVAL_EMBEDDING_DIMENSIONS?: string
  AGENT_RETRIEVAL_EMBEDDING_BATCH_SIZE?: string
  AGENT_RETRIEVAL_EMBEDDING_TIMEOUT_MS?: string
  AGENT_RETRIEVAL_EMBEDDING_MAX_INPUT_CHARS?: string
  AGENT_RETRIEVAL_HNSW_EF_SEARCH?: string
  AGENT_RETRIEVAL_IVFFLAT_PROBES?: string
}

export function buildAgentRetrievalConfig(env: AgentRetrievalConfigEnvironment, nodeEnv = 'development') {
  const mode = parseMode(env.AGENT_RETRIEVAL_MODE)
  const ftsWeight = parseNumber(env.AGENT_RETRIEVAL_FTS_WEIGHT, 'AGENT_RETRIEVAL_FTS_WEIGHT', 0.35, 0, 1)
  const vectorWeight = parseNumber(env.AGENT_RETRIEVAL_VECTOR_WEIGHT, 'AGENT_RETRIEVAL_VECTOR_WEIGHT', 0.65, 0, 1)
  if (Math.abs(ftsWeight + vectorWeight - 1) > 1e-9) {
    throw new Error('[AgentRetrieval] FTS 与 vector 权重之和必须为 1')
  }

  const chunkChars = parseInteger(env.AGENT_RETRIEVAL_CHUNK_CHARS, 'AGENT_RETRIEVAL_CHUNK_CHARS', 1_200, 256, 8_000)
  const chunkOverlapChars = parseInteger(
    env.AGENT_RETRIEVAL_CHUNK_OVERLAP_CHARS,
    'AGENT_RETRIEVAL_CHUNK_OVERLAP_CHARS',
    160,
    0,
    2_000,
  )
  if (chunkOverlapChars >= chunkChars) {
    throw new Error('[AgentRetrieval] chunk overlap 必须小于 chunk 长度')
  }

  const embedding = {
    baseUrl: parseEmbeddingBaseUrl(
      env.AGENT_RETRIEVAL_EMBEDDING_BASE_URL,
      env.AGENT_RETRIEVAL_EMBEDDING_BASE_URL_ALLOWLIST,
      mode,
      nodeEnv === 'production',
    ),
    apiKey: requiredForHybrid(env.AGENT_RETRIEVAL_EMBEDDING_API_KEY, 'AGENT_RETRIEVAL_EMBEDDING_API_KEY', mode),
    model: requiredForHybrid(env.AGENT_RETRIEVAL_EMBEDDING_MODEL, 'AGENT_RETRIEVAL_EMBEDDING_MODEL', mode),
    dimensions: parseInteger(
      env.AGENT_RETRIEVAL_EMBEDDING_DIMENSIONS,
      'AGENT_RETRIEVAL_EMBEDDING_DIMENSIONS',
      mode === 'hybrid' ? null : 1_536,
      1,
      16_384,
    ),
    batchSize: parseInteger(
      env.AGENT_RETRIEVAL_EMBEDDING_BATCH_SIZE,
      'AGENT_RETRIEVAL_EMBEDDING_BATCH_SIZE',
      32,
      1,
      256,
    ),
    timeoutMs: parseInteger(
      env.AGENT_RETRIEVAL_EMBEDDING_TIMEOUT_MS,
      'AGENT_RETRIEVAL_EMBEDDING_TIMEOUT_MS',
      15_000,
      100,
      120_000,
    ),
    maxInputChars: parseInteger(
      env.AGENT_RETRIEVAL_EMBEDDING_MAX_INPUT_CHARS,
      'AGENT_RETRIEVAL_EMBEDDING_MAX_INPUT_CHARS',
      2_000,
      128,
      20_000,
    ),
  }

  return {
    mode,
    maxHits: parseInteger(env.AGENT_RETRIEVAL_MAX_HITS, 'AGENT_RETRIEVAL_MAX_HITS', 5, 1, 20),
    ftsCandidates: parseInteger(env.AGENT_RETRIEVAL_FTS_CANDIDATES, 'AGENT_RETRIEVAL_FTS_CANDIDATES', 50, 5, 500),
    ftsWeight,
    vectorWeight,
    chunkVersion: 'retrieval-chunk-v1',
    chunkChars,
    chunkOverlapChars,
    hnswEfSearch: parseInteger(env.AGENT_RETRIEVAL_HNSW_EF_SEARCH, 'AGENT_RETRIEVAL_HNSW_EF_SEARCH', 80, 1, 1_000),
    ivfflatProbes: parseInteger(env.AGENT_RETRIEVAL_IVFFLAT_PROBES, 'AGENT_RETRIEVAL_IVFFLAT_PROBES', 10, 1, 1_000),
    embedding,
  }
}

export const AgentRetrievalConfig = registerAs(AGENT_RETRIEVAL_CONFIG_TOKEN, () =>
  buildAgentRetrievalConfig(process.env, process.env.NODE_ENV),
)

export type IAgentRetrievalConfig = ConfigType<typeof AgentRetrievalConfig>

function parseMode(raw: string | undefined): AgentRetrievalMode {
  const value = raw?.trim().toLowerCase() || 'fts'
  if (value !== 'fts' && value !== 'hybrid') {
    throw new Error('[AgentRetrieval] AGENT_RETRIEVAL_MODE 仅支持 fts 或 hybrid')
  }
  return value
}

function parseEmbeddingBaseUrl(
  raw: string | undefined,
  allowlistRaw: string | undefined,
  mode: AgentRetrievalMode,
  production: boolean,
): string | null {
  const value = requiredForHybrid(raw, 'AGENT_RETRIEVAL_EMBEDDING_BASE_URL', mode)
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('[AgentRetrieval] embedding base URL 非法')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('[AgentRetrieval] embedding base URL 禁止 userinfo、query 和 fragment')
  }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production && loopback.has(url.hostname))) {
    throw new Error('[AgentRetrieval] embedding HTTP endpoint 仅允许非生产 loopback')
  }
  if (production) {
    const allowlist = parseOrigins(allowlistRaw)
    if (!allowlist.includes(url.origin)) {
      throw new Error('[AgentRetrieval] 生产 embedding endpoint 必须命中 allowlist')
    }
  }
  return url.toString().replace(/\/$/, '')
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    return [...new Set(raw.split(',').map((item) => new URL(item.trim()).origin))]
  } catch {
    throw new Error('[AgentRetrieval] embedding allowlist 包含非法 origin')
  }
}

function requiredForHybrid(value: string | undefined, name: string, mode: AgentRetrievalMode): string | null {
  const normalized = value?.trim() || null
  if (mode === 'hybrid' && !normalized) throw new Error(`[AgentRetrieval] hybrid 模式必须配置 ${name}`)
  return normalized
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) {
    if (fallback == null) throw new Error(`[AgentRetrieval] ${name} 必填`)
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentRetrieval] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}

function parseNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentRetrieval] ${name} 必须介于 ${minimum}-${maximum}`)
  }
  return value
}
