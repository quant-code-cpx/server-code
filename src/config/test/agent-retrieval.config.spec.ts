import { buildAgentRetrievalConfig } from '../agent-retrieval.config'

describe('AgentRetrievalConfig', () => {
  it('[BIZ] 默认只启用 FTS，不要求 embedding secret', () => {
    const config = buildAgentRetrievalConfig({})

    expect(config.mode).toBe('fts')
    expect(config.ftsWeight + config.vectorWeight).toBe(1)
    expect(config.embedding.apiKey).toBeNull()
  })

  it('[SEC] hybrid 必须显式固定 endpoint、key、model 和维度', () => {
    expect(() => buildAgentRetrievalConfig({ AGENT_RETRIEVAL_MODE: 'hybrid' })).toThrow(
      'AGENT_RETRIEVAL_EMBEDDING_BASE_URL',
    )
  })

  it('[SEC] 生产 hybrid 只接受 HTTPS allowlist endpoint', () => {
    const env = {
      AGENT_RETRIEVAL_MODE: 'hybrid',
      AGENT_RETRIEVAL_EMBEDDING_BASE_URL: 'https://embedding.example.com/v1',
      AGENT_RETRIEVAL_EMBEDDING_API_KEY: 'test-only',
      AGENT_RETRIEVAL_EMBEDDING_MODEL: 'approved-model-v1',
      AGENT_RETRIEVAL_EMBEDDING_DIMENSIONS: '768',
    }

    expect(() => buildAgentRetrievalConfig(env, 'production')).toThrow('allowlist')
    expect(
      buildAgentRetrievalConfig(
        { ...env, AGENT_RETRIEVAL_EMBEDDING_BASE_URL_ALLOWLIST: 'https://embedding.example.com' },
        'production',
      ).embedding.baseUrl,
    ).toBe('https://embedding.example.com/v1')
  })

  it.each([
    { AGENT_RETRIEVAL_MODE: 'vector' },
    { AGENT_RETRIEVAL_FTS_WEIGHT: '0.8', AGENT_RETRIEVAL_VECTOR_WEIGHT: '0.8' },
    { AGENT_RETRIEVAL_CHUNK_CHARS: '300', AGENT_RETRIEVAL_CHUNK_OVERLAP_CHARS: '300' },
  ])('[ERR] 拒绝非法配置 %#', (env) => {
    expect(() => buildAgentRetrievalConfig(env)).toThrow()
  })
})
