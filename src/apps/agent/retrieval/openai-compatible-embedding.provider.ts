import { Inject, Injectable, Optional } from '@nestjs/common'
import { AgentRetrievalConfig, type IAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import type { EmbeddingBatch, EmbeddingProvider } from './embedding.provider'

interface EmbeddingResponse {
  model?: string
  data?: Array<{ index?: number; embedding?: unknown }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

@Injectable()
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    @Inject(AgentRetrievalConfig.KEY) private readonly config: IAgentRetrievalConfig,
    @Optional() private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async embed(texts: readonly string[], modelVersion: string): Promise<EmbeddingBatch> {
    const embedding = this.config.embedding
    if (!embedding.baseUrl || !embedding.apiKey || !embedding.model) {
      throw new Error('embedding provider 未配置')
    }
    if (modelVersion !== embedding.model) throw new Error('embedding model version 不匹配')
    if (texts.length < 1 || texts.length > embedding.batchSize) throw new Error('embedding batch 大小非法')
    const normalized = texts.map((text) => normalizeInput(text, embedding.maxInputChars))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), embedding.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(`${embedding.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${embedding.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: embedding.model,
          input: normalized,
          dimensions: embedding.dimensions,
          encoding_format: 'float',
        }),
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('embedding provider 超时')
      const reason = error instanceof Error ? error.name : typeof error
      throw new Error(`embedding provider 网络不可用（${reason}）`)
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new Error(`embedding provider HTTP ${response.status}`)
    }
    const body = (await response.json()) as EmbeddingResponse
    if (body.model !== embedding.model) throw new Error('embedding provider 返回 model version 不匹配')
    const vectors = parseVectors(body, normalized.length, embedding.dimensions)
    return {
      modelVersion: embedding.model,
      dimensions: embedding.dimensions,
      vectors,
      inputTokens: readInputTokens(body.usage),
    }
  }
}

export function sanitizeEmbeddingQuery(value: string, maxChars: number): string {
  return normalizeInput(value, maxChars)
    .replace(/\b\d{6}\.(?:SH|SZ|BJ|HK)\b/gi, '[证券代码]')
    .replace(/(持仓|仓位|买入|卖出|成本|市值)\s*[:：]?\s*[-+]?\d+(?:\.\d+)?%?/gi, '$1 [已脱敏]')
    .replace(/(?:¥|￥|RMB|CNY)\s*[-+]?\d+(?:[,.]\d+)?/gi, '[金额]')
    .replace(/\b\d{8,19}\b/g, '[长数字]')
}

function normalizeInput(value: string, maxChars: number): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!normalized) throw new Error('embedding 输入不能为空')
  return normalized.slice(0, maxChars)
}

function parseVectors(body: EmbeddingResponse, expectedCount: number, dimensions: number): number[][] {
  if (!Array.isArray(body.data) || body.data.length !== expectedCount) {
    throw new Error('embedding provider 返回数量错误')
  }
  const indexed = body.data
    .map((item, position) => ({
      index: Number.isInteger(item.index) ? (item.index as number) : position,
      embedding: item.embedding,
    }))
    .sort((left, right) => left.index - right.index)
  return indexed.map((item, index) => {
    if (item.index !== index || !Array.isArray(item.embedding) || item.embedding.length !== dimensions) {
      throw new Error('embedding provider 返回维度或索引错误')
    }
    const vector = item.embedding.map(Number)
    if (!vector.every(Number.isFinite)) throw new Error('embedding provider 返回非有限数')
    return vector
  })
}

function readInputTokens(usage: EmbeddingResponse['usage']): number | null {
  const value = usage?.prompt_tokens ?? usage?.total_tokens
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null
}
