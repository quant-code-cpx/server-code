import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  MarketMultiAssetToolError,
  type MarketMultiAssetWarning,
  isoToCompactDate,
  parseIsoDate,
  requireInteger,
  toIsoDate,
  validateDateRange,
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import type { EventStudyAnalyzeDto } from './dto/event-study-analyze.dto'
import { EVENT_TYPE_CONFIGS, EventType } from './event-type.registry'
import { EventStudyService } from './event-study.service'
import { EventStudyToolRepository, type EventStudyPriceWindow } from './event-study-tool.repository'

export const EVENT_STUDY_BENCHMARKS = ['000300.SH', '000905.SH', '000852.SH', '000001.SH', '399006.SZ'] as const
export const EVENT_STUDY_ALGORITHM_VERSION = 'event-study.market-adjusted.v1' as const

export interface EventStudyToolInput {
  eventType: EventType
  tsCode?: string
  startDate?: string
  endDate?: string
  preTradeDays?: number
  postTradeDays?: number
  benchmarkCode?: (typeof EVENT_STUDY_BENCHMARKS)[number]
  minSamples?: number
  maxSamples?: number
  includeTopSamples?: boolean
}

interface SelectedEvent {
  eventKey: string
  tsCode: string
  eventDate: string
}

interface WindowedEvent extends SelectedEvent {
  eventTradeDate: string
  tradeDates: string[]
}

interface ValidSample {
  tsCode: string
  name: string | null
  eventDate: string
  eventTradeDate: string
  finalCar: number
  arSeries: number[]
}

@Injectable()
export class EventStudyToolFacade {
  constructor(
    private readonly eventStudyService: EventStudyService,
    private readonly repository: EventStudyToolRepository,
  ) {}

  async run(input: EventStudyToolInput) {
    const eventTypes = Object.values(EventType)
    if (!eventTypes.includes(input.eventType)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `eventType 仅支持 ${eventTypes.join('、')}`)
    }
    const tsCode = input.tsCode?.trim().toUpperCase()
    if (tsCode && !/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'tsCode 必须是带交易所后缀的股票代码')
    }
    const benchmarkCode = input.benchmarkCode ?? '000300.SH'
    if (!EVENT_STUDY_BENCHMARKS.includes(benchmarkCode)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'benchmarkCode 不在允许目录中')
    }
    const requestedEndDate = parseIsoDate(input.endDate, 'endDate')
    const endDate = requestedEndDate ?? (await this.repository.findBenchmarkDataThrough(benchmarkCode))
    if (!endDate) throw new MarketMultiAssetToolError('DATA_NOT_READY', `基准 ${benchmarkCode} 行情尚未就绪`)
    const defaultStart = new Date(endDate)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 3)
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? defaultStart
    validateDateRange(startDate, endDate, 3_653)
    const preTradeDays = input.preTradeDays ?? 5
    const postTradeDays = input.postTradeDays ?? 20
    const maxSamples = input.maxSamples ?? 500
    const minSamples = input.minSamples ?? (tsCode ? 1 : 10)
    requireInteger(preTradeDays, 'preTradeDays', 0, 20)
    requireInteger(postTradeDays, 'postTradeDays', 1, 60)
    requireInteger(maxSamples, 'maxSamples', 10, 500)
    requireInteger(minSamples, 'minSamples', 1, 100)
    if (!tsCode && minSamples < 10) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', '市场样本 minSamples 不能小于 10')
    }
    if (minSamples > maxSamples) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'minSamples 不能大于 maxSamples')
    }
    const extracted = await this.eventStudyService.extractEventSamples(
      {
        eventType: input.eventType,
        tsCode,
        startDate: isoToCompactDate(toIsoDate(startDate)),
        endDate: isoToCompactDate(toIsoDate(endDate)),
      } as EventStudyAnalyzeDto,
      10_000,
    )
    const unique = deduplicateEvents(extracted)
    const selected = deterministicSample(unique, maxSamples)
    if (!selected.length) {
      throw new MarketMultiAssetToolError('DATA_NOT_READY', '请求范围内没有符合定义的事件样本')
    }

    const bufferDays = Math.ceil((preTradeDays + postTradeDays + 1) * 2.5) + 30
    const calendarStart = addDays(startDate, -bufferDays)
    const calendarEnd = addDays(endDate, bufferDays)
    const tradeDays = (await this.repository.findTradeDays(calendarStart, calendarEnd)).map((row) =>
      toIsoDate(row.calDate),
    )
    if (!tradeDays.length) throw new MarketMultiAssetToolError('DATA_NOT_READY', '事件窗口缺少交易日历')

    const exclusionReasons: Record<string, number> = {}
    if (unique.length > selected.length) exclusionReasons.MAX_SAMPLES_LIMIT = unique.length - selected.length
    const windowed: WindowedEvent[] = []
    for (const event of selected) {
      const eventIndex = lowerBound(tradeDays, event.eventDate)
      if (eventIndex < preTradeDays || eventIndex < 0 || eventIndex + postTradeDays >= tradeDays.length) {
        increment(exclusionReasons, 'WINDOW_OUT_OF_RANGE')
        continue
      }
      windowed.push({
        ...event,
        eventTradeDate: tradeDays[eventIndex],
        tradeDates: tradeDays.slice(eventIndex - preTradeDays, eventIndex + postTradeDays + 1),
      })
    }
    if (!windowed.length) throw new MarketMultiAssetToolError('DATA_NOT_READY', '全部事件样本均缺少完整交易窗口')

    const rangeStart = windowed.reduce(
      (value, event) => (event.tradeDates[0] < value ? event.tradeDates[0] : value),
      windowed[0].tradeDates[0],
    )
    const rangeEnd = windowed.reduce(
      (value, event) => (event.tradeDates.at(-1)! > value ? event.tradeDates.at(-1)! : value),
      windowed[0].tradeDates.at(-1)!,
    )
    const windows: EventStudyPriceWindow[] = windowed.map((event) => ({
      eventKey: event.eventKey,
      tsCode: event.tsCode,
      startDate: new Date(`${event.tradeDates[0]}T00:00:00.000Z`),
      endDate: new Date(`${event.tradeDates.at(-1)}T00:00:00.000Z`),
    }))
    const [benchmarkRows, stockRows, nameRows] = await Promise.all([
      this.repository.findBenchmarkReturns(
        benchmarkCode,
        new Date(`${rangeStart}T00:00:00.000Z`),
        new Date(`${rangeEnd}T00:00:00.000Z`),
      ),
      this.repository.findWindowReturns(windows),
      this.repository.findStockNames([...new Set(windowed.map((event) => event.tsCode))]),
    ])
    const benchmarkReturns = new Map(
      benchmarkRows
        .filter((row): row is typeof row & { pctChg: number } => row.pctChg !== null)
        .map((row) => [toIsoDate(row.tradeDate), row.pctChg]),
    )
    const stockReturns = new Map(
      stockRows
        .filter((row): row is typeof row & { pctChg: number } => row.pctChg !== null)
        .map((row) => [`${row.eventKey}:${toIsoDate(row.tradeDate)}`, Number(row.pctChg)]),
    )
    const names = new Map(nameRows.map((row) => [row.tsCode, row.name]))
    const valid: ValidSample[] = []
    for (const event of windowed) {
      if (event.tradeDates.some((date) => !stockReturns.has(`${event.eventKey}:${date}`))) {
        increment(exclusionReasons, 'STOCK_RETURN_MISSING')
        continue
      }
      if (event.tradeDates.some((date) => !benchmarkReturns.has(date))) {
        increment(exclusionReasons, 'BENCHMARK_RETURN_MISSING')
        continue
      }
      const arSeries = event.tradeDates.map((date) =>
        round(stockReturns.get(`${event.eventKey}:${date}`)! - benchmarkReturns.get(date)!, 6),
      )
      valid.push({
        tsCode: event.tsCode,
        name: names.get(event.tsCode) ?? null,
        eventDate: event.eventDate,
        eventTradeDate: event.eventTradeDate,
        finalCar: round(
          arSeries.reduce((sum, value) => sum + value, 0),
          6,
        ),
        arSeries,
      })
    }
    if (valid.length < minSamples) {
      throw new MarketMultiAssetToolError(
        'DATA_NOT_READY',
        `有效事件样本 ${valid.length} 个，少于 minSamples=${minSamples}；排除原因 ${JSON.stringify(exclusionReasons)}`,
      )
    }

    const series = aggregateSeries(valid, preTradeDays, postTradeDays)
    const finalCars = valid.map((sample) => sample.finalCar)
    const finalCar = summarizeFinalCar(finalCars)
    const warnings: MarketMultiAssetWarning[] = [
      {
        code: 'STATISTICAL_SIGNIFICANCE_NOT_TRADING_ADVICE',
        message: '统计显著性不等于经济可交易性，结果未计入交易成本、涨跌停和停牌约束',
      },
    ]
    if (valid.length < 30) {
      warnings.push({
        code: 'SMALL_SAMPLE_NORMAL_APPROXIMATION',
        message: '样本少于 30，双侧 pValue 使用正态近似，仅供探索',
      })
    }
    if (extracted.length === 10_000) {
      warnings.push({ code: 'EVENT_UNIVERSE_CAPPED', message: '候选事件读取达到 10000 条上限，样本总体可能被截断' })
    }
    const actualDates = valid.map((sample) => sample.eventDate).sort()
    const sorted = [...valid].sort(
      (left, right) =>
        right.finalCar - left.finalCar ||
        left.eventDate.localeCompare(right.eventDate) ||
        left.tsCode.localeCompare(right.tsCode),
    )
    return {
      data: {
        eventType: input.eventType,
        eventLabel: EVENT_TYPE_CONFIGS[input.eventType].label,
        requestedRange: { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) },
        actualEventRange: { startDate: actualDates[0] ?? null, endDate: actualDates.at(-1) ?? null },
        benchmarkCode,
        preTradeDays,
        postTradeDays,
        sampleCount: valid.length,
        excludedSampleCount: Object.values(exclusionReasons).reduce((sum, value) => sum + value, 0),
        exclusionReasons,
        aarSeries: series.aarSeries,
        caarSeries: series.caarSeries,
        finalCar,
        topPositiveSamples: input.includeTopSamples
          ? sorted
              .filter((sample) => sample.finalCar >= 0)
              .slice(0, 10)
              .map(publicSample)
          : null,
        topNegativeSamples: input.includeTopSamples
          ? sorted
              .filter((sample) => sample.finalCar < 0)
              .slice(-10)
              .reverse()
              .map(publicSample)
          : null,
        algorithmVersion: EVENT_STUDY_ALGORITHM_VERSION,
        eventDefinitionHash: eventDefinitionHash(input.eventType),
      },
      warnings,
      truncated: extracted.length === 10_000 || unique.length > selected.length,
    }
  }
}

function deduplicateEvents(events: Array<{ tsCode: string; eventDate: string }>): SelectedEvent[] {
  const unique = new Map<string, SelectedEvent>()
  for (const event of events) {
    const eventKey = `${event.tsCode}:${event.eventDate}`
    unique.set(eventKey, { eventKey, tsCode: event.tsCode, eventDate: event.eventDate })
  }
  return [...unique.values()]
}

function deterministicSample(events: SelectedEvent[], maximum: number): SelectedEvent[] {
  return [...events]
    .sort(
      (left, right) =>
        stableHash(left.eventKey).localeCompare(stableHash(right.eventKey)) ||
        left.eventKey.localeCompare(right.eventKey),
    )
    .slice(0, maximum)
}

function stableHash(value: string): string {
  return createHash('sha256').update(`${EVENT_STUDY_ALGORITHM_VERSION}:${value}`).digest('hex')
}

function eventDefinitionHash(eventType: EventType): string {
  return createHash('sha256')
    .update(`${EVENT_STUDY_ALGORITHM_VERSION}:${eventType}:${JSON.stringify(EVENT_TYPE_CONFIGS[eventType])}`)
    .digest('hex')
}

function lowerBound(values: string[], target: string): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low < values.length ? low : -1
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function increment(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1
}

function aggregateSeries(samples: ValidSample[], preDays: number, postDays: number) {
  let cumulative = 0
  const aarSeries: Array<{ relativeDay: number; value: number; sampleCount: number }> = []
  const caarSeries: Array<{ relativeDay: number; value: number; sampleCount: number }> = []
  for (let index = 0; index < preDays + postDays + 1; index += 1) {
    const average = samples.reduce((sum, sample) => sum + sample.arSeries[index], 0) / samples.length
    cumulative += average
    aarSeries.push({ relativeDay: index - preDays, value: round(average, 6), sampleCount: samples.length })
    caarSeries.push({ relativeDay: index - preDays, value: round(cumulative, 6), sampleCount: samples.length })
  }
  return { aarSeries, caarSeries }
}

function summarizeFinalCar(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const median =
    sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const variance =
    values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0
  const standardError = values.length > 1 ? Math.sqrt(variance / values.length) : 0
  const tStatistic = standardError > 0 ? mean / standardError : null
  const pValue = tStatistic === null ? null : Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(tStatistic)))))
  return {
    mean: round(mean, 6),
    median: round(median, 6),
    positiveRate: round(values.filter((value) => value > 0).length / values.length, 6),
    tStatistic: tStatistic === null ? null : round(tStatistic, 6),
    pValue: pValue === null ? null : round(pValue, 6),
  }
}

function normalCdf(value: number): number {
  const t = 1 / (1 + 0.2316419 * value)
  const density = Math.exp((-value * value) / 2) / Math.sqrt(2 * Math.PI)
  const tail =
    density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - tail
}

function publicSample(sample: ValidSample) {
  return {
    tsCode: sample.tsCode,
    name: sample.name,
    eventDate: sample.eventDate,
    eventTradeDate: sample.eventTradeDate,
    finalCar: sample.finalCar,
  }
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}
