import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { TECHNICAL_SIGNAL_DEFINITIONS } from './domain'
import { TechnicalSignalEntryMode, TechnicalSignalPeriod } from './dto/technical-signal-request.dto'
import { PrismaTechnicalSignalRepository } from './repositories/prisma-technical-signal.repository'
import { TechnicalSignalEvaluationService } from './services/technical-signal-evaluation.service'
import { TechnicalSignalStatisticsService } from './services/technical-signal-statistics.service'

export const TECHNICAL_SIGNAL_TOOL_SECTIONS = ['CURRENT', 'OCCURRENCES', 'STATISTICS'] as const
export type TechnicalSignalToolSection = (typeof TECHNICAL_SIGNAL_TOOL_SECTIONS)[number]

export interface TechnicalSignalToolInput {
  tsCode: string
  asOfDate?: string
  sections?: TechnicalSignalToolSection[]
  signalKeys?: string[]
  lookbackTradeDays?: number
  occurrenceLimit?: number
  horizons?: number[]
  statisticsPeriod?: 'ONE_YEAR' | 'THREE_YEARS'
  includeBenchmark?: boolean
}

export class TechnicalSignalToolError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'DATA_NOT_FOUND' | 'DATA_NOT_READY' | 'RESULT_TOO_LARGE' | 'UPSTREAM_FAILED',
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = TechnicalSignalToolError.name
  }
}

@Injectable()
export class TechnicalSignalToolFacade {
  constructor(
    private readonly repository: PrismaTechnicalSignalRepository,
    private readonly evaluation: TechnicalSignalEvaluationService,
    private readonly statistics: TechnicalSignalStatisticsService,
  ) {}

  async getSignals(input: TechnicalSignalToolInput) {
    const normalized = normalizeInput(input)
    try {
      const requestedCompact = normalized.asOfDate?.replaceAll('-', '')
      const readyAsOf = await this.repository.resolveReadyAsOf(normalized.tsCode, requestedCompact)
      const evaluated = await this.evaluation.evaluate({
        tsCode: normalized.tsCode,
        requestedAsOf: readyAsOf,
        signalKeys: normalized.signalKeys,
        lookbackTradeDays: normalized.lookbackTradeDays,
      })
      if (evaluated.current.every((item) => !item.evaluable)) {
        throw new TechnicalSignalToolError('DATA_NOT_READY', '全部所选技术信号均因历史不足而不可计算', true)
      }

      const requestedSections = new Set(normalized.sections)
      const warnings: Array<{ code: string; message: string; affectedFields?: string[] }> = []
      if (requestedCompact && requestedCompact !== readyAsOf) {
        warnings.push({
          code: 'LATEST_READY_TRADE_DATE_USED',
          message: `请求日期没有完整信号数据，已使用最近 READY 交易日 ${toIsoDate(readyAsOf)}`,
        })
      }
      if (evaluated.historyTruncated) {
        warnings.push({
          code: 'BOUNDED_CALCULATION_WINDOW',
          message: `标准信号使用从 ${toIsoDate(evaluated.historyStart)} 开始的固定预热窗口计算，早期历史缺口不影响本次近期判断`,
        })
      }
      if (!requestedSections.has('OCCURRENCES') && input.occurrenceLimit !== undefined) {
        warnings.push({ code: 'UNUSED_INPUT_IGNORED', message: '未请求 OCCURRENCES，occurrenceLimit 已忽略' })
      }
      if (
        !requestedSections.has('STATISTICS') &&
        (input.horizons !== undefined || input.statisticsPeriod !== undefined || input.includeBenchmark !== undefined)
      ) {
        warnings.push({
          code: 'UNUSED_INPUT_IGNORED',
          message: '未请求 STATISTICS，horizons、statisticsPeriod 和 includeBenchmark 已忽略',
        })
      }

      let statisticsSection: SectionResult<unknown> = notRequested()
      if (requestedSections.has('STATISTICS')) {
        try {
          const statistics = await this.statistics.query({
            tsCode: normalized.tsCode,
            signals: normalized.signalKeys.map((signalKey) => ({ signalKey })),
            periods: [
              normalized.statisticsPeriod === 'THREE_YEARS'
                ? TechnicalSignalPeriod.THREE_YEARS
                : TechnicalSignalPeriod.ONE_YEAR,
            ],
            horizons: normalized.horizons,
            asOfTradeDate: readyAsOf,
            entryMode: TechnicalSignalEntryMode.SIGNAL_CLOSE,
            includeBenchmark: normalized.includeBenchmark,
            ...(normalized.includeBenchmark ? { benchmarkTsCode: '000300.SH' } : {}),
          })
          statisticsSection = ok(statistics.groups)
        } catch (error) {
          statisticsSection = {
            status: 'ERROR',
            data: null,
            error: { code: sectionErrorCode(error), message: '技术信号统计分区暂时不可用' },
          }
          warnings.push({ code: 'PARTIAL_SECTION_FAILURE', message: '技术信号统计分区暂时不可用' })
        }
      }

      const occurrences = evaluated.occurrences.slice(0, normalized.occurrenceLimit).map((occurrence) => ({
        ...occurrence,
        signalDate: toIsoDate(occurrence.signalDate),
      }))
      const current = evaluated.current.map((item) => ({
        ...item,
        latestOccurrenceDate: item.latestOccurrenceDate ? toIsoDate(item.latestOccurrenceDate) : null,
      }))
      return {
        data: {
          meta: {
            tsCode: evaluated.tsCode,
            name: evaluated.name,
            requestedAsOfDate: normalized.asOfDate ?? null,
            dataThrough: toIsoDate(evaluated.dataThrough),
            calculationHistoryStart: toIsoDate(evaluated.historyStart),
            source: 'LOCAL_QFQ_OHLCV' as const,
            adjustment: 'ADJ_FACTOR_RATIO' as const,
            algorithmVersion: evaluated.algorithmVersion,
            catalogVersion: evaluated.catalogVersion,
          },
          current: requestedSections.has('CURRENT') ? ok(current) : notRequested(),
          occurrences: requestedSections.has('OCCURRENCES') ? ok(occurrences) : notRequested(),
          statistics: statisticsSection,
          buySignalTriggered: current.some((item) => item.direction === 'BULLISH' && item.triggeredOnDataThrough),
          sellSignalTriggered: current.some((item) => item.direction === 'BEARISH' && item.triggeredOnDataThrough),
        },
        warnings,
        definitionHashes: current.map((item) => item.definitionHash),
      }
    } catch (error) {
      throw normalizeError(error)
    }
  }
}

type SectionResult<T> =
  | { status: 'OK'; data: T; error: null }
  | { status: 'NOT_REQUESTED'; data: null; error: null }
  | { status: 'ERROR'; data: null; error: { code: string; message: string } }

function ok<T>(data: T): SectionResult<T> {
  return { status: 'OK', data, error: null }
}

function notRequested(): SectionResult<never> {
  return { status: 'NOT_REQUESTED', data: null, error: null }
}

function normalizeInput(input: TechnicalSignalToolInput) {
  const tsCode = input.tsCode?.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'tsCode 必须为 A 股代码，例如 600089.SH')
  }
  if (input.asOfDate) assertIsoDate(input.asOfDate)
  const sections = input.sections?.length ? [...input.sections] : (['CURRENT'] as TechnicalSignalToolSection[])
  if (
    sections.length < 1 ||
    sections.length > 3 ||
    new Set(sections).size !== sections.length ||
    sections.some((value) => !TECHNICAL_SIGNAL_TOOL_SECTIONS.includes(value))
  ) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'sections 非法或包含重复值')
  }
  const catalog = new Set(TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => definition.signalKey))
  const signalKeys = input.signalKeys?.length ? [...input.signalKeys] : [...catalog]
  if (
    signalKeys.length < 1 ||
    signalKeys.length > 14 ||
    new Set(signalKeys).size !== signalKeys.length ||
    signalKeys.some((key) => !catalog.has(key))
  ) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'signalKeys 包含未知或重复的标准信号')
  }
  const lookbackTradeDays = input.lookbackTradeDays ?? 60
  if (!Number.isInteger(lookbackTradeDays) || lookbackTradeDays < 20 || lookbackTradeDays > 1250) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'lookbackTradeDays 必须是 20-1250 的整数')
  }
  const occurrenceLimit = input.occurrenceLimit ?? 20
  if (!Number.isInteger(occurrenceLimit) || occurrenceLimit < 1 || occurrenceLimit > 100) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'occurrenceLimit 必须是 1-100 的整数')
  }
  const horizons = input.horizons?.length ? [...input.horizons] : [1, 3, 5, 10, 20]
  if (
    horizons.length < 1 ||
    horizons.length > 10 ||
    new Set(horizons).size !== horizons.length ||
    horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 60)
  ) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'horizons 必须是 1-60 的不重复整数，最多 10 个')
  }
  return {
    tsCode,
    asOfDate: input.asOfDate,
    sections,
    signalKeys,
    lookbackTradeDays,
    occurrenceLimit,
    horizons,
    statisticsPeriod: input.statisticsPeriod ?? ('ONE_YEAR' as const),
    includeBenchmark: input.includeBenchmark ?? false,
  }
}

function normalizeError(error: unknown): TechnicalSignalToolError {
  if (error instanceof TechnicalSignalToolError) return error
  if (error instanceof NotFoundException)
    return new TechnicalSignalToolError('DATA_NOT_FOUND', '股票不存在或请求时点早于上市日')
  if (error instanceof BadRequestException)
    return new TechnicalSignalToolError('INVALID_ARGUMENT', '技术信号请求参数非法')
  if (error instanceof UnprocessableEntityException) {
    const message = error.message.includes('HISTORY_LIMIT') ? '技术信号历史超过服务硬上限' : '技术信号历史不足'
    return new TechnicalSignalToolError(
      error.message.includes('HISTORY_LIMIT') ? 'RESULT_TOO_LARGE' : 'DATA_NOT_READY',
      message,
      !error.message.includes('HISTORY_LIMIT'),
    )
  }
  if (error instanceof ConflictException)
    return new TechnicalSignalToolError('DATA_NOT_READY', '技术信号数据尚未 READY', true)
  return new TechnicalSignalToolError('UPSTREAM_FAILED', '技术信号计算服务暂时不可用', true)
}

function sectionErrorCode(error: unknown): string {
  if (error instanceof ConflictException) return 'DATA_NOT_READY'
  if (error instanceof UnprocessableEntityException) return 'INSUFFICIENT_HISTORY'
  return 'UPSTREAM_FAILED'
}

function assertIsoDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (
    !match ||
    !parsed ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new TechnicalSignalToolError('INVALID_ARGUMENT', 'asOfDate 必须为有效的 YYYY-MM-DD')
  }
}

function toIsoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}
