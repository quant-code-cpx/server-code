import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE, CACHE_TTL_SECONDS } from 'src/constant/cache.constant'
import { parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { CacheService } from 'src/shared/cache.service'
import {
  calculateAdjustedReturn,
  calculateBasicReturnStatistics,
  calculateDirectionalReturn,
  calculateDirectionalReturnStatistics,
  calculateStudentTMeanConfidenceInterval,
  calculateWilsonSuccessConfidenceInterval,
  createQfqBars,
  detectTechnicalSignalOccurrences,
  TechnicalIndicatorEngine,
  TECHNICAL_INDICATOR_ALGORITHM_VERSION,
  type TechnicalSignalDefinition,
  type TechnicalSignalDirection,
  type TechnicalSignalOccurrence,
} from '../domain'
import {
  TechnicalSignalEntryMode,
  TechnicalSignalOccurrenceListRequestDto,
  TechnicalSignalPeriod,
  TechnicalSignalStatisticsRequestDto,
} from '../dto/technical-signal-request.dto'
import {
  TechnicalSignalOccurrenceListResponseDto,
  TechnicalSignalOccurrenceItemDto,
  SignalPeriodStatisticsDto,
  TechnicalSignalStatisticsResponseDto,
} from '../dto/technical-signal-response.dto'
import {
  PrismaTechnicalSignalRepository,
  type TechnicalSignalRawBar,
  type TechnicalSignalTimelineSnapshot,
} from '../repositories/prisma-technical-signal.repository'
import { TechnicalSignalDefinitionService } from './technical-signal-definition.service'

const DEFAULT_HORIZONS = [1, 3, 5, 10, 20]
const MAX_CUSTOM_YEARS = Number(process.env.TECHNICAL_SIGNAL_STATISTICS_MAX_CUSTOM_YEARS) || 10
const STATISTICS_ALGORITHM_VERSION = 'signal-statistics.v1'
const RETURN_POLICY_VERSION = 'adjusted-return.v1'
const CONFIDENCE_INTERVAL_VERSION = 'student-t-wilson.v1'
const CACHE_ENABLED = process.env.TECHNICAL_SIGNAL_STATISTICS_CACHE_ENABLED !== 'false'

type OutcomeQualityStatus = 'VALID' | 'IMMATURE' | 'MISSING'
type PathCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'NOT_APPLICABLE'

interface NormalizedQuery {
  tsCode: string
  definitions: TechnicalSignalDefinition[]
  periods: TechnicalSignalPeriod[]
  customStartDate?: string
  customEndDate?: string
  horizons: number[]
  requestedAsOf?: string
  entryMode: TechnicalSignalEntryMode
  includeBenchmark: boolean
  benchmarkTsCode: string | null
}

interface PeriodWindow {
  period: TechnicalSignalPeriod
  requestedStartDate: string
  actualStartDate: string | null
  endDate: string
}

interface SignalOutcome {
  horizon: number
  expectedEntryDate: string
  expectedTargetDate: string
  qualityStatus: OutcomeQualityStatus
  missingReason: 'ENTRY_QUOTE_MISSING' | 'TARGET_QUOTE_MISSING' | null
  entryRawPrice: number | null
  entryAdjFactor: number | null
  targetRawPrice: number | null
  targetAdjFactor: number | null
  rawReturn: number | null
  directionalReturn: number | null
  benchmarkReturn: number | null
  excessReturn: number | null
  benchmarkMissingReason: 'BENCHMARK_NOT_LISTED' | null
  pathCoverageStatus: PathCoverageStatus
  pathMissingDates: string[]
  rawMfe: number | null
  rawMae: number | null
  directionalMfe: number | null
  directionalMae: number | null
}

interface EvaluatedOccurrence extends TechnicalSignalOccurrence {
  signalId: string
  outcomes: SignalOutcome[]
}

interface PreparedEvaluation {
  query: NormalizedQuery
  timeline: TechnicalSignalTimelineSnapshot
  occurrences: EvaluatedOccurrence[]
  actualValidRows: number
}

interface EvaluationContext {
  calendarIndexByDate: ReadonlyMap<string, number>
  barsByDate: ReadonlyMap<string, TechnicalSignalRawBar>
}

interface OccurrenceWindow {
  startDate?: string
  endDate?: string
}

/**
 * 统计编排层：全历史递推一次，按 period/horizon 过滤和聚合。明细分页永不参与统计计算。
 */
@Injectable()
export class TechnicalSignalStatisticsService {
  private readonly indicatorEngine = new TechnicalIndicatorEngine()

  constructor(
    private readonly repository: PrismaTechnicalSignalRepository,
    private readonly definitions: TechnicalSignalDefinitionService,
    private readonly cacheService: CacheService,
  ) {}

  async query(dto: TechnicalSignalStatisticsRequestDto): Promise<TechnicalSignalStatisticsResponseDto> {
    const query = this.normalizeStatisticsQuery(dto)
    const timeline = await this.loadTimeline(query)
    const windows = this.resolvePeriodWindows(query, timeline)
    const compute = () =>
      this.buildStatisticsResponse(
        query,
        this.prepare(query, timeline, {
          startDate: earliestActualStartDate(windows),
          endDate: latestWindowEndDate(windows),
        }),
        windows,
      )
    if (!CACHE_ENABLED) return compute()

    const result = await this.cacheService.rememberJsonWithStatus({
      namespace: CACHE_NAMESPACE.STOCK_TECHNICAL_SIGNAL_STATISTICS,
      key: this.cacheService.buildSha256Key(
        CACHE_KEY_PREFIX.STOCK_TECHNICAL_SIGNAL_STATISTICS,
        buildStatisticsCachePayload(query, timeline),
      ),
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_TECHNICAL_SIGNAL_STATISTICS,
      loader: async () => compute(),
    })
    return {
      ...result.value,
      meta: {
        ...result.value.meta,
        servedAt: new Date().toISOString(),
        cacheHit: result.cacheHit,
      },
    }
  }

  private buildStatisticsResponse(
    query: NormalizedQuery,
    prepared: PreparedEvaluation,
    windows: readonly PeriodWindow[],
  ): TechnicalSignalStatisticsResponseDto {
    const anyEvaluable = query.definitions.some(
      (definition) => prepared.actualValidRows >= requiredRows(definition.signalKey),
    )
    if (!anyEvaluable) {
      throw new UnprocessableEntityException('TECHNICAL_SIGNAL_INSUFFICIENT_HISTORY: 全部所选信号未达到最小有效行情数')
    }

    const warnings = new Set<string>()
    const groups = windows.flatMap((window) =>
      query.definitions.map((definition) => this.buildPeriodGroup({ definition, window, prepared, warnings })),
    )
    const now = new Date().toISOString()
    return {
      meta: {
        tsCode: prepared.timeline.stock.tsCode,
        stockName: prepared.timeline.stock.name,
        dataAsOf: prepared.timeline.dataAsOf,
        computedAt: now,
        servedAt: now,
        timezone: 'Asia/Shanghai',
        signalSource: 'LOCAL_QFQ_OHLCV',
        indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
        entryMode: query.entryMode,
        adjustment: 'ADJ_FACTOR_RATIO',
        dataVersions: prepared.timeline.dataVersions,
        statisticsAlgorithmVersion: STATISTICS_ALGORITHM_VERSION,
        returnPolicyVersion: RETURN_POLICY_VERSION,
        confidenceIntervalVersion: CONFIDENCE_INTERVAL_VERSION,
        confidenceLevel: 0.95,
        benchmarkTsCode: query.benchmarkTsCode,
        cacheHit: false,
        warnings: [...warnings],
      },
      groups,
    }
  }

  async listOccurrences(
    dto: TechnicalSignalOccurrenceListRequestDto,
  ): Promise<TechnicalSignalOccurrenceListResponseDto> {
    const definition = this.definitions.resolveOne(dto.signalKey, dto.semanticsVersion)
    assertValidOptionalCompactDate(dto.startDate, 'startDate')
    assertValidOptionalCompactDate(dto.endDate, 'endDate')
    assertValidOptionalCompactDate(dto.asOfTradeDate, 'asOfTradeDate')
    const horizons = normalizeHorizonValues(dto.horizons ?? [1])
    const includeBenchmark = dto.includeBenchmark ?? false
    const benchmarkTsCode = normalizeBenchmark(includeBenchmark, dto.benchmarkTsCode)
    const qualityStatuses = normalizeQualityStatuses(dto.qualityStatuses)
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: startDate 不得晚于 endDate')
    }
    const query: NormalizedQuery = {
      tsCode: dto.tsCode,
      definitions: [definition],
      periods: [TechnicalSignalPeriod.CUSTOM],
      customStartDate: dto.startDate,
      customEndDate: dto.endDate,
      horizons,
      requestedAsOf: dto.asOfTradeDate,
      entryMode: dto.entryMode ?? TechnicalSignalEntryMode.SIGNAL_CLOSE,
      includeBenchmark,
      benchmarkTsCode,
    }
    const timeline = await this.loadTimeline(query)
    const prepared = this.prepare(query, timeline, { startDate: dto.startDate, endDate: dto.endDate })
    if (dto.endDate > prepared.timeline.dataAsOf) {
      throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: endDate 不得晚于 dataAsOf')
    }

    const allowedStatuses = qualityStatuses ? new Set(qualityStatuses) : null
    const matched = prepared.occurrences
      .filter((occurrence) => occurrence.signalDate >= dto.startDate && occurrence.signalDate <= dto.endDate)
      .filter(
        (occurrence) =>
          !allowedStatuses || occurrence.outcomes.some((outcome) => allowedStatuses.has(outcome.qualityStatus)),
      )
      .sort(
        (left, right) => right.signalDate.localeCompare(left.signalDate) || left.signalId.localeCompare(right.signalId),
      )
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    return {
      total: matched.length,
      page,
      pageSize,
      items: matched
        .slice((page - 1) * pageSize, page * pageSize)
        .map((occurrence) => this.toOccurrenceDto(occurrence, prepared.timeline.stock.tsCode)),
    }
  }

  private async loadTimeline(query: NormalizedQuery): Promise<TechnicalSignalTimelineSnapshot> {
    return this.repository.loadTimeline({
      tsCode: query.tsCode,
      requestedAsOf: query.requestedAsOf,
      maxHorizon: Math.max(...query.horizons),
      includeBenchmark: query.includeBenchmark,
      benchmarkTsCode: query.benchmarkTsCode,
    })
  }

  private prepare(
    query: NormalizedQuery,
    timeline: TechnicalSignalTimelineSnapshot,
    occurrenceWindow: OccurrenceWindow = {},
  ): PreparedEvaluation {
    const qfqBars = createQfqBars(timeline.bars)
    const points = this.indicatorEngine.compute(qfqBars)
    const context: EvaluationContext = {
      calendarIndexByDate: new Map(timeline.openDates.map((date, index) => [date, index])),
      barsByDate: new Map(timeline.bars.map((bar) => [bar.tradeDate, bar])),
    }
    const allOccurrences = detectTechnicalSignalOccurrences(points, {
      definitions: query.definitions,
      ...(occurrenceWindow.startDate ? { windowStartDate: occurrenceWindow.startDate } : {}),
      ...(occurrenceWindow.endDate ? { windowEndDate: occurrenceWindow.endDate } : {}),
    })
    const occurrences = allOccurrences.map((occurrence) => ({
      ...occurrence,
      signalId: stableSignalId(query.tsCode, occurrence),
      outcomes: query.horizons.map((horizon) =>
        this.evaluateOutcome({
          occurrence,
          horizon,
          entryMode: query.entryMode,
          timeline,
          context,
        }),
      ),
    }))
    return { query, timeline, occurrences, actualValidRows: points.length }
  }

  private normalizeStatisticsQuery(dto: TechnicalSignalStatisticsRequestDto): NormalizedQuery {
    assertValidOptionalCompactDate(dto.customStartDate, 'customStartDate')
    assertValidOptionalCompactDate(dto.customEndDate, 'customEndDate')
    assertValidOptionalCompactDate(dto.asOfTradeDate, 'asOfTradeDate')
    const periods = uniqueValues(
      dto.periods ?? [TechnicalSignalPeriod.ONE_YEAR, TechnicalSignalPeriod.THREE_YEARS],
      'periods',
    ).sort()
    const hasCustom = periods.includes(TechnicalSignalPeriod.CUSTOM)
    if (hasCustom && !dto.customStartDate) {
      throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: CUSTOM 必须提供 customStartDate')
    }
    if (!hasCustom && (dto.customStartDate || dto.customEndDate)) {
      throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: 非 CUSTOM 请求不得提供自定义日期')
    }
    if (dto.customStartDate && dto.customEndDate && dto.customStartDate > dto.customEndDate) {
      throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: customStartDate 不得晚于 customEndDate')
    }
    const includeBenchmark = dto.includeBenchmark ?? false
    return {
      tsCode: dto.tsCode,
      definitions: this.definitions
        .resolveSelectors(dto.signals)
        .sort((left, right) =>
          `${left.signalKey}|${left.semanticsVersion}`.localeCompare(`${right.signalKey}|${right.semanticsVersion}`),
        ),
      periods,
      customStartDate: dto.customStartDate,
      customEndDate: dto.customEndDate,
      horizons: normalizeHorizonValues(dto.horizons ?? DEFAULT_HORIZONS),
      requestedAsOf: dto.asOfTradeDate,
      entryMode: dto.entryMode ?? TechnicalSignalEntryMode.SIGNAL_CLOSE,
      includeBenchmark,
      benchmarkTsCode: normalizeBenchmark(includeBenchmark, dto.benchmarkTsCode),
    }
  }

  private resolvePeriodWindows(query: NormalizedQuery, timeline: TechnicalSignalTimelineSnapshot): PeriodWindow[] {
    return query.periods.map((period) => {
      const endDate =
        period === TechnicalSignalPeriod.CUSTOM ? (query.customEndDate ?? timeline.dataAsOf) : timeline.dataAsOf
      const requestedStartDate =
        period === TechnicalSignalPeriod.ONE_YEAR
          ? subtractCalendarYears(timeline.dataAsOf, 1)
          : period === TechnicalSignalPeriod.THREE_YEARS
            ? subtractCalendarYears(timeline.dataAsOf, 3)
            : (query.customStartDate as string)
      if (endDate > timeline.dataAsOf || requestedStartDate > endDate) {
        throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: period 日期范围无效')
      }
      if (
        period === TechnicalSignalPeriod.CUSTOM &&
        requestedStartDate < subtractCalendarYears(timeline.dataAsOf, MAX_CUSTOM_YEARS)
      ) {
        throw new BadRequestException(`TECHNICAL_SIGNAL_REQUEST_INVALID: CUSTOM 最多 ${MAX_CUSTOM_YEARS} 年`)
      }
      return {
        period,
        requestedStartDate,
        actualStartDate: timeline.openDates.find((date) => date >= requestedStartDate && date <= endDate) ?? null,
        endDate,
      }
    })
  }

  private buildPeriodGroup(input: {
    definition: TechnicalSignalDefinition
    window: PeriodWindow
    prepared: PreparedEvaluation
    warnings: Set<string>
  }): SignalPeriodStatisticsDto {
    const { definition, window, prepared, warnings } = input
    const requiredValidRows = requiredRows(definition.signalKey)
    const evaluable = prepared.actualValidRows >= requiredValidRows
    const occurrences =
      evaluable && window.actualStartDate
        ? prepared.occurrences.filter(
            (occurrence) =>
              occurrence.signalKey === definition.signalKey &&
              occurrence.semanticsVersion === definition.semanticsVersion &&
              occurrence.signalDate >= window.actualStartDate! &&
              occurrence.signalDate <= window.endDate,
          )
        : []
    const horizons = evaluable
      ? prepared.query.horizons.map((horizon) =>
          this.aggregateHorizon(definition.direction, occurrences, horizon, warnings),
        )
      : []

    return {
      period: window.period,
      requestedStartDate: window.requestedStartDate,
      actualStartDate: window.actualStartDate,
      endDate: window.endDate,
      signalKey: definition.signalKey,
      semanticsVersion: definition.semanticsVersion,
      definitionHash: definition.definitionHash,
      direction: definition.direction,
      evaluable,
      notEvaluableReason: evaluable ? null : 'INSUFFICIENT_HISTORY',
      requiredValidRows,
      actualValidRows: prepared.actualValidRows,
      occurrenceCount: occurrences.length,
      horizons,
    }
  }

  private aggregateHorizon(
    direction: TechnicalSignalDirection,
    occurrences: readonly EvaluatedOccurrence[],
    horizon: number,
    warnings: Set<string>,
  ) {
    const outcomes = occurrences.map(
      (occurrence) => occurrence.outcomes.find((outcome) => outcome.horizon === horizon)!,
    )
    const eligible = outcomes.filter((outcome) => outcome.qualityStatus !== 'IMMATURE')
    const valid = outcomes.filter((outcome) => outcome.qualityStatus === 'VALID')
    const missing = outcomes.filter((outcome) => outcome.qualityStatus === 'MISSING')
    const immature = outcomes.filter((outcome) => outcome.qualityStatus === 'IMMATURE')
    const rawReturns = valid.map((outcome) => outcome.rawReturn as number)
    const partial = valid.filter((outcome) => outcome.pathCoverageStatus === 'PARTIAL')
    const complete = valid.filter((outcome) => outcome.pathCoverageStatus === 'COMPLETE')
    const overlappingOccurrenceCount = countOverlappingOutcomes(eligible)
    if (overlappingOccurrenceCount > 0) warnings.add('OVERLAPPING_OUTCOMES')
    if (partial.length > 0) warnings.add('PARTIAL_EXCURSION_PATHS')

    const raw = toReturnDistribution(rawReturns)
    const directional = toDirectionalDistribution(rawReturns, direction)
    const excursion = toExcursionDistribution(complete, partial, direction)
    const missingReasons = {
      ENTRY_QUOTE_MISSING: missing.filter((outcome) => outcome.missingReason === 'ENTRY_QUOTE_MISSING').length,
      TARGET_QUOTE_MISSING: missing.filter((outcome) => outcome.missingReason === 'TARGET_QUOTE_MISSING').length,
    }
    assertHorizonInvariants({
      horizon,
      direction,
      occurrenceCount: outcomes.length,
      eligible,
      valid,
      missing,
      immature,
      raw,
      directional,
      excursion,
      missingReasons,
    })
    const sampleDates = valid.map((outcome) => outcome.expectedEntryDate).sort()
    return {
      horizon,
      eligibleOutcomeCount: eligible.length,
      validOutcomeCount: valid.length,
      immatureCount: immature.length,
      missingCount: missing.length,
      overlappingOccurrenceCount,
      missingReasons,
      benchmarkMissingCount: 0,
      benchmarkMissingReasons: { BENCHMARK_NOT_LISTED: 0 },
      raw,
      directional,
      excess: null,
      excursion,
      minSampleDate: sampleDates[0] ?? null,
      maxSampleDate: sampleDates[sampleDates.length - 1] ?? null,
    }
  }

  private evaluateOutcome(input: {
    occurrence: TechnicalSignalOccurrence
    horizon: number
    entryMode: TechnicalSignalEntryMode
    timeline: TechnicalSignalTimelineSnapshot
    context: EvaluationContext
  }): SignalOutcome {
    const { occurrence, horizon, entryMode, timeline, context } = input
    const signalIndex = context.calendarIndexByDate.get(occurrence.signalDate)
    if (signalIndex === undefined) {
      throw new Error(`TECHNICAL_SIGNAL_INTERNAL_ERROR: 信号日 ${occurrence.signalDate} 不在交易日历中`)
    }
    const expectedEntryDate =
      entryMode === TechnicalSignalEntryMode.SIGNAL_CLOSE ? occurrence.signalDate : timeline.openDates[signalIndex + 1]
    const expectedTargetDate = timeline.openDates[signalIndex + horizon]
    if (!expectedEntryDate || !expectedTargetDate) {
      throw new Error('TECHNICAL_SIGNAL_INTERNAL_ERROR: 交易日历 horizon 定位失败')
    }
    if (expectedTargetDate > timeline.dataAsOf) {
      return emptyOutcome({ horizon, expectedEntryDate, expectedTargetDate, qualityStatus: 'IMMATURE' })
    }

    const entry = context.barsByDate.get(expectedEntryDate)
    if (!entry) {
      return emptyOutcome({
        horizon,
        expectedEntryDate,
        expectedTargetDate,
        qualityStatus: 'MISSING',
        missingReason: 'ENTRY_QUOTE_MISSING',
      })
    }
    const target = context.barsByDate.get(expectedTargetDate)
    if (!target) {
      return emptyOutcome({
        horizon,
        expectedEntryDate,
        expectedTargetDate,
        qualityStatus: 'MISSING',
        missingReason: 'TARGET_QUOTE_MISSING',
      })
    }

    const adjusted = calculateAdjustedReturn(entry, entry.adjFactor, target, target.adjFactor, entryMode)
    const directionalReturn = calculateDirectionalReturn(adjusted.rawReturn, occurrence.direction)
    const path = calculateExcursion({
      timeline,
      startCalendarIndex: signalIndex + 1,
      endCalendarIndex: signalIndex + horizon,
      entry,
      entryMode,
      direction: occurrence.direction,
      context,
    })
    return {
      horizon,
      expectedEntryDate,
      expectedTargetDate,
      qualityStatus: 'VALID',
      missingReason: null,
      entryRawPrice: adjusted.entryRawPrice,
      entryAdjFactor: adjusted.entryAdjFactor,
      targetRawPrice: adjusted.targetRawPrice,
      targetAdjFactor: adjusted.targetAdjFactor,
      rawReturn: adjusted.rawReturn,
      directionalReturn,
      benchmarkReturn: null,
      excessReturn: null,
      benchmarkMissingReason: null,
      pathCoverageStatus: path.status,
      pathMissingDates: path.missingDates,
      rawMfe: path.rawMfe,
      rawMae: path.rawMae,
      directionalMfe: path.directionalMfe,
      directionalMae: path.directionalMae,
    }
  }

  private toOccurrenceDto(occurrence: EvaluatedOccurrence, tsCode: string): TechnicalSignalOccurrenceItemDto {
    return {
      signalId: occurrence.signalId,
      tsCode,
      signalKey: occurrence.signalKey,
      semanticsVersion: occurrence.semanticsVersion,
      definitionHash: occurrence.definitionHash,
      source: occurrence.source,
      indicatorAlgorithmVersion: occurrence.indicatorAlgorithmVersion,
      signalDate: occurrence.signalDate,
      direction: occurrence.direction,
      evidence: occurrence.evidence,
      outcomes: occurrence.outcomes.map((outcome) => ({
        horizon: outcome.horizon,
        expectedEntryDate: outcome.expectedEntryDate,
        expectedTargetDate: outcome.expectedTargetDate,
        qualityStatus: outcome.qualityStatus,
        missingReason: outcome.missingReason,
        entryRawPrice: outcome.entryRawPrice,
        entryAdjFactor: outcome.entryAdjFactor,
        targetRawPrice: outcome.targetRawPrice,
        targetAdjFactor: outcome.targetAdjFactor,
        rawReturnPct: toPct(outcome.rawReturn),
        directionalReturnPct: toPct(outcome.directionalReturn),
        benchmarkReturnPct: toPct(outcome.benchmarkReturn),
        excessReturnPct: toPct(outcome.excessReturn),
        benchmarkMissingReason: outcome.benchmarkMissingReason,
        pathCoverageStatus: outcome.pathCoverageStatus,
        pathMissingDates: outcome.pathMissingDates,
        rawMfePct: toPct(outcome.rawMfe),
        rawMaePct: toPct(outcome.rawMae),
        directionalMfePct: toPct(outcome.directionalMfe),
        directionalMaePct: toPct(outcome.directionalMae),
      })),
    }
  }
}

function emptyOutcome(input: {
  horizon: number
  expectedEntryDate: string
  expectedTargetDate: string
  qualityStatus: 'IMMATURE' | 'MISSING'
  missingReason?: 'ENTRY_QUOTE_MISSING' | 'TARGET_QUOTE_MISSING'
}): SignalOutcome {
  return {
    horizon: input.horizon,
    expectedEntryDate: input.expectedEntryDate,
    expectedTargetDate: input.expectedTargetDate,
    qualityStatus: input.qualityStatus,
    missingReason: input.missingReason ?? null,
    entryRawPrice: null,
    entryAdjFactor: null,
    targetRawPrice: null,
    targetAdjFactor: null,
    rawReturn: null,
    directionalReturn: null,
    benchmarkReturn: null,
    excessReturn: null,
    benchmarkMissingReason: null,
    pathCoverageStatus: 'NOT_APPLICABLE',
    pathMissingDates: [],
    rawMfe: null,
    rawMae: null,
    directionalMfe: null,
    directionalMae: null,
  }
}

function calculateExcursion(input: {
  timeline: TechnicalSignalTimelineSnapshot
  startCalendarIndex: number
  endCalendarIndex: number
  entry: TechnicalSignalRawBar
  entryMode: TechnicalSignalEntryMode
  direction: TechnicalSignalDirection
  context: EvaluationContext
}): {
  status: PathCoverageStatus
  missingDates: string[]
  rawMfe: number | null
  rawMae: number | null
  directionalMfe: number | null
  directionalMae: number | null
} {
  const missingDates = input.timeline.openDates
    .slice(input.startCalendarIndex, input.endCalendarIndex + 1)
    .filter((date) => !input.context.barsByDate.has(date))
  if (missingDates.length > 0) {
    return { status: 'PARTIAL', missingDates, rawMfe: null, rawMae: null, directionalMfe: null, directionalMae: null }
  }
  const entryPrice =
    (input.entryMode === TechnicalSignalEntryMode.SIGNAL_CLOSE ? input.entry.close : input.entry.open) *
    input.entry.adjFactor
  let rawMfe = 0
  let rawMae = 0
  for (const date of input.timeline.openDates.slice(input.startCalendarIndex, input.endCalendarIndex + 1)) {
    const bar = input.context.barsByDate.get(date) as TechnicalSignalRawBar
    rawMfe = Math.max(rawMfe, (bar.high * bar.adjFactor) / entryPrice - 1)
    rawMae = Math.min(rawMae, (bar.low * bar.adjFactor) / entryPrice - 1)
  }
  if (input.direction === 'CONTEXTUAL') {
    return { status: 'COMPLETE', missingDates: [], rawMfe, rawMae, directionalMfe: null, directionalMae: null }
  }
  return input.direction === 'BULLISH'
    ? { status: 'COMPLETE', missingDates: [], rawMfe, rawMae, directionalMfe: rawMfe, directionalMae: rawMae }
    : { status: 'COMPLETE', missingDates: [], rawMfe, rawMae, directionalMfe: -rawMae, directionalMae: -rawMfe }
}

function toReturnDistribution(values: readonly number[]) {
  const stats = calculateBasicReturnStatistics(values)
  const interval = calculateStudentTMeanConfidenceInterval(values)
  return {
    sampleCount: stats.sampleCount,
    upCount: stats.upCount,
    downCount: stats.downCount,
    flatCount: stats.flatCount,
    upRatio: stats.upRatio,
    downRatio: stats.downRatio,
    flatRatio: stats.flatRatio,
    averageReturnPct: toPct(stats.average),
    medianReturnPct: toPct(stats.median),
    minimumReturnPct: toPct(stats.minimum),
    maximumReturnPct: toPct(stats.maximum),
    stdDevPct: toPct(stats.stdDev),
    p25ReturnPct: toPct(stats.p25),
    p75ReturnPct: toPct(stats.p75),
    meanConfidenceLowerPct: toPct(interval?.lower ?? null),
    meanConfidenceUpperPct: toPct(interval?.upper ?? null),
  }
}

function toDirectionalDistribution(values: readonly number[], direction: TechnicalSignalDirection) {
  if (direction === 'CONTEXTUAL') {
    return {
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      flatCount: 0,
      successRatio: null,
      averageDirectionalReturnPct: null,
      medianDirectionalReturnPct: null,
      minimumDirectionalReturnPct: null,
      maximumDirectionalReturnPct: null,
      stdDevDirectionalReturnPct: null,
      p25DirectionalReturnPct: null,
      p75DirectionalReturnPct: null,
      meanDirectionalConfidenceLowerPct: null,
      meanDirectionalConfidenceUpperPct: null,
      successConfidenceLower: null,
      successConfidenceUpper: null,
    }
  }
  const stats = calculateDirectionalReturnStatistics(
    values.map((value) => (direction === 'BULLISH' ? value : -value)),
    'BULLISH',
  )
  const interval = calculateStudentTMeanConfidenceInterval(
    values.map((value) => (direction === 'BULLISH' ? value : -value)),
  )
  const successInterval = calculateWilsonSuccessConfidenceInterval(stats.successCount, stats.sampleCount)
  return {
    sampleCount: stats.sampleCount,
    successCount: stats.successCount,
    failureCount: stats.failureCount,
    flatCount: stats.flatCount,
    successRatio: stats.successRatio,
    averageDirectionalReturnPct: toPct(stats.average),
    medianDirectionalReturnPct: toPct(stats.median),
    minimumDirectionalReturnPct: toPct(stats.minimum),
    maximumDirectionalReturnPct: toPct(stats.maximum),
    stdDevDirectionalReturnPct: toPct(stats.stdDev),
    p25DirectionalReturnPct: toPct(stats.p25),
    p75DirectionalReturnPct: toPct(stats.p75),
    meanDirectionalConfidenceLowerPct: toPct(interval?.lower ?? null),
    meanDirectionalConfidenceUpperPct: toPct(interval?.upper ?? null),
    successConfidenceLower: successInterval?.lower ?? null,
    successConfidenceUpper: successInterval?.upper ?? null,
  }
}

function toExcursionDistribution(
  complete: readonly SignalOutcome[],
  partial: readonly SignalOutcome[],
  direction: TechnicalSignalDirection,
) {
  const mfe = complete.map((outcome) => outcome.rawMfe as number)
  const mae = complete.map((outcome) => outcome.rawMae as number)
  const directionalMfe = complete
    .map((outcome) => outcome.directionalMfe)
    .filter((value): value is number => value !== null)
  const directionalMae = complete
    .map((outcome) => outcome.directionalMae)
    .filter((value): value is number => value !== null)
  const mfeStats = calculateBasicReturnStatistics(mfe)
  const maeStats = calculateBasicReturnStatistics(mae)
  const directionalMfeStats = calculateBasicReturnStatistics(directionalMfe)
  const directionalMaeStats = calculateBasicReturnStatistics(directionalMae)
  return {
    completePathCount: complete.length,
    partialPathCount: partial.length,
    averageMfePct: toPct(mfeStats.average),
    medianMfePct: toPct(mfeStats.median),
    averageMaePct: toPct(maeStats.average),
    medianMaePct: toPct(maeStats.median),
    averageDirectionalMfePct: direction === 'CONTEXTUAL' ? null : toPct(directionalMfeStats.average),
    averageDirectionalMaePct: direction === 'CONTEXTUAL' ? null : toPct(directionalMaeStats.average),
  }
}

function assertHorizonInvariants(input: {
  horizon: number
  direction: TechnicalSignalDirection
  occurrenceCount: number
  eligible: readonly SignalOutcome[]
  valid: readonly SignalOutcome[]
  missing: readonly SignalOutcome[]
  immature: readonly SignalOutcome[]
  raw: ReturnType<typeof toReturnDistribution>
  directional: ReturnType<typeof toDirectionalDistribution>
  excursion: ReturnType<typeof toExcursionDistribution>
  missingReasons: Record<string, number>
}): void {
  const fail = (reason: string) => {
    throw new Error(`TECHNICAL_SIGNAL_INTERNAL_ERROR: horizon=${input.horizon} ${reason}`)
  }
  if (input.occurrenceCount !== input.eligible.length + input.immature.length)
    fail('occurrenceCount != eligible + immature')
  if (input.eligible.length !== input.valid.length + input.missing.length) fail('eligible != valid + missing')
  if (input.raw.sampleCount !== input.valid.length) fail('raw sampleCount != valid')
  if (input.raw.upCount + input.raw.downCount + input.raw.flatCount !== input.valid.length) {
    fail('raw direction counts != valid')
  }
  if (Object.values(input.missingReasons).reduce((sum, count) => sum + count, 0) !== input.missing.length) {
    fail('missing reason counts != missing')
  }
  if (input.excursion.completePathCount + input.excursion.partialPathCount !== input.valid.length) {
    fail('excursion path counts != valid')
  }
  if (input.direction === 'CONTEXTUAL') {
    if (
      input.directional.sampleCount !== 0 ||
      input.directional.successCount !== 0 ||
      input.directional.failureCount !== 0 ||
      input.directional.flatCount !== 0
    ) {
      fail('contextual directional counts must be zero')
    }
    return
  }
  if (input.directional.sampleCount !== input.valid.length) fail('directional sampleCount != valid')
  if (
    input.directional.successCount + input.directional.failureCount + input.directional.flatCount !==
    input.valid.length
  ) {
    fail('directional counts != valid')
  }
}

function countOverlappingOutcomes(outcomes: readonly SignalOutcome[]): number {
  if (outcomes.length < 2) return 0

  const sorted = [...outcomes].sort(
    (left, right) =>
      left.expectedEntryDate.localeCompare(right.expectedEntryDate) ||
      left.expectedTargetDate.localeCompare(right.expectedTargetDate),
  )
  let componentSize = 1
  let componentMaxTargetDate = sorted[0].expectedTargetDate
  let overlappingCount = 0
  for (let index = 1; index < sorted.length; index += 1) {
    const outcome = sorted[index]
    if (outcome.expectedEntryDate <= componentMaxTargetDate) {
      componentSize += 1
      if (outcome.expectedTargetDate > componentMaxTargetDate) {
        componentMaxTargetDate = outcome.expectedTargetDate
      }
      continue
    }
    if (componentSize > 1) overlappingCount += componentSize
    componentSize = 1
    componentMaxTargetDate = outcome.expectedTargetDate
  }
  return componentSize > 1 ? overlappingCount + componentSize : overlappingCount
}

function requiredRows(signalKey: string): number {
  if (signalKey.startsWith('macd.')) return 35
  if (signalKey.startsWith('kdj.')) return 9
  if (signalKey.startsWith('rsi6.')) return 7
  if (signalKey.startsWith('boll.')) return 20
  if (signalKey.startsWith('ma.')) return 60
  if (signalKey.startsWith('sar.')) return 2
  if (signalKey.startsWith('volume-ratio20.')) return 21
  throw new Error(`TECHNICAL_SIGNAL_INTERNAL_ERROR: 未知 signalKey ${signalKey}`)
}

function normalizeHorizonValues(values: readonly number[]): number[] {
  const unique = uniqueValues(values, 'horizons')
  return [...unique].sort((left, right) => left - right)
}

function normalizeBenchmark(includeBenchmark: boolean, benchmarkTsCode?: string): string | null {
  if (!includeBenchmark && benchmarkTsCode) {
    throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: includeBenchmark=false 时禁止 benchmarkTsCode')
  }
  const resolved = benchmarkTsCode ?? '000300.SH'
  if (includeBenchmark && resolved !== '000300.SH') {
    throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: v1 仅支持基准 000300.SH')
  }
  return includeBenchmark ? resolved : null
}

function normalizeQualityStatuses(values?: readonly string[]): string[] | undefined {
  if (!values) return undefined
  const unique = uniqueValues(values, 'qualityStatuses')
  const allowed = new Set(['VALID', 'IMMATURE', 'MISSING'])
  if (unique.some((value) => !allowed.has(value))) {
    throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: qualityStatuses 含无效状态')
  }
  return unique
}

function uniqueValues<T>(values: readonly T[], field: string): T[] {
  const serialized = values.map((value) => JSON.stringify(value))
  if (new Set(serialized).size !== values.length) {
    throw new BadRequestException(`TECHNICAL_SIGNAL_REQUEST_INVALID: ${field} 存在重复值`)
  }
  return [...values]
}

function assertValidOptionalCompactDate(value: string | undefined, fieldName: string): void {
  if (!value) return
  try {
    parseCompactTradeDateToUtcDate(value, fieldName)
  } catch {
    throw new BadRequestException(`TECHNICAL_SIGNAL_REQUEST_INVALID: ${fieldName} 必须为有效 YYYYMMDD 日期`)
  }
}

function subtractCalendarYears(compactDate: string, years: number): string {
  const year = Number(compactDate.slice(0, 4)) - years
  const month = Number(compactDate.slice(4, 6))
  const day = Number(compactDate.slice(6, 8))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}${String(month).padStart(2, '0')}${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function earliestActualStartDate(windows: readonly PeriodWindow[]): string | undefined {
  return windows
    .map((window) => window.actualStartDate)
    .filter((date): date is string => date !== null)
    .sort()[0]
}

function latestWindowEndDate(windows: readonly PeriodWindow[]): string | undefined {
  return [...windows]
    .map((window) => window.endDate)
    .sort()
    .at(-1)
}

function buildStatisticsCachePayload(query: NormalizedQuery, timeline: TechnicalSignalTimelineSnapshot) {
  return {
    request: {
      tsCode: query.tsCode,
      signals: [...query.definitions]
        .map((definition) => ({
          signalKey: definition.signalKey,
          semanticsVersion: definition.semanticsVersion,
          definitionHash: definition.definitionHash,
        }))
        .sort((left, right) =>
          `${left.signalKey}|${left.semanticsVersion}`.localeCompare(`${right.signalKey}|${right.semanticsVersion}`),
        ),
      periods: [...query.periods].sort(),
      customStartDate: query.customStartDate ?? null,
      customEndDate: query.customEndDate ?? null,
      horizons: [...query.horizons],
      requestedAsOf: query.requestedAsOf ?? null,
      entryMode: query.entryMode,
      includeBenchmark: query.includeBenchmark,
      benchmarkTsCode: query.benchmarkTsCode,
    },
    stock: {
      name: timeline.stock.name,
      exchange: timeline.stock.exchange,
      listDate: timeline.stock.listDate,
      delistDate: timeline.stock.delistDate,
    },
    dataAsOf: timeline.dataAsOf,
    dataVersions: Object.fromEntries(
      Object.entries(timeline.dataVersions).sort(([left], [right]) => left.localeCompare(right)),
    ),
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    statisticsAlgorithmVersion: STATISTICS_ALGORITHM_VERSION,
    returnPolicyVersion: RETURN_POLICY_VERSION,
    confidenceIntervalVersion: CONFIDENCE_INTERVAL_VERSION,
  }
}

function stableSignalId(tsCode: string, occurrence: TechnicalSignalOccurrence): string {
  return createHash('sha256')
    .update(
      `${tsCode}|${occurrence.signalKey}|${occurrence.semanticsVersion}|${occurrence.signalDate}|${occurrence.source}`,
    )
    .digest('hex')
}

function toPct(value: number | null): number | null {
  return value === null ? null : Number((value * 100).toFixed(6))
}
