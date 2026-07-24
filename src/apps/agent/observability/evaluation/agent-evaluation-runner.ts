import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computePerformanceMetrics,
  type PerformanceMetricKey,
  type PerformanceMetricsInput,
} from '../../quant/performance-metrics'
import {
  computeValuationPercentile,
  type ValuationPercentilePolicy,
  type ValuationPoint,
} from '../../quant/valuation-percentile'

interface FinancialGoldenFile {
  performanceCases: Array<{
    id: string
    input: PerformanceMetricsInput
    expectedMetrics: Partial<Record<PerformanceMetricKey, number | null>>
  }>
  valuationCases: Array<{
    id: string
    series: ValuationPoint[]
    policy: ValuationPercentilePolicy
    expected: { currentValue: number; percentile: number; sampleCount: number; dataDate: string; median: number }
  }>
  errorCases: Array<
    | { id: string; kind: 'performance'; input: PerformanceMetricsInput; errorIncludes: string }
    | {
        id: string
        kind: 'valuation'
        series: ValuationPoint[]
        policy: ValuationPercentilePolicy
        errorIncludes: string
      }
  >
}

interface RequiredFact {
  key: string
  value: string | number | boolean | null
}

interface RegressionArtifact {
  facts: RequiredFact[]
  claims: string[]
  toolTrace: string[]
  citationTypes: string[]
  cost: number
  latencyMs: number
}

interface RegressionCase {
  id: string
  prompt: string
  requiredFacts: RequiredFact[]
  forbiddenClaims: string[]
  requiredTools: string[]
  requiredCitationTypes: string[]
  maxCost: number
  artifact: RegressionArtifact
}

interface EvaluationDatasetManifest {
  schemaVersion: 1
  id: string
  version: string
  workflowVersion: string
  promptVersion: string
  modelVersion: string
  provider: 'fake'
  financialFixture: string
  modelFixture: string
  thresholds: {
    minFactScore: number
    minCitationCoverage: number
    requireToolTraceMatch: boolean
    maxLatencyMs: number
    maxTotalCost: number
  }
}

export interface AgentEvaluationDataset {
  id: string
  version: string
  hash: string
  workflowVersion: string
  promptVersion: string
  modelVersion: string
  provider: 'fake'
}

export interface AgentEvaluationCaseResult {
  id: string
  caseHash: string
  pass: boolean
  factScore: number
  citationCoverage: number
  toolTraceMatch: boolean
  latencyMs: number
  cost: number
  failures: string[]
}

export interface AgentRegressionSummary {
  suite: string
  provider: string
  dataset: AgentEvaluationDataset
  financial: { passed: number; total: number; failures: string[] }
  model: { passed: number; total: number; results: AgentEvaluationCaseResult[] }
  gate: { pass: boolean; failures: string[] }
  pass: boolean
}

export interface EvaluateAgentRegressionOptions {
  provider?: string
  suite?: string
  dataset?: string
}

export function describeAgentEvaluationDataset(root = process.cwd(), dataset = 'mvp'): AgentEvaluationDataset {
  return loadDataset(root, dataset).dataset
}

export function evaluateAgentRegression(
  root = process.cwd(),
  options: EvaluateAgentRegressionOptions = {},
): AgentRegressionSummary {
  const loaded = loadDataset(root, options.dataset ?? options.suite ?? 'mvp')
  const provider = options.provider ?? loaded.manifest.provider
  if (provider !== loaded.manifest.provider) {
    throw new Error(`评测数据集 ${loaded.dataset.id} 仅支持 provider=${loaded.manifest.provider}`)
  }
  const financialFailures = evaluateFinancial(loaded.financial)
  const modelResults = loaded.modelCases.map(evaluateModelCase)
  const financialTotal =
    loaded.financial.performanceCases.length +
    loaded.financial.valuationCases.length +
    loaded.financial.errorCases.length
  const gateFailures = evaluateGate(loaded.manifest, financialFailures, modelResults)
  const pass =
    financialFailures.length === 0 && modelResults.every((result) => result.pass) && gateFailures.length === 0
  return {
    suite: options.suite ?? loaded.dataset.id,
    provider,
    dataset: loaded.dataset,
    financial: {
      passed: financialTotal - financialFailures.length,
      total: financialTotal,
      failures: financialFailures,
    },
    model: {
      passed: modelResults.filter((result) => result.pass).length,
      total: modelResults.length,
      results: modelResults,
    },
    gate: { pass: gateFailures.length === 0, failures: gateFailures },
    pass,
  }
}

function loadDataset(
  root: string,
  datasetId: string,
): {
  manifest: EvaluationDatasetManifest
  dataset: AgentEvaluationDataset
  financial: FinancialGoldenFile
  modelCases: RegressionCase[]
} {
  if (!/^[a-z0-9-]{1,64}$/.test(datasetId)) throw new Error('评测数据集名称非法')
  const manifestPath = resolve(root, 'test/agent/evaluation-datasets', `${datasetId}.json`)
  const manifestText = readFile(manifestPath)
  const manifest = parseManifest(manifestText, manifestPath)
  if (manifest.id !== datasetId) throw new Error(`评测数据集文件与 id 不匹配：${datasetId}`)
  const financialText = readFile(resolve(root, manifest.financialFixture))
  const modelText = readFile(resolve(root, manifest.modelFixture))
  const hash = sha256(`${manifestText}\u0000${financialText}\u0000${modelText}`)
  return {
    manifest,
    dataset: {
      id: manifest.id,
      version: manifest.version,
      hash,
      workflowVersion: manifest.workflowVersion,
      promptVersion: manifest.promptVersion,
      modelVersion: manifest.modelVersion,
      provider: manifest.provider,
    },
    financial: parseJson<FinancialGoldenFile>(financialText, manifest.financialFixture),
    modelCases: parseJsonLines<RegressionCase>(modelText, manifest.modelFixture),
  }
}

function parseManifest(text: string, path: string): EvaluationDatasetManifest {
  const value = parseJson<unknown>(text, path)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`评测数据集 manifest 非法：${path}`)
  const manifest = value as Partial<EvaluationDatasetManifest>
  if (manifest.schemaVersion !== 1 || manifest.provider !== 'fake')
    throw new Error(`评测数据集 manifest 版本或 provider 非法：${path}`)
  const textFields: Array<keyof EvaluationDatasetManifest> = [
    'id',
    'version',
    'workflowVersion',
    'promptVersion',
    'modelVersion',
    'financialFixture',
    'modelFixture',
  ]
  for (const key of textFields) {
    if (typeof manifest[key] !== 'string' || !manifest[key]?.trim()) throw new Error(`评测数据集 manifest.${key} 非法`)
  }
  const thresholds = manifest.thresholds
  if (!thresholds || typeof thresholds !== 'object') throw new Error('评测数据集阈值缺失')
  for (const key of ['minFactScore', 'minCitationCoverage', 'maxLatencyMs', 'maxTotalCost'] as const) {
    if (!Number.isFinite(thresholds[key]) || thresholds[key] < 0) throw new Error(`评测数据集阈值 ${key} 非法`)
  }
  if (typeof thresholds.requireToolTraceMatch !== 'boolean')
    throw new Error('评测数据集阈值 requireToolTraceMatch 非法')
  return manifest as EvaluationDatasetManifest
}

function evaluateFinancial(file: FinancialGoldenFile): string[] {
  const failures: string[] = []
  for (const testCase of file.performanceCases) {
    const result = computePerformanceMetrics(testCase.input)
    const actual = Object.fromEntries(result.metrics.map((metric) => [metric.key, metric.value]))
    for (const [key, expected] of Object.entries(testCase.expectedMetrics)) {
      if (!equalNumber(actual[key], expected))
        failures.push(`${testCase.id}:${key} expected=${expected} actual=${actual[key]}`)
    }
  }
  for (const testCase of file.valuationCases) {
    const result = computeValuationPercentile(testCase.series, testCase.policy)
    const checks: Array<[string, unknown, unknown]> = [
      ['currentValue', result.currentValue, testCase.expected.currentValue],
      ['percentile', result.percentile, testCase.expected.percentile],
      ['sampleCount', result.sampleCount, testCase.expected.sampleCount],
      ['dataDate', result.dataDate, testCase.expected.dataDate],
      ['median', result.statistics.median, testCase.expected.median],
    ]
    for (const [key, actual, expected] of checks) {
      if (!equalValue(actual, expected)) failures.push(`${testCase.id}:${key} expected=${expected} actual=${actual}`)
    }
  }
  for (const testCase of file.errorCases) {
    try {
      if (testCase.kind === 'performance') computePerformanceMetrics(testCase.input)
      else computeValuationPercentile(testCase.series, testCase.policy)
      failures.push(`${testCase.id}: expected error containing ${testCase.errorIncludes}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes(testCase.errorIncludes)) failures.push(`${testCase.id}: wrong error ${message}`)
    }
  }
  return failures
}

function evaluateModelCase(testCase: RegressionCase): AgentEvaluationCaseResult {
  const failures: string[] = []
  const facts = new Map(testCase.artifact.facts.map((fact) => [fact.key, fact.value]))
  const matchedFacts = testCase.requiredFacts.filter((fact) => equalValue(facts.get(fact.key), fact.value)).length
  const factScore = testCase.requiredFacts.length === 0 ? 1 : matchedFacts / testCase.requiredFacts.length
  for (const claim of testCase.forbiddenClaims) {
    if (testCase.artifact.claims.includes(claim)) failures.push(`forbidden claim: ${claim}`)
  }
  const missingTools = testCase.requiredTools.filter((tool) => !testCase.artifact.toolTrace.includes(tool))
  if (missingTools.length) failures.push(`missing tools: ${missingTools.join(',')}`)
  const matchedCitationTypes = testCase.requiredCitationTypes.filter((type) =>
    testCase.artifact.citationTypes.includes(type),
  ).length
  const citationCoverage =
    testCase.requiredCitationTypes.length === 0 ? 1 : matchedCitationTypes / testCase.requiredCitationTypes.length
  if (testCase.artifact.cost > testCase.maxCost) failures.push(`cost ${testCase.artifact.cost} > ${testCase.maxCost}`)
  if (factScore < 1) failures.push(`fact score ${factScore.toFixed(3)} < 1`)
  if (citationCoverage < 1) failures.push(`citation coverage ${citationCoverage.toFixed(3)} < 1`)
  return {
    id: testCase.id,
    caseHash: sha256(JSON.stringify(testCase)),
    pass: failures.length === 0,
    factScore,
    citationCoverage,
    toolTraceMatch: missingTools.length === 0,
    latencyMs: testCase.artifact.latencyMs,
    cost: testCase.artifact.cost,
    failures,
  }
}

function evaluateGate(
  manifest: EvaluationDatasetManifest,
  financialFailures: readonly string[],
  results: readonly AgentEvaluationCaseResult[],
): string[] {
  const failures: string[] = []
  if (financialFailures.length) failures.push(`financial fixture failures: ${financialFailures.length}`)
  const totalCost = results.reduce((sum, result) => sum + result.cost, 0)
  if (totalCost > manifest.thresholds.maxTotalCost) {
    failures.push(`total cost ${totalCost} > ${manifest.thresholds.maxTotalCost}`)
  }
  for (const result of results) {
    if (result.factScore < manifest.thresholds.minFactScore) failures.push(`${result.id}: fact score below gate`)
    if (result.citationCoverage < manifest.thresholds.minCitationCoverage)
      failures.push(`${result.id}: citation coverage below gate`)
    if (manifest.thresholds.requireToolTraceMatch && !result.toolTraceMatch)
      failures.push(`${result.id}: tool trace mismatch`)
    if (result.latencyMs > manifest.thresholds.maxLatencyMs)
      failures.push(`${result.id}: latency ${result.latencyMs} exceeds gate`)
  }
  return failures
}

function equalValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') return equalNumber(actual, expected)
  return actual === expected
}

function equalNumber(actual: unknown, expected: unknown): boolean {
  if (actual === null || expected === null) return actual === expected
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  return Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected))
}

function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new Error(`评测数据集文件不可读取：${path}`)
  }
}

function parseJson<T>(text: string, path: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`评测数据集 JSON 非法：${path}`)
  }
}

function parseJsonLines<T>(text: string, path: string): T[] {
  try {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  } catch {
    throw new Error(`评测数据集 JSONL 非法：${path}`)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
