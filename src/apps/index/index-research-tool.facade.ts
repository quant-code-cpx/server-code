import { Injectable } from '@nestjs/common'
import { CORE_INDEX_NAME_MAP } from 'src/constant/tushare.constant'
import {
  aggregateResearchBars,
  deterministicEvenSample,
  type ResearchBar,
} from 'src/apps/market-multi-asset/market-multi-asset.calculation'
import {
  MarketMultiAssetToolError,
  type MarketMultiAssetWarning,
  type ResearchSectionResult,
  finiteOrNull,
  isoToCompactDate,
  normalizeSections,
  parseIsoDate,
  requireInteger,
  sectionError,
  sectionNotReady,
  sectionNotRequested,
  sectionOk,
  toIsoDate,
  validateDateRange,
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import { IndexResearchRepository } from './index-research.repository'

export const INDEX_RESEARCH_SECTIONS = ['BASIC', 'QUOTE', 'HISTORY', 'VALUATION', 'CONSTITUENTS'] as const
export type IndexResearchSection = (typeof INDEX_RESEARCH_SECTIONS)[number]

export interface IndexMarketDataInput {
  indexCode: string
  sections?: IndexResearchSection[]
  asOfDate?: string
  startDate?: string
  endDate?: string
  frequency?: 'D' | 'W' | 'M'
  constituentLimit?: number
}

type IndexBasicData = {
  market: string | null
  publisher: string | null
  category: string | null
  baseDate: string | null
  basePoint: number | null
}

type IndexValuationPoint = {
  tradeDate: string
  pe: number | null
  peTtm: number | null
  pb: number | null
  turnoverRate: number | null
  totalMv: number | null
}

type IndexConstituents = {
  weightDate: string
  total: number
  items: Array<{ tsCode: string; name: string | null; weightPct: number | null }>
}

@Injectable()
export class IndexResearchToolFacade {
  constructor(private readonly repository: IndexResearchRepository) {}

  async getMarketData(input: IndexMarketDataInput) {
    const indexCode = input.indexCode?.trim().toUpperCase()
    if (!/^\d{6}\.(SH|SZ)$/.test(indexCode)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'indexCode 必须为指数代码，例如 000300.SH')
    }
    if (!(await this.repository.findAny(indexCode))) {
      throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `指数不存在或没有本地行情：${indexCode}`)
    }

    const sections = normalizeSections(input.sections, INDEX_RESEARCH_SECTIONS, ['QUOTE'])
    const frequency = input.frequency ?? 'D'
    if (!['D', 'W', 'M'].includes(frequency)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'frequency 仅支持 D、W、M')
    }
    const constituentLimit = input.constituentLimit ?? 100
    requireInteger(constituentLimit, 'constituentLimit', 1, 500)
    const fixedRows = Number(sections.includes('BASIC')) + Number(sections.includes('QUOTE'))
    const listSectionCount = ['HISTORY', 'VALUATION', 'CONSTITUENTS'].filter((section) =>
      sections.includes(section as IndexResearchSection),
    ).length
    const perListRowBudget = listSectionCount ? Math.floor((2_500 - fixedRows) / listSectionCount) : 2_500

    const requestedAsOf = parseIsoDate(input.asOfDate, 'asOfDate')
    const [, latestDaily] = await this.repository.findDailyBounds(indexCode, requestedAsOf ?? undefined)
    if (!latestDaily) throw new MarketMultiAssetToolError('DATA_NOT_READY', `${indexCode} 在指定时点前没有行情`)
    const asOf = requestedAsOf ?? latestDaily.tradeDate
    const endDate = parseIsoDate(input.endDate, 'endDate') ?? asOf
    if (endDate > asOf) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'endDate 不能晚于 asOfDate')
    const defaultStart = new Date(endDate)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 1)
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? defaultStart
    validateDateRange(startDate, endDate, 3_653)

    const dataThroughBySection: Record<string, string | null> = Object.fromEntries(
      INDEX_RESEARCH_SECTIONS.map((section) => [section, null]),
    )
    const coverageStartBySection: Record<string, string | null> = Object.fromEntries(
      INDEX_RESEARCH_SECTIONS.map((section) => [section, null]),
    )
    const warnings: MarketMultiAssetWarning[] = []
    let truncated = false

    let basic: ResearchSectionResult<IndexBasicData> = sectionNotRequested()
    let quote: ResearchSectionResult<ResearchBar | null> = sectionNotRequested()
    let history: ResearchSectionResult<ResearchBar[]> = sectionNotRequested()
    let valuation: ResearchSectionResult<IndexValuationPoint[]> = sectionNotRequested()
    let constituents: ResearchSectionResult<IndexConstituents> = sectionNotRequested()

    if (sections.includes('BASIC')) {
      basic = sectionOk({
        market: indexCode.endsWith('.SH') ? 'SH' : 'SZ',
        publisher: null,
        category: null,
        baseDate: null,
        basePoint: null,
      })
      dataThroughBySection.BASIC = toIsoDate(latestDaily.tradeDate)
      warnings.push({
        code: 'INDEX_BASIC_CATALOG_UNAVAILABLE',
        message: '本地库未保存指数发布方、基日和基点，相关字段返回 null',
        affectedFields: ['basic.publisher', 'basic.category', 'basic.baseDate', 'basic.basePoint'],
      })
    }

    if (sections.includes('QUOTE')) {
      try {
        const row = await this.repository.findLatestDaily(indexCode, asOf)
        quote = row ? sectionOk(toBar(row)) : sectionNotReady('指定时点前没有指数行情')
        if (row) dataThroughBySection.QUOTE = toIsoDate(row.tradeDate)
      } catch {
        quote = sectionError('指数最新行情查询失败')
      }
    }

    if (sections.includes('HISTORY')) {
      try {
        const rows = await this.repository.findDailyRange(indexCode, startDate, endDate)
        const aggregated = aggregateResearchBars(rows.map(toBar), frequency)
        const sampled = deterministicEvenSample(aggregated, perListRowBudget)
        history = rows.length ? sectionOk(sampled) : sectionNotReady('区间内没有指数行情')
        if (sampled.length < aggregated.length) {
          truncated = true
          warnings.push({
            code: 'INDEX_HISTORY_SAMPLED',
            message: '多 section 总行数受 2,500 行限制，历史行情已首尾保留等距采样',
            affectedFields: ['history'],
          })
        }
        if (rows.length) {
          coverageStartBySection.HISTORY = toIsoDate(rows[0].tradeDate)
          dataThroughBySection.HISTORY = toIsoDate(rows[rows.length - 1].tradeDate)
        }
      } catch {
        history = sectionError('指数历史行情查询失败')
      }
    }

    if (sections.includes('VALUATION')) {
      try {
        const rows = await this.repository.findValuationRange(indexCode, startDate, endDate)
        const mapped = rows.map((row) => ({
          tradeDate: toIsoDate(row.tradeDate),
          pe: finiteOrNull(row.pe),
          peTtm: finiteOrNull(row.peTtm),
          pb: finiteOrNull(row.pb),
          turnoverRate: finiteOrNull(row.turnoverRate),
          totalMv: finiteOrNull(row.totalMv),
        }))
        const sampled = deterministicEvenSample(mapped, perListRowBudget)
        valuation = rows.length ? sectionOk(sampled) : sectionNotReady('区间内没有指数估值数据')
        if (sampled.length < mapped.length) {
          truncated = true
          warnings.push({
            code: 'INDEX_VALUATION_SAMPLED',
            message: '多 section 总行数受 2,500 行限制，估值序列已首尾保留等距采样',
            affectedFields: ['valuation'],
          })
        }
        if (rows.length) {
          coverageStartBySection.VALUATION = toIsoDate(rows[0].tradeDate)
          dataThroughBySection.VALUATION = toIsoDate(rows[rows.length - 1].tradeDate)
        }
      } catch {
        valuation = sectionError('指数估值查询失败')
      }
    }

    if (sections.includes('CONSTITUENTS')) {
      try {
        const result = await this.repository.findConstituents(
          indexCode,
          isoToCompactDate(toIsoDate(asOf)),
          Math.min(constituentLimit, perListRowBudget),
        )
        constituents = result
          ? sectionOk({ ...result, weightDate: compactWeightDate(result.weightDate) })
          : sectionNotReady('指定时点前没有指数成分权重')
        if (result) {
          dataThroughBySection.CONSTITUENTS = compactWeightDate(result.weightDate)
          truncated ||= result.total > result.items.length
        }
      } catch {
        constituents = sectionError('指数成分权重查询失败')
      }
    }

    const [dailyStart] = await this.repository.findDailyBounds(indexCode, asOf)
    const [valuationStart] = await this.repository.findValuationBounds(indexCode, asOf)
    coverageStartBySection.BASIC = dailyStart ? toIsoDate(dailyStart.tradeDate) : null
    coverageStartBySection.QUOTE = coverageStartBySection.BASIC
    if (!coverageStartBySection.HISTORY) coverageStartBySection.HISTORY = coverageStartBySection.BASIC
    if (!coverageStartBySection.VALUATION && valuationStart) {
      coverageStartBySection.VALUATION = toIsoDate(valuationStart.tradeDate)
    }

    return {
      data: {
        meta: {
          indexCode,
          name: CORE_INDEX_NAME_MAP[indexCode] ?? null,
          requestedAsOfDate: input.asOfDate ?? null,
          dataThroughBySection,
          coverageStartBySection,
          currency: 'CNY' as const,
          adjustment: 'NONE' as const,
          frequency,
          algorithmVersion: frequency === 'D' ? null : 'index-bar-aggregation.v1',
        },
        basic,
        quote,
        history,
        valuation,
        constituents,
        units: {
          price: 'INDEX_POINT' as const,
          pctChg: 'PERCENT' as const,
          vol: 'LOT' as const,
          amount: 'CNY_THOUSAND' as const,
          totalMv: 'CNY_TEN_THOUSAND' as const,
          weight: 'PERCENT' as const,
        },
      },
      warnings,
      truncated,
    }
  }
}

function toBar(row: {
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  change: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
}): ResearchBar {
  return {
    tradeDate: toIsoDate(row.tradeDate),
    open: finiteOrNull(row.open),
    high: finiteOrNull(row.high),
    low: finiteOrNull(row.low),
    close: finiteOrNull(row.close),
    preClose: finiteOrNull(row.preClose),
    change: finiteOrNull(row.change),
    pctChg: finiteOrNull(row.pctChg),
    vol: finiteOrNull(row.vol),
    amount: finiteOrNull(row.amount),
  }
}

function compactWeightDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value
}
