import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  createQfqBars,
  detectTechnicalSignalOccurrences,
  TechnicalIndicatorEngine,
  TECHNICAL_INDICATOR_ALGORITHM_VERSION,
  type IndicatorPoint,
  type TechnicalSignalDefinition,
  type TechnicalSignalOccurrence,
} from '../domain'
import {
  PrismaTechnicalSignalRepository,
  type TechnicalSignalTimelineSnapshot,
} from '../repositories/prisma-technical-signal.repository'
import { TechnicalSignalDefinitionService } from './technical-signal-definition.service'

const EVALUATION_WARMUP_TRADE_DAYS = 250

export interface TechnicalSignalEvaluationQuery {
  tsCode: string
  requestedAsOf?: string
  signalKeys: string[]
  lookbackTradeDays: number
}

export interface TechnicalSignalEvaluation {
  tsCode: string
  name: string | null
  dataThrough: string
  catalogVersion: string
  algorithmVersion: typeof TECHNICAL_INDICATOR_ALGORITHM_VERSION
  historyStart: string
  historyTruncated: boolean
  current: Array<{
    signalKey: string
    displayName: string
    direction: TechnicalSignalDefinition['direction']
    semanticsVersion: string
    definitionHash: string
    evaluable: boolean
    notEvaluableReason: string | null
    triggeredOnDataThrough: boolean
    latestOccurrenceDate: string | null
    evidence: TechnicalSignalOccurrence['evidence'] | null
  }>
  occurrences: TechnicalSignalOccurrence[]
  timeline: TechnicalSignalTimelineSnapshot
}

@Injectable()
export class TechnicalSignalEvaluationService {
  private readonly indicatorEngine = new TechnicalIndicatorEngine()

  constructor(
    private readonly repository: PrismaTechnicalSignalRepository,
    private readonly definitions: TechnicalSignalDefinitionService,
  ) {}

  async evaluate(query: TechnicalSignalEvaluationQuery): Promise<TechnicalSignalEvaluation> {
    const definitions = this.definitions
      .resolveSelectors(query.signalKeys.map((signalKey) => ({ signalKey })))
      .sort((left, right) => left.signalKey.localeCompare(right.signalKey))
    const timeline = await this.repository.loadTimeline({
      tsCode: query.tsCode,
      requestedAsOf: query.requestedAsOf,
      maxHorizon: 0,
      includeBenchmark: false,
      benchmarkTsCode: null,
      historyTradeDays: query.lookbackTradeDays + EVALUATION_WARMUP_TRADE_DAYS,
    })
    const readyDates = timeline.openDates.filter((date) => date <= timeline.dataAsOf)
    const windowStartDate = readyDates[Math.max(0, readyDates.length - query.lookbackTradeDays)] ?? timeline.dataAsOf
    const evaluated = this.evaluateTimeline({
      timeline,
      definitions,
      windowStartDate,
      windowEndDate: timeline.dataAsOf,
    })
    const points = evaluated.points
    const previous = points.at(-2)
    const currentPoint = points.at(-1)
    const occurrences = [...evaluated.occurrences].sort(
      (left, right) => right.signalDate.localeCompare(left.signalDate) || left.signalKey.localeCompare(right.signalKey),
    )

    return {
      tsCode: timeline.stock.tsCode,
      name: timeline.stock.name,
      dataThrough: timeline.dataAsOf,
      catalogVersion: catalogVersion(definitions),
      algorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
      historyStart: timeline.historyStart,
      historyTruncated: timeline.historyStart > timeline.stock.listDate,
      current: definitions.map((definition) => {
        const evaluable = Boolean(
          previous &&
          currentPoint &&
          definition.requiredFields.every((field) => isPresent(previous[field]) && isPresent(currentPoint[field])),
        )
        const latest = occurrences.find((occurrence) => occurrence.signalKey === definition.signalKey)
        const triggered = latest?.signalDate === timeline.dataAsOf
        return {
          signalKey: definition.signalKey,
          displayName: definition.displayName,
          direction: definition.direction,
          semanticsVersion: definition.semanticsVersion,
          definitionHash: definition.definitionHash,
          evaluable,
          notEvaluableReason: evaluable ? null : 'INSUFFICIENT_HISTORY_OR_FIELDS',
          triggeredOnDataThrough: triggered,
          latestOccurrenceDate: latest?.signalDate ?? null,
          evidence: triggered ? latest.evidence : null,
        }
      }),
      occurrences,
      timeline,
    }
  }

  evaluateTimeline(input: {
    timeline: TechnicalSignalTimelineSnapshot
    definitions: readonly TechnicalSignalDefinition[]
    windowStartDate?: string
    windowEndDate?: string
  }): { points: IndicatorPoint[]; occurrences: TechnicalSignalOccurrence[] } {
    const points = this.indicatorEngine.compute(createQfqBars(input.timeline.bars))
    const occurrences = detectTechnicalSignalOccurrences(points, {
      definitions: input.definitions,
      ...(input.windowStartDate ? { windowStartDate: input.windowStartDate } : {}),
      ...(input.windowEndDate ? { windowEndDate: input.windowEndDate } : {}),
    })
    return { points, occurrences }
  }
}

function isPresent(value: IndicatorPoint[keyof IndicatorPoint]): boolean {
  return typeof value === 'number' ? Number.isFinite(value) : value !== null && value !== undefined
}

function catalogVersion(definitions: readonly TechnicalSignalDefinition[]): string {
  const digest = createHash('sha256')
    .update(definitions.map((definition) => `${definition.signalKey}:${definition.definitionHash}`).join('|'))
    .digest('hex')
    .slice(0, 16)
  return `technical-signal-catalog.v1:${digest}`
}
