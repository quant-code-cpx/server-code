import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lexicalTerms } from './retrieval-chunker'

interface RetrievalEvaluationSource {
  id: string
  sourceType: 'MEMORY' | 'REPORT'
  text: string
  semanticTags: string[]
}

interface RetrievalEvaluationQuery {
  id: string
  text: string
  relevantSourceIds: string[]
  semanticTags: string[]
}

interface RetrievalEvaluationDataset {
  schemaVersion: 1
  id: string
  version: string
  anonymousSynthetic: boolean
  structuredMarketExcluded: boolean
  semanticFixtureVersion: string
  semanticModelApproved: boolean
  pgvectorInfraBenchmarked: boolean
  sources: RetrievalEvaluationSource[]
  queries: RetrievalEvaluationQuery[]
  thresholds: {
    k: number
    minRecallGain: number
    minMrrGain: number
    maxP95LatencyMs: number
  }
}

export interface RetrievalStrategyMetrics {
  recallAtK: number
  mrr: number
  p95LatencyMs: number
}

export interface RetrievalPilotSummary {
  suite: 'retrieval'
  dataset: { id: string; version: string; hash: string; sourceCount: number; queryCount: number }
  strategies: {
    fts: RetrievalStrategyMetrics
    semanticFixture: RetrievalStrategyMetrics
    hybrid: RetrievalStrategyMetrics
  }
  qualityGate: {
    pass: boolean
    recallGain: number
    mrrGain: number
    failures: string[]
  }
  safetyGate: { pass: boolean; failures: string[] }
  operationalGate: { pass: boolean; failures: string[] }
  decision: 'go' | 'no-go'
  valid: boolean
}

export function evaluateRetrievalPilot(root = process.cwd(), datasetId = 'retrieval-v1'): RetrievalPilotSummary {
  if (!/^[a-z0-9-]{1,64}$/.test(datasetId)) throw new Error('检索评测数据集名称非法')
  const path = resolve(root, 'test/agent/retrieval-datasets', `${datasetId}.json`)
  const text = readFileSync(path, 'utf8')
  const dataset = parseDataset(text, path, datasetId)
  const fts = evaluateStrategy(dataset, 'fts')
  const semanticFixture = evaluateStrategy(dataset, 'semantic')
  const hybrid = evaluateStrategy(dataset, 'hybrid')
  const recallGain = hybrid.recallAtK - fts.recallAtK
  const mrrGain = hybrid.mrr - fts.mrr
  const qualityFailures: string[] = []
  if (recallGain < dataset.thresholds.minRecallGain) {
    qualityFailures.push(`Recall@${dataset.thresholds.k} gain ${format(recallGain)} below gate`)
  }
  if (mrrGain < dataset.thresholds.minMrrGain) qualityFailures.push(`MRR gain ${format(mrrGain)} below gate`)
  if (hybrid.p95LatencyMs > dataset.thresholds.maxP95LatencyMs) {
    qualityFailures.push(`hybrid p95 ${format(hybrid.p95LatencyMs)}ms above gate`)
  }
  const safetyFailures: string[] = []
  if (!dataset.anonymousSynthetic) safetyFailures.push('dataset is not anonymous/synthetic')
  if (!dataset.structuredMarketExcluded) safetyFailures.push('structured market data was not excluded')
  const operationalFailures: string[] = []
  if (!dataset.semanticModelApproved) operationalFailures.push('real embedding model/version not approved or measured')
  if (!dataset.pgvectorInfraBenchmarked) {
    operationalFailures.push('41GB clone index/WAL/backup/restore benchmark not completed')
  }
  const qualityGate = { pass: qualityFailures.length === 0, recallGain, mrrGain, failures: qualityFailures }
  const safetyGate = { pass: safetyFailures.length === 0, failures: safetyFailures }
  const operationalGate = { pass: operationalFailures.length === 0, failures: operationalFailures }
  return {
    suite: 'retrieval',
    dataset: {
      id: dataset.id,
      version: dataset.version,
      hash: sha256(text),
      sourceCount: dataset.sources.length,
      queryCount: dataset.queries.length,
    },
    strategies: { fts, semanticFixture, hybrid },
    qualityGate,
    safetyGate,
    operationalGate,
    decision: qualityGate.pass && safetyGate.pass && operationalGate.pass ? 'go' : 'no-go',
    valid: true,
  }
}

function evaluateStrategy(
  dataset: RetrievalEvaluationDataset,
  strategy: 'fts' | 'semantic' | 'hybrid',
): RetrievalStrategyMetrics {
  const reciprocalRanks: number[] = []
  const recalls: number[] = []
  const latencies: number[] = []
  for (const query of dataset.queries) {
    const startedAt = performance.now()
    const ranked = dataset.sources
      .map((source) => {
        const fts = lexicalScore(query.text, source.text)
        const semantic = tagScore(query.semanticTags, source.semanticTags)
        const score =
          strategy === 'fts' ? fts : strategy === 'semantic' ? semantic : 0.35 * normalizeFts(fts) + 0.65 * semantic
        return { id: source.id, score }
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    latencies.push(performance.now() - startedAt)
    const top = ranked.slice(0, dataset.thresholds.k)
    const relevant = new Set(query.relevantSourceIds)
    recalls.push(top.filter((item) => relevant.has(item.id)).length / relevant.size)
    const firstRelevant = ranked.findIndex((item) => relevant.has(item.id))
    reciprocalRanks.push(firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1))
  }
  return {
    recallAtK: mean(recalls),
    mrr: mean(reciprocalRanks),
    p95LatencyMs: percentile(latencies, 0.95),
  }
}

function lexicalScore(query: string, content: string): number {
  const queryTerms = lexicalTerms(query)
  const contentTerms = new Set(lexicalTerms(content))
  return queryTerms.reduce((score, term) => score + (contentTerms.has(term) ? 1 : 0), 0)
}

function tagScore(queryTags: readonly string[], sourceTags: readonly string[]): number {
  const source = new Set(sourceTags)
  return queryTags.length === 0 ? 0 : queryTags.filter((tag) => source.has(tag)).length / queryTags.length
}

function normalizeFts(value: number): number {
  return value <= 0 ? 0 : value / (value + 1)
}

function parseDataset(text: string, path: string, expectedId: string): RetrievalEvaluationDataset {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`检索评测数据集 JSON 非法：${path}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('检索评测数据集必须是 object')
  const dataset = value as RetrievalEvaluationDataset
  if (dataset.schemaVersion !== 1 || dataset.id !== expectedId) throw new Error('检索评测数据集版本或 id 非法')
  if (!Array.isArray(dataset.sources) || dataset.sources.length < 5) throw new Error('检索评测 source 不足')
  if (!Array.isArray(dataset.queries) || dataset.queries.length < 5) throw new Error('检索评测 query 不足')
  const sourceIds = new Set(dataset.sources.map((source) => source.id))
  if (sourceIds.size !== dataset.sources.length) throw new Error('检索评测 source id 重复')
  for (const query of dataset.queries) {
    if (!query.relevantSourceIds.length || query.relevantSourceIds.some((id) => !sourceIds.has(id))) {
      throw new Error(`检索评测 query gold set 非法：${query.id}`)
    }
  }
  if (
    !Number.isInteger(dataset.thresholds?.k) ||
    dataset.thresholds.k < 1 ||
    !Number.isFinite(dataset.thresholds.minRecallGain) ||
    !Number.isFinite(dataset.thresholds.minMrrGain) ||
    !Number.isFinite(dataset.thresholds.maxP95LatencyMs)
  ) {
    throw new Error('检索评测门禁非法')
  }
  return dataset
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function format(value: number): string {
  return value.toFixed(4)
}
