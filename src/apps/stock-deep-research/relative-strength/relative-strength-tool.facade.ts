import { Injectable } from '@nestjs/common'
import {
  assertStockExists,
  finiteOrNull,
  normalizeSections,
  normalizeTsCode,
  normalizeUnexpectedError,
  notRequested,
  ok,
  parseIsoDate,
  requireInteger,
  StockDeepResearchToolError,
  type StockDeepResearchWarning,
  toIsoDate,
} from '../stock-deep-research.types'
import { RelativeStrengthCalculationService, type RelativeStrengthPoint } from './relative-strength-calculation.service'
import { RelativeStrengthRepository } from './relative-strength.repository'

export const RELATIVE_STRENGTH_SECTIONS = ['SUMMARY', 'SERIES'] as const
export type RelativeStrengthSection = (typeof RELATIVE_STRENGTH_SECTIONS)[number]

export interface StockRelativeStrengthInput {
  tsCode: string
  benchmarkCode?: string
  asOfDate?: string
  lookbackTradeDays?: number
  sections?: RelativeStrengthSection[]
}

@Injectable()
export class RelativeStrengthToolFacade {
  constructor(
    private readonly repository: RelativeStrengthRepository,
    private readonly calculation: RelativeStrengthCalculationService,
  ) {}

  async getRelativeStrength(input: StockRelativeStrengthInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const benchmarkCode = normalizeBenchmarkCode(input.benchmarkCode ?? '000300.SH')
    const asOf = parseIsoDate(input.asOfDate)
    const lookback = input.lookbackTradeDays ?? 120
    requireInteger(lookback, 'lookbackTradeDays', 20, 1_250)
    const sections = normalizeSections(input.sections, RELATIVE_STRENGTH_SECTIONS, ['SUMMARY'])

    try {
      await assertStockExists((code) => this.repository.findStock(code), tsCode)
      const coverage = await this.repository.findCoverage(tsCode, benchmarkCode)
      if (!coverage.stock) throw new StockDeepResearchToolError('DATA_NOT_READY', `${tsCode} 的日线尚未入库`, true)
      if (!coverage.benchmark) {
        throw new StockDeepResearchToolError('DATA_NOT_FOUND', `基准指数无本地日线：${benchmarkCode}`)
      }
      const coverageStartDate = coverage.stock > coverage.benchmark ? coverage.stock : coverage.benchmark
      if (asOf && asOf < coverageStartDate) {
        throw new StockDeepResearchToolError('DATA_NOT_FOUND', '请求日期早于个股与基准的共同覆盖起点')
      }
      const rows = await this.repository.findRows(tsCode, benchmarkCode, asOf, Math.min(2_500, lookback * 2))
      const factorMap = new Map(rows.factors.map((row) => [toIsoDate(row.tradeDate), finiteOrNull(row.adjFactor)]))
      const latestFactor = rows.stock
        .map((row) => factorMap.get(toIsoDate(row.tradeDate)) ?? null)
        .find((value) => value !== null)
      const stockMap = new Map(
        rows.stock.flatMap((row) => {
          const close = finiteOrNull(row.close)
          const factor = factorMap.get(toIsoDate(row.tradeDate)) ?? null
          if (close === null) return []
          const qfq = factor !== null && latestFactor ? (close * factor) / latestFactor : close
          return [[toIsoDate(row.tradeDate), qfq] as const]
        }),
      )
      const points: RelativeStrengthPoint[] = rows.benchmark
        .flatMap((row) => {
          const date = toIsoDate(row.tradeDate)
          const stockClose = stockMap.get(date)
          const benchmarkClose = finiteOrNull(row.close)
          return stockClose && benchmarkClose && stockClose > 0 && benchmarkClose > 0
            ? [{ tradeDate: date, stockClose, benchmarkClose }]
            : []
        })
        .reverse()
        .slice(-lookback)
      if (points.length < 2) {
        throw new StockDeepResearchToolError('DATA_NOT_READY', '个股与基准没有足够的共同交易日', true)
      }
      const result = this.calculation.calculate(points)
      const requested = new Set(sections)
      const warnings: StockDeepResearchWarning[] = []
      if (points.length < 20) {
        warnings.push({ code: 'INSUFFICIENT_COMMON_TRADE_DAYS', message: '共同交易日少于 20，beta 和信息比率不可计算' })
      }
      if (points.length < lookback) {
        warnings.push({
          code: 'LOOKBACK_PARTIAL',
          message: `仅找到 ${points.length} 个共同交易日，少于请求的 ${lookback} 日`,
        })
      }
      const dataThrough = points.at(-1)!.tradeDate
      if (input.asOfDate && input.asOfDate !== dataThrough) {
        warnings.push({ code: 'LATEST_COMMON_TRADE_DATE_USED', message: `已使用最近共同交易日 ${dataThrough}` })
      }
      return {
        data: {
          meta: {
            tsCode,
            requestedAsOfDate: input.asOfDate ?? null,
            dataThrough,
            coverageStart: toIsoDate(coverageStartDate),
            timezone: 'Asia/Shanghai' as const,
            benchmarkCode,
            benchmarkName: benchmarkName(benchmarkCode),
            commonTradeDays: points.length,
            adjustment: 'QFQ_RATIO' as const,
            algorithmVersion: 'relative-strength.v1' as const,
          },
          summary: requested.has('SUMMARY') ? ok(result.summary) : notRequested(),
          series: requested.has('SERIES') ? ok(result.series) : notRequested(),
        },
        warnings,
      }
    } catch (error) {
      throw normalizeUnexpectedError(error, '相对强弱计算暂时失败')
    }
  }
}

function normalizeBenchmarkCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|CSI)$/.test(code)) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', 'benchmarkCode 必须为指数代码，例如 000300.SH')
  }
  return code
}

function benchmarkName(code: string): string | null {
  return (
    (
      {
        '000300.SH': '沪深300',
        '000905.SH': '中证500',
        '000852.SH': '中证1000',
        '000001.SH': '上证指数',
        '399001.SZ': '深证成指',
        '399006.SZ': '创业板指',
      } as Record<string, string>
    )[code] ?? null
  )
}
