import { Inject, Injectable } from '@nestjs/common'
import type { BacktestAnalyticsReadPort } from './ports/backtest-analytics-read.port'
import { BACKTEST_ANALYTICS_READ_PORT } from './ports/backtest-analytics-read.port'
import { BacktestAnalyticsRepository } from './backtest-analytics.repository'

export const BACKTEST_ANALYSIS_KEYS = [
  'MONTE_CARLO',
  'BRINSON_ATTRIBUTION',
  'COST_SENSITIVITY',
  'PARAM_SWEEP_RESULT',
  'WALK_FORWARD_RESULT',
  'COMPARISON_RESULT',
] as const
export type BacktestAnalysisKey = (typeof BACKTEST_ANALYSIS_KEYS)[number]

export interface BacktestAnalyticsToolInput {
  analyses: BacktestAnalysisKey[]
  backtestRunId?: string
  paramSweepId?: string
  walkForwardRunId?: string
  comparisonGroupId?: string
  monteCarlo?: {
    simulations: number
    seed: number
    confidenceLevels?: number[]
    maxSeriesPoints?: number
  }
  attribution?: {
    industryLevel?: 'L1' | 'L2'
    granularity?: 'WEEKLY' | 'MONTHLY'
    benchmarkCode?: '000300.SH' | '000905.SH' | '000852.SH'
  }
  costSensitivity?: { commissionRates?: number[]; slippageBps?: number[] }
}

type AnalyticsSection =
  | { status: 'OK'; data: unknown; error: null }
  | { status: 'NOT_REQUESTED'; data: null; error: null }
  | { status: 'ERROR'; data: null; error: { code: string; message: string } }

const ANALYSIS_TO_SECTION = {
  MONTE_CARLO: 'monteCarlo',
  BRINSON_ATTRIBUTION: 'brinsonAttribution',
  COST_SENSITIVITY: 'costSensitivity',
  PARAM_SWEEP_RESULT: 'paramSweepResult',
  WALK_FORWARD_RESULT: 'walkForwardResult',
  COMPARISON_RESULT: 'comparisonResult',
} as const

@Injectable()
export class BacktestAnalyticsToolFacade {
  constructor(
    private readonly repository: BacktestAnalyticsRepository,
    @Inject(BACKTEST_ANALYTICS_READ_PORT) private readonly readPort: BacktestAnalyticsReadPort,
  ) {}

  async analyze(userId: number, input: BacktestAnalyticsToolInput) {
    const command = normalizeInput(input)
    const sections = Object.fromEntries(
      Object.values(ANALYSIS_TO_SECTION).map((key) => [key, notRequested()]),
    ) as Record<(typeof ANALYSIS_TO_SECTION)[BacktestAnalysisKey], AnalyticsSection>
    let run: Awaited<ReturnType<BacktestAnalyticsRepository['findOwnedRun']>> = null
    if (command.backtestRunId) {
      run = await this.repository.findOwnedRun(command.backtestRunId, userId)
      if (!run) throw notFound('回测不存在或无权访问')
    }
    await this.assertOwnedResources(userId, command)

    let succeeded = 0
    for (const analysis of command.analyses) {
      const key = ANALYSIS_TO_SECTION[analysis]
      try {
        sections[key] = { status: 'OK', data: await this.executeAnalysis(analysis, userId, command, run), error: null }
        succeeded += 1
      } catch (error) {
        sections[key] = {
          status: 'ERROR',
          data: null,
          error: { code: classifyError(error), message: safeMessage(error) },
        }
      }
    }
    if (succeeded === 0) throw new BacktestAnalyticsToolError('UPSTREAM_FAILED', '请求的回测分析全部失败', true)
    const warnings =
      run && run.reproducibilityStatus !== 'VERIFIED'
        ? [{ code: 'BACKTEST_BIAS_UNVERIFIED', message: '基础回测可复现性未验证，分析结果不能视为无偏证据' }]
        : []
    return {
      data: {
        ownerScoped: true as const,
        backtestRunId: command.backtestRunId ?? null,
        runStatus: run?.status ?? null,
        reproducibility: run
          ? {
              verified: run.reproducibilityStatus === 'VERIFIED',
              engineVersion: run.engineVersion,
              dataContractVersion: run.dataContractVersion,
              universePolicyVersion: run.universePolicyVersion,
              financialAsOfPolicyVersion: run.financialAsOfPolicyVersion,
              adjustmentPolicyVersion: run.adjustmentPolicyVersion,
              qualityFlags: jsonStrings(run.qualityFlags),
            }
          : null,
        ...sections,
        partial: succeeded < command.analyses.length,
      },
      asOf: run?.completedAt?.toISOString().slice(0, 10) ?? null,
      sourceModels: [
        'BacktestRun',
        'BacktestDailyNav',
        'BacktestTrade',
        'BacktestPositionSnapshot',
        'ParamSweep',
        'BacktestWalkForwardRun',
        'BacktestComparisonGroup',
      ],
      warnings,
      rowCount: countRows(sections),
    }
  }

  private async assertOwnedResources(userId: number, command: ReturnType<typeof normalizeInput>): Promise<void> {
    if (command.paramSweepId && !(await this.repository.ownsParamSweep(command.paramSweepId, userId))) {
      throw notFound('参数扫描不存在或无权访问')
    }
    if (command.walkForwardRunId && !(await this.repository.ownsWalkForward(command.walkForwardRunId, userId))) {
      throw notFound('Walk Forward 结果不存在或无权访问')
    }
    if (command.comparisonGroupId && !(await this.repository.ownsComparison(command.comparisonGroupId, userId))) {
      throw notFound('对比回测不存在或无权访问')
    }
  }

  private executeAnalysis(
    analysis: BacktestAnalysisKey,
    userId: number,
    command: ReturnType<typeof normalizeInput>,
    run: Awaited<ReturnType<BacktestAnalyticsRepository['findOwnedRun']>>,
  ): Promise<unknown> {
    if (['MONTE_CARLO', 'BRINSON_ATTRIBUTION', 'COST_SENSITIVITY'].includes(analysis) && run?.status !== 'COMPLETED') {
      throw new BacktestAnalyticsToolError('DATA_NOT_READY', '基础回测尚未完成')
    }
    if (analysis === 'MONTE_CARLO') {
      const config = command.monteCarlo as NonNullable<typeof command.monteCarlo>
      return this.readPort
        .monteCarlo(command.backtestRunId as string, userId, {
          simulations: config.simulations,
          seed: config.seed,
          confidenceLevels: config.confidenceLevels,
        })
        .then((result) => sampleMonteCarlo(result, config.maxSeriesPoints))
    }
    if (analysis === 'BRINSON_ATTRIBUTION') {
      return this.readPort.brinson(command.backtestRunId as string, userId, command.attribution)
    }
    if (analysis === 'COST_SENSITIVITY') {
      return this.readPort.costSensitivity(command.backtestRunId as string, userId, command.costSensitivity)
    }
    if (analysis === 'PARAM_SWEEP_RESULT')
      return this.readPort.getParamSweepResult(command.paramSweepId as string, userId)
    if (analysis === 'WALK_FORWARD_RESULT') {
      return this.readPort.getWalkForwardResult(command.walkForwardRunId as string, userId)
    }
    return this.readPort.getComparisonResult(command.comparisonGroupId as string, userId)
  }
}

export class BacktestAnalyticsToolError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'DATA_NOT_FOUND' | 'DATA_NOT_READY' | 'RESULT_TOO_LARGE' | 'UPSTREAM_FAILED',
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = BacktestAnalyticsToolError.name
  }
}

function normalizeInput(input: BacktestAnalyticsToolInput) {
  if (!input || typeof input !== 'object') throw invalid('输入必须为对象')
  const analyses = input.analyses
  if (
    !Array.isArray(analyses) ||
    analyses.length < 1 ||
    analyses.length > 3 ||
    new Set(analyses).size !== analyses.length ||
    analyses.some((analysis) => !BACKTEST_ANALYSIS_KEYS.includes(analysis))
  ) {
    throw invalid('analyses 必须包含 1-3 个不重复的支持项')
  }
  const baseRequested = analyses.some((analysis) =>
    ['MONTE_CARLO', 'BRINSON_ATTRIBUTION', 'COST_SENSITIVITY'].includes(analysis),
  )
  requireId(input.backtestRunId, 'backtestRunId', baseRequested)
  requireId(input.paramSweepId, 'paramSweepId', analyses.includes('PARAM_SWEEP_RESULT'))
  requireId(input.walkForwardRunId, 'walkForwardRunId', analyses.includes('WALK_FORWARD_RESULT'))
  requireId(input.comparisonGroupId, 'comparisonGroupId', analyses.includes('COMPARISON_RESULT'))
  rejectUnused(input.monteCarlo, analyses.includes('MONTE_CARLO'), 'monteCarlo')
  rejectUnused(input.attribution, analyses.includes('BRINSON_ATTRIBUTION'), 'attribution')
  rejectUnused(input.costSensitivity, analyses.includes('COST_SENSITIVITY'), 'costSensitivity')
  if (analyses.includes('MONTE_CARLO') && !input.monteCarlo) throw invalid('MONTE_CARLO 需要 monteCarlo 配置')
  const monteCarlo = input.monteCarlo
    ? {
        simulations: integer(input.monteCarlo.simulations, 'simulations', 100, 5_000),
        seed: int32(input.monteCarlo.seed, 'seed'),
        confidenceLevels: confidenceLevels(input.monteCarlo.confidenceLevels),
        maxSeriesPoints: integer(input.monteCarlo.maxSeriesPoints ?? 500, 'maxSeriesPoints', 20, 1_000),
      }
    : undefined
  const attribution = {
    industryLevel: input.attribution?.industryLevel ?? ('L1' as const),
    granularity: input.attribution?.granularity ?? ('MONTHLY' as const),
    benchmarkCode: input.attribution?.benchmarkCode ?? ('000300.SH' as const),
  }
  const costSensitivity = {
    commissionRates: boundedNumbers(input.costSensitivity?.commissionRates, 'commissionRates', 0, 0.01),
    slippageBps: boundedNumbers(input.costSensitivity?.slippageBps, 'slippageBps', 0, 100),
  }
  if ((costSensitivity.commissionRates?.length ?? 1) * (costSensitivity.slippageBps?.length ?? 1) > 25) {
    throw invalid('成本敏感度网格不能超过 25')
  }
  return {
    analyses,
    backtestRunId: input.backtestRunId,
    paramSweepId: input.paramSweepId,
    walkForwardRunId: input.walkForwardRunId,
    comparisonGroupId: input.comparisonGroupId,
    monteCarlo,
    attribution,
    costSensitivity,
  }
}

function confidenceLevels(values?: number[]): number[] {
  const levels = values ?? [0.05, 0.25, 0.5, 0.75, 0.95]
  if (
    levels.length < 1 ||
    levels.length > 5 ||
    levels.some((value) => !Number.isFinite(value) || value < 0.01 || value > 0.99) ||
    levels.some((value, index) => index > 0 && value <= levels[index - 1])
  ) {
    throw invalid('confidenceLevels 必须升序、去重且位于 0.01-0.99')
  }
  return levels
}

function boundedNumbers(
  values: number[] | undefined,
  field: string,
  minimum: number,
  maximum: number,
): number[] | undefined {
  if (values === undefined) return undefined
  if (
    values.length < 1 ||
    values.length > 5 ||
    new Set(values).size !== values.length ||
    values.some((value) => !Number.isFinite(value) || value < minimum || value > maximum)
  ) {
    throw invalid(`${field} 必须包含 1-5 个不重复的有效值`)
  }
  return values
}

function requireId(value: string | undefined, field: string, required: boolean): void {
  if (required && (!value || value.length > 64)) throw invalid(`${field} 必填且最长 64`)
}

function rejectUnused(value: unknown, requested: boolean, field: string): void {
  if (!requested && value !== undefined) throw invalid(`未请求对应分析时不能传 ${field}`)
}

function integer(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw invalid(`${field} 必须为 ${minimum}-${maximum} 整数`)
  return value
}

function int32(value: number, field: string): number {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647)
    throw invalid(`${field} 必须为 32 位整数`)
  return value
}

function invalid(message: string): BacktestAnalyticsToolError {
  return new BacktestAnalyticsToolError('INVALID_ARGUMENT', message)
}

function notFound(message: string): BacktestAnalyticsToolError {
  return new BacktestAnalyticsToolError('DATA_NOT_FOUND', message)
}

function notRequested(): AnalyticsSection {
  return { status: 'NOT_REQUESTED', data: null, error: null }
}

function classifyError(error: unknown): string {
  return error instanceof BacktestAnalyticsToolError ? error.code : 'UPSTREAM_FAILED'
}

function safeMessage(error: unknown): string {
  if (error instanceof BacktestAnalyticsToolError) return error.message
  return '该回测分析暂时不可用'
}

function sampleMonteCarlo(value: unknown, maximum: number): unknown {
  if (!value || typeof value !== 'object') return value
  const result = value as Record<string, unknown>
  const timeSeries = Array.isArray(result.timeSeries) ? result.timeSeries : []
  if (timeSeries.length <= maximum) return value
  return { ...result, timeSeries: evenlySample(timeSeries, maximum), timeSeriesTruncated: true }
}

function evenlySample<T>(values: T[], maximum: number): T[] {
  return Array.from(
    { length: maximum },
    (_, index) => values[Math.round((index * (values.length - 1)) / (maximum - 1))],
  )
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function countRows(sections: Record<string, AnalyticsSection>): number {
  return Object.values(sections).reduce(
    (sum, section) => sum + (section.status === 'OK' ? estimateRows(section.data) : 0),
    0,
  )
}

function estimateRows(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 1
  return Math.max(1, ...Object.values(value).map((item) => (Array.isArray(item) ? item.length : 1)))
}
