import { Injectable } from '@nestjs/common'
import {
  DATA_AVAILABILITY_CATALOG,
  type DataAvailabilityDataset,
} from 'src/apps/data-availability/data-availability.catalog'
import { TOOL_ERROR_AGENT_CODE, ToolExecutionError } from '../tools/contracts/tool-error'
import type { ToolResult } from '../tools/contracts/tool-result'
import { ToolExecutorService } from '../tools/tool-executor.service'
import { stableJson } from '../tools/tool-json'
import { ToolRegistryError, ToolRegistryService } from '../tools/tool-registry.service'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import type {
  CompiledResearchPlan,
  FactPacket,
  LoadedWorkflowContext,
  WorkflowBudgetLimits,
  WorkflowBudgetUsage,
} from './workflow.types'
import { WorkflowBudgetService } from './workflow-budget.service'
import { WorkflowCancelledError, WorkflowExecutionError, WorkflowValidationError } from './workflow.errors'
import {
  resolveToolInputBindings,
  ToolResultBindingEmptyCollectionError,
  ToolResultBindingUnavailableError,
} from './tool-result-binding'

export interface AuthorizedToolPlan {
  plan: CompiledResearchPlan
  snapshotSignature: string
  allowedTools: CompiledResearchPlan['toolPins'][number]['key'][]
}

export interface WorkflowToolExecutionResult {
  facts: FactPacket[]
  warnings: string[]
  usage: WorkflowBudgetUsage
}

@Injectable()
export class WorkflowToolService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly executor: ToolExecutorService,
    private readonly budgets: WorkflowBudgetService,
  ) {}

  authorize(plan: CompiledResearchPlan): AuthorizedToolPlan {
    try {
      const snapshot = this.registry.freezeSnapshot(plan.toolPins)
      for (const pin of snapshot.entries) {
        const definition = this.registry.get(pin.key, pin.version)
        const safeRead = definition.policy.sideEffect === 'READ' && definition.policy.idempotent
        const reportPreviewProposal =
          definition.key === 'save_research_report' &&
          definition.policy.sideEffect === 'WRITE' &&
          definition.policy.requiresConfirmation &&
          definition.policy.idempotent
        if (!safeRead && !reportPreviewProposal) {
          throw new WorkflowValidationError(`工作流仅允许幂等 READ Tool 或受控报告预览提案：${pin.key}`)
        }
      }
      return {
        plan,
        snapshotSignature: snapshot.signature,
        allowedTools: snapshot.entries.map((pin) => pin.key),
      }
    } catch (error) {
      if (error instanceof ToolRegistryError) {
        throw new WorkflowExecutionError('TOOL', 6008, false, error.message)
      }
      throw error
    }
  }

  async execute(command: {
    run: AgentExecutionRun
    stepId: string
    authorized: AuthorizedToolPlan
    context: LoadedWorkflowContext
    usage: WorkflowBudgetUsage
    limits: WorkflowBudgetLimits
    workerId?: string
    signal?: AbortSignal
  }): Promise<WorkflowToolExecutionResult> {
    this.budgets.assertCanPlanToolCalls(command.usage, command.authorized.plan.toolCalls.length, command.limits)
    const callsById = new Map(command.authorized.plan.toolCalls.map((call) => [call.id, call]))
    const invocationIndex = new Map(command.authorized.plan.toolCalls.map((call, index) => [call.id, index]))
    const facts: FactPacket[] = []
    const warnings: string[] = []
    const resultsByCallId = new Map<string, ToolResult>()
    let attempted = 0

    for (const level of command.authorized.plan.executionLevels) {
      const outcomes = await mapLimit(level, command.limits.maxParallelTools, async (id) => {
        if (command.signal?.aborted) throw new WorkflowCancelledError()
        const call = callsById.get(id)
        if (!call) throw new WorkflowValidationError(`已编译 Tool 调用不存在：${id}`)
        let input: Record<string, unknown>
        try {
          input = resolveToolInputBindings(call.input, call.dependsOn, resultsByCallId)
        } catch (error) {
          if (error instanceof ToolResultBindingEmptyCollectionError) return { call, skipped: error }
          if (!call.optional || !(error instanceof ToolResultBindingUnavailableError)) throw error
          return { call, skipped: error }
        }
        input = normalizePlannedToolInput(call.toolKey, input)
        const callNumber = attempted
        attempted += 1
        try {
          const result = await this.executor.execute(
            {
              toolKey: call.toolKey,
              toolVersion: call.toolVersion,
              logicalNodeKey: 'execute_tools',
              invocationIndex: invocationIndex.get(id) ?? callNumber,
              input,
            },
            {
              userId: command.context.userId,
              role: command.context.role,
              userStatus: command.context.userStatus,
              scopeId: command.run.id,
              conversationId: command.context.conversationId,
              runId: command.run.id,
              stepId: command.stepId,
              traceId: command.run.traceId,
              workerId: command.workerId,
              workflowAllowedTools: command.authorized.allowedTools,
              allowedScopes: command.context.allowedScopes,
              callsUsed: command.usage.toolCalls + callNumber,
              deadlineAt: command.run.deadlineAt,
              parentSignal: command.signal,
              maxConcurrentCalls: command.limits.maxParallelTools,
            },
          )
          return { call, result }
        } catch (error) {
          if (error instanceof ToolExecutionError && error.result.code === 'CANCELLED') {
            throw new WorkflowCancelledError()
          }
          if (!call.optional) throw normalizeToolError(error)
          return { call, error }
        }
      })

      for (const outcome of outcomes) {
        if ('result' in outcome) {
          resultsByCallId.set(outcome.call.id, outcome.result)
          facts.push(toFactPacket(outcome.call.id, outcome.result))
          warnings.push(...outcome.result.warnings.map((warning) => warning.message))
        } else if ('skipped' in outcome) {
          warnings.push(
            `${outcome.call.optional ? '可选 Tool' : 'Tool'} ${outcome.call.toolKey} 已跳过：${bindingErrorMessage(outcome.skipped)}`,
          )
        } else {
          warnings.push(`可选 Tool ${outcome.call.toolKey} 失败：${safeErrorMessage(outcome.error)}`)
        }
      }
    }

    const usage = { ...command.usage, toolCalls: command.usage.toolCalls + attempted }
    this.budgets.assertUsage(usage, command.limits)
    return { facts, warnings, usage }
  }
}

function toFactPacket(planCallId: string, result: ToolResult): FactPacket {
  return {
    factId: `fact_${planCallId}`,
    toolCallId: result.toolCallId,
    toolKey: result.toolKey,
    title: toolPublicTitle(result.toolKey),
    sourceType: result.provenance.sourceType,
    sourceIds: [...result.citationSourceIds],
    summary: summarizeFactData(result.data),
    retrievedAt: result.provenance.asOf.retrievedAt,
    asOf: Object.fromEntries(
      Object.entries(result.provenance.asOf).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    timezone: result.provenance.timezone,
    warnings: result.warnings.map((warning) => warning.message),
  }
}

const FACT_SUMMARY_MAX_CHARS = 8_000
const FACT_SUMMARY_GAP = '\n…[内容已截断，已保留首尾事实]…\n'
const FACT_NUMERIC_DIGEST_MAX_CHARS = 2_400

export function summarizeFactData(data: unknown): string {
  const serialized = stableJson(data)
  if (serialized.length <= FACT_SUMMARY_MAX_CHARS) return serialized
  const numericDigest = buildNumericSeriesDigest(data)
  const digestSection = numericDigest ? `\n[结构化数值摘要V2]\n${numericDigest}\n` : ''
  const retainedChars = FACT_SUMMARY_MAX_CHARS - FACT_SUMMARY_GAP.length - digestSection.length
  const headLength = Math.ceil(retainedChars / 2)
  const tailLength = retainedChars - headLength
  return `${serialized.slice(0, headLength)}${FACT_SUMMARY_GAP}${serialized.slice(-tailLength)}${digestSection}`
}

interface NumericSeriesPoint {
  value: number
  label?: string
}

interface NumericSeriesDigest {
  path: string
  count: number
  first: number
  last: number
  min: number
  max: number
  sum: number
  mean: number
  change: number
  changePct?: number
  distanceFromMin: number
  distanceFromMax: number
  rangePositionPct?: number
  minAt?: string
  maxAt?: string
}

/**
 * 长时间序列被首尾裁剪时，为每个数值路径保留可重算的确定性摘要。
 * 这不是模型生成摘要；它仅保留原始数列的首尾、极值和聚合值，供模型与引用校验共用。
 */
function buildNumericSeriesDigest(data: unknown): string {
  const groups = new Map<string, NumericSeriesPoint[]>()
  collectNumericSeries(data, '$', groups, { visited: 0 })
  const series = [...groups.entries()]
    .filter(([, points]) => points.length >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, points]) => digestNumericSeries(path, points))

  if (series.length === 0) return ''
  while (series.length > 0) {
    const serialized = stableJson({ series, version: 2 })
    if (serialized.length <= FACT_NUMERIC_DIGEST_MAX_CHARS) return serialized
    series.pop()
  }
  return ''
}

function collectNumericSeries(
  value: unknown,
  path: string,
  groups: Map<string, NumericSeriesPoint[]>,
  budget: { visited: number },
  label?: string,
): void {
  budget.visited += 1
  if (budget.visited > 20_000) return
  if (typeof value === 'number' && Number.isFinite(value)) {
    const points = groups.get(path) ?? []
    if (points.length < 1_000) points.push({ value, label })
    groups.set(path, points)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumericSeries(item, `${path}[]`, groups, budget, label)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const pointLabel = findPointLabel(record) ?? label
  for (const [key, item] of Object.entries(record)) {
    collectNumericSeries(item, `${path}.${key}`, groups, budget, pointLabel)
  }
}

function findPointLabel(record: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && /(?:date|time|asOf|period)$/i.test(key) && value.length <= 40) return value
  }
  return undefined
}

function digestNumericSeries(path: string, points: readonly NumericSeriesPoint[]): NumericSeriesDigest {
  let minIndex = 0
  let maxIndex = 0
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    sum += points[index].value
    if (points[index].value < points[minIndex].value) minIndex = index
    if (points[index].value > points[maxIndex].value) maxIndex = index
  }
  const first = points[0].value
  const last = points.at(-1)!.value
  const digest: NumericSeriesDigest = {
    path,
    count: points.length,
    first: compactNumber(first),
    last: compactNumber(last),
    min: compactNumber(points[minIndex].value),
    max: compactNumber(points[maxIndex].value),
    sum: compactNumber(sum),
    mean: compactNumber(sum / points.length),
    change: compactNumber(last - first),
    distanceFromMin: compactNumber(last - points[minIndex].value),
    distanceFromMax: compactNumber(last - points[maxIndex].value),
  }
  if (first !== 0) digest.changePct = compactNumber((last / first - 1) * 100)
  if (points[maxIndex].value !== points[minIndex].value) {
    digest.rangePositionPct = compactNumber(
      ((last - points[minIndex].value) / (points[maxIndex].value - points[minIndex].value)) * 100,
    )
  }
  if (points[minIndex].label) digest.minAt = points[minIndex].label
  if (points[maxIndex].label) digest.maxAt = points[maxIndex].label
  return digest
}

function compactNumber(value: number): number {
  return Number(value.toPrecision(12))
}

const FACTOR_ANALYSIS_TYPES = new Set(['VALUES', 'IC', 'QUANTILE', 'DECAY', 'DISTRIBUTION', 'CORRELATION'])
const FACTOR_INPUT_KEYS = new Set([
  'analysis',
  'factorNames',
  'asOfDate',
  'startDate',
  'endDate',
  'universe',
  'forwardDays',
  'icMethod',
  'quantiles',
  'rebalanceDays',
  'decayPeriods',
  'bins',
  'page',
  'pageSize',
])
const FACTOR_INPUT_KEYS_BY_ANALYSIS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  VALUES: new Set(['analysis', 'factorNames', 'asOfDate', 'universe', 'page', 'pageSize']),
  IC: new Set(['analysis', 'factorNames', 'startDate', 'endDate', 'universe', 'forwardDays', 'icMethod']),
  QUANTILE: new Set(['analysis', 'factorNames', 'startDate', 'endDate', 'universe', 'quantiles', 'rebalanceDays']),
  DECAY: new Set(['analysis', 'factorNames', 'startDate', 'endDate', 'universe', 'decayPeriods']),
  DISTRIBUTION: new Set(['analysis', 'factorNames', 'asOfDate', 'universe', 'bins']),
  CORRELATION: new Set(['analysis', 'factorNames', 'asOfDate', 'universe', 'icMethod']),
})

export function normalizePlannedToolInput(
  toolKey: string,
  input: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  if (toolKey === 'get_market_news') return normalizeMarketNewsInput(input, now)
  if (toolKey === 'get_data_availability') return normalizeDataAvailabilityInput(input)
  if (toolKey !== 'get_factor_analysis') return input
  const analysis = typeof input.analysis === 'string' ? input.analysis : ''
  if (!FACTOR_ANALYSIS_TYPES.has(analysis)) return input

  const allowedKeys = FACTOR_INPUT_KEYS_BY_ANALYSIS[analysis]!
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([key]) => !FACTOR_INPUT_KEYS.has(key) || allowedKeys.has(key)),
  )
  if (!['IC', 'QUANTILE', 'DECAY'].includes(analysis)) return normalized

  const endDate = isIsoDate(normalized.endDate) ? normalized.endDate : formatIsoDate(now)
  const startDate = isIsoDate(normalized.startDate) ? normalized.startDate : oneYearBefore(endDate)
  return { ...normalized, startDate, endDate }
}

function normalizeDataAvailabilityInput(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.tsCode !== 'string' || !Array.isArray(input.datasets) || input.datasets.length === 0) return input
  const datasets = input.datasets.filter(
    (dataset): dataset is DataAvailabilityDataset =>
      typeof dataset === 'string' && Object.prototype.hasOwnProperty.call(DATA_AVAILABILITY_CATALOG, dataset),
  )
  if (datasets.length !== input.datasets.length) return input
  const securityDatasets = datasets.filter((dataset) => DATA_AVAILABILITY_CATALOG[dataset].supportsSecurityScope)
  if (securityDatasets.length === 0) {
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'tsCode'))
  }
  return { ...input, datasets: securityDatasets }
}

function normalizeMarketNewsInput(input: Record<string, unknown>, now: Date): Record<string, unknown> {
  const normalizedAfter = normalizeShanghaiDateTime(input.publishedAfter)
  const normalizedBefore = normalizeShanghaiDateTime(input.publishedBefore)
  const normalized = {
    ...input,
    ...(normalizedAfter ? { publishedAfter: normalizedAfter } : {}),
    ...(normalizedBefore ? { publishedBefore: normalizedBefore } : {}),
  }
  const after = isIsoDateTime(normalized.publishedAfter) ? normalized.publishedAfter : null
  const before = isIsoDateTime(normalized.publishedBefore) ? normalized.publishedBefore : null
  const suppliedAfter = input.publishedAfter !== undefined && input.publishedAfter !== null
  const suppliedBefore = input.publishedBefore !== undefined && input.publishedBefore !== null
  if (after && !suppliedBefore) return { ...normalized, publishedBefore: now.toISOString() }
  if (!suppliedAfter && before) return { ...normalized, publishedAfter: sixDaysBefore(before) }
  return normalized
}

function normalizeShanghaiDateTime(value: unknown): string | null {
  if (isIsoDateTime(value)) return value
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}+08:00`))
  ) {
    return `${value}+08:00`
  }
  return null
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /(Z|[+-]\d{2}:\d{2})$/i.test(value)
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function oneYearBefore(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCFullYear(date.getUTCFullYear() - 1)
  return formatIsoDate(date)
}

function sixDaysBefore(value: string): string {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() - 6)
  return date.toISOString()
}

const TOOL_PUBLIC_TITLES: Readonly<Record<FactPacket['toolKey'], string>> = Object.freeze({
  resolve_security: '研究标的确认',
  get_stock_price_history: '个股历史行情',
  get_stock_overview: '个股基础数据',
  get_data_availability: '数据覆盖与可用性',
  get_financial_statements: '财务报表',
  get_financial_indicators: '财务指标',
  get_stock_moneyflow: '个股资金流向',
  compute_valuation_percentile: '估值历史分位',
  screen_stocks: '条件选股结果',
  get_stock_technical_indicators: '技术指标计算',
  get_stock_technical_signals: '技术信号计算',
  get_stock_chip_profile: '筹码结构分析',
  get_stock_margin_history: '融资融券数据',
  get_stock_relative_strength: '相对强弱计算',
  get_stock_events: '公司事件',
  get_stock_shareholder_profile: '股东与质押数据',
  get_market_snapshot: '市场快照',
  get_sector_membership: '行业归属与成分',
  get_index_market_data: '指数行情与估值',
  get_fund_research: '基金研究数据',
  get_industry_rotation: '行业轮动数据',
  get_factor_analysis: '因子分析结果',
  get_macro_snapshot: '宏观经济数据',
  get_option_market: '期权市场数据',
  get_convertible_bond_market: '可转债市场数据',
  run_event_study: '事件研究结果',
  search_web: '公开网页检索结果',
  fetch_web_page: '公开网页正文',
  get_user_watchlist: '自选股数据',
  get_portfolio_risk: '组合风险分析',
  get_backtest_result: '回测结果',
  get_backtest_analytics: '回测深度分析',
  get_portfolio_analytics: '组合绩效分析',
  get_market_news: '本地新闻与公告',
  compute_performance_metrics: '收益与风险指标',
  save_research_report: '研究报告保存预览',
})

export function toolPublicTitle(toolKey: FactPacket['toolKey']): string {
  return TOOL_PUBLIC_TITLES[toolKey]
}

function normalizeToolError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  if (error instanceof ToolExecutionError) {
    return new WorkflowExecutionError(
      'TOOL',
      TOOL_ERROR_AGENT_CODE[error.result.code],
      error.result.retryable,
      error.result.message,
    )
  }
  return new WorkflowExecutionError('TOOL', 6099, true, 'Tool 执行失败')
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ToolExecutionError) return error.result.message
  if (error instanceof WorkflowExecutionError) return error.message
  return 'Tool 执行失败'
}

function bindingErrorMessage(error: unknown): string {
  if (error instanceof ToolResultBindingEmptyCollectionError) return '依赖查询未返回可用候选'
  if (error instanceof ToolResultBindingUnavailableError) return error.message
  return '依赖 Tool 结果绑定失败'
}

async function mapLimit<T, R>(items: readonly T[], limit: number, handler: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await handler(items[index])
    }
  })
  await Promise.all(workers)
  return output
}
