import { Injectable } from '@nestjs/common'
import { deterministicEvenSample } from 'src/apps/market-multi-asset/market-multi-asset.calculation'
import {
  MarketMultiAssetToolError,
  type MarketMultiAssetWarning,
  type ResearchSectionResult,
  finiteOrNull,
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
import { FundResearchRepository } from './fund-research.repository'

export const FUND_RESEARCH_SECTIONS = ['BASIC', 'NAV', 'PRICE', 'SHARE', 'HOLDINGS', 'ETF_FLOW'] as const
export type FundResearchSection = (typeof FUND_RESEARCH_SECTIONS)[number]

export interface FundResearchInput {
  fundCode: string
  sections?: FundResearchSection[]
  asOfDate?: string
  startDate?: string
  endDate?: string
  holdingPeriods?: number
  maxSeriesPoints?: number
}

type FundSeriesStat = { total: number; returned: number; sampling: 'NONE' | 'EVEN_WITH_ENDPOINTS'; truncated: boolean }

@Injectable()
export class FundResearchToolFacade {
  constructor(private readonly repository: FundResearchRepository) {}

  async getResearch(input: FundResearchInput) {
    const fundCode = input.fundCode?.trim().toUpperCase()
    if (!/^\d{6}\.(OF|SH|SZ)$/.test(fundCode)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'fundCode 必须为基金代码，例如 510300.SH 或 000001.OF')
    }
    const basicRow = await this.repository.findBasic(fundCode)
    if (!basicRow) throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `基金不存在：${fundCode}`)

    const sections = normalizeSections(input.sections, FUND_RESEARCH_SECTIONS, ['BASIC', 'NAV'])
    const holdingPeriods = input.holdingPeriods ?? 4
    const maxSeriesPoints = input.maxSeriesPoints ?? 500
    requireInteger(holdingPeriods, 'holdingPeriods', 1, 12)
    requireInteger(maxSeriesPoints, 'maxSeriesPoints', 20, 1_000)
    const seriesSectionCount = ['NAV', 'PRICE', 'SHARE', 'ETF_FLOW'].filter((section) =>
      sections.includes(section as FundResearchSection),
    ).length
    const fixedRows = Number(sections.includes('BASIC')) + (sections.includes('HOLDINGS') ? holdingPeriods : 0)
    const effectiveSeriesPoints = seriesSectionCount
      ? Math.min(maxSeriesPoints, Math.floor((3_000 - fixedRows) / seriesSectionCount))
      : maxSeriesPoints
    const requestedAsOf = parseIsoDate(input.asOfDate, 'asOfDate')
    const asOf = requestedAsOf ?? new Date()
    const endDate = parseIsoDate(input.endDate, 'endDate') ?? asOf
    if (endDate > asOf) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'endDate 不能晚于 asOfDate')
    const defaultStart = new Date(endDate)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 1)
    const startDate = parseIsoDate(input.startDate, 'startDate') ?? defaultStart
    validateDateRange(startDate, endDate, 3_653)

    const bounds = await this.repository.findBounds(fundCode)
    const dataThroughBySection: Record<string, string | null> = Object.fromEntries(
      FUND_RESEARCH_SECTIONS.map((section) => [section, null]),
    )
    const coverageStartBySection: Record<string, string | null> = Object.fromEntries(
      FUND_RESEARCH_SECTIONS.map((section) => [section, null]),
    )
    const seriesStatsBySection: Record<string, FundSeriesStat | null> = Object.fromEntries(
      FUND_RESEARCH_SECTIONS.map((section) => [section, null]),
    )
    const warnings: MarketMultiAssetWarning[] = []

    let basic: ResearchSectionResult<Record<string, unknown>> = sectionNotRequested()
    let nav: ResearchSectionResult<Array<Record<string, unknown>>> = sectionNotRequested()
    let price: ResearchSectionResult<Array<Record<string, unknown>>> = sectionNotRequested()
    let share: ResearchSectionResult<Array<Record<string, unknown>>> = sectionNotRequested()
    let holdings: ResearchSectionResult<Array<Record<string, unknown>>> = sectionNotRequested()
    let etfFlow: ResearchSectionResult<Array<Record<string, unknown>>> = sectionNotRequested()

    if (sections.includes('BASIC')) {
      basic = sectionOk({
        management: basicRow.management,
        custodian: basicRow.custodian,
        fundType: basicRow.fundType,
        foundDate: basicRow.foundDate ? toIsoDate(basicRow.foundDate) : null,
        dueDate: basicRow.dueDate ? toIsoDate(basicRow.dueDate) : null,
        listDate: basicRow.listDate ? toIsoDate(basicRow.listDate) : null,
        issueAmount: finiteOrNull(basicRow.issueAmount),
        benchmark: basicRow.benchmark,
        status: basicRow.status,
        market: basicRow.market,
      })
      dataThroughBySection.BASIC = toIsoDate(basicRow.syncedAt)
    }

    if (sections.includes('NAV')) {
      try {
        const rows = await this.repository.findNavRange(fundCode, startDate, endDate, requestedAsOf)
        const points = rows.map((row) => ({
          navDate: toIsoDate(row.navDate),
          announcementDate: row.annDate ? toIsoDate(row.annDate) : null,
          unitNav: finiteOrNull(row.unitNav),
          accumulatedNav: finiteOrNull(row.accumNav),
          adjustedNav: finiteOrNull(row.adjNav),
          accumulatedDividend: finiteOrNull(row.accumDiv),
          netAsset: finiteOrNull(row.netAsset),
          totalNetAsset: finiteOrNull(row.totalNetasset),
        }))
        const sampled = recordSampling('NAV', points, effectiveSeriesPoints, seriesStatsBySection)
        nav = sampled.length ? sectionOk(sampled) : sectionNotReady('区间内没有基金净值')
        setSeriesDates('NAV', sampled, 'navDate', dataThroughBySection, coverageStartBySection)
        if (requestedAsOf) {
          warnings.push({
            code: 'FUND_NAV_ANNOUNCEMENT_DATE_FILTERED',
            message: '历史时点基金净值已按公告日过滤；公告日缺失记录不会进入结果',
            affectedFields: ['nav'],
          })
        }
      } catch {
        nav = sectionError('基金净值查询失败')
      }
    }

    let priceRows: Awaited<ReturnType<FundResearchRepository['findPriceRange']>> | null = null
    if (sections.includes('PRICE') || sections.includes('ETF_FLOW')) {
      try {
        priceRows = await this.repository.findPriceRange(fundCode, startDate, endDate)
      } catch {
        priceRows = null
      }
    }
    if (sections.includes('PRICE')) {
      if (priceRows === null) {
        price = sectionError('基金场内行情查询失败')
      } else {
        const points = priceRows.map((row) => ({
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
        }))
        const sampled = recordSampling('PRICE', points, effectiveSeriesPoints, seriesStatsBySection)
        price = sampled.length ? sectionOk(sampled) : sectionNotReady('该基金没有场内行情，可能是场外基金')
        setSeriesDates('PRICE', sampled, 'tradeDate', dataThroughBySection, coverageStartBySection)
      }
    }

    let shareRows: Awaited<ReturnType<FundResearchRepository['findShareRange']>> | null = null
    if (sections.includes('SHARE') || sections.includes('ETF_FLOW')) {
      try {
        shareRows = await this.repository.findShareRange(fundCode, startDate, endDate)
      } catch {
        shareRows = null
      }
    }
    if (sections.includes('SHARE')) {
      if (shareRows === null) {
        share = sectionError('基金份额查询失败')
      } else {
        const points = shareRows.map((row) => ({
          tradeDate: toIsoDate(row.tradeDate),
          fundShare: finiteOrNull(row.fdShare),
        }))
        const sampled = recordSampling('SHARE', points, effectiveSeriesPoints, seriesStatsBySection)
        share = sampled.length ? sectionOk(sampled) : sectionNotReady('区间内没有基金份额')
        setSeriesDates('SHARE', sampled, 'tradeDate', dataThroughBySection, coverageStartBySection)
      }
    }

    if (sections.includes('HOLDINGS')) {
      try {
        const rows = await this.repository.findHoldings(fundCode, asOf, holdingPeriods)
        const grouped = new Map<string, typeof rows>()
        for (const row of rows) {
          const period = toIsoDate(row.endDate)
          if (!grouped.has(period) && grouped.size >= holdingPeriods) continue
          const periodRows = grouped.get(period) ?? []
          periodRows.push(row)
          grouped.set(period, periodRows)
        }
        const periods = [...grouped.entries()].map(([reportPeriod, values]) => ({
          reportPeriod,
          announcementDate: values.reduce(
            (latest, row) => (toIsoDate(row.annDate) > latest ? toIsoDate(row.annDate) : latest),
            '',
          ),
          items: values.map((row) => ({
            tsCode: row.symbol,
            marketValueCny: finiteOrNull(row.mkv),
            shares: finiteOrNull(row.amount),
            portfolioWeightPct: finiteOrNull(row.stkMkvRatio),
            freeFloatWeightPct: finiteOrNull(row.stkFloatRatio),
          })),
        }))
        holdings = periods.length ? sectionOk(periods) : sectionNotReady('指定时点前没有已公告基金持仓')
        if (periods.length) {
          coverageStartBySection.HOLDINGS = periods[periods.length - 1].reportPeriod
          dataThroughBySection.HOLDINGS = periods[0].announcementDate
        }
      } catch {
        holdings = sectionError('基金持仓查询失败')
      }
    }

    if (sections.includes('ETF_FLOW')) {
      if (shareRows === null || priceRows === null) {
        etfFlow = sectionError('ETF 资金流估算依赖数据查询失败')
      } else if (!shareRows.length || !priceRows.length) {
        etfFlow = sectionNotReady('ETF 资金流估算缺少基金份额或场内价格')
      } else {
        const previous = await this.repository.findPreviousShare(fundCode, startDate)
        let previousShare = finiteOrNull(previous?.fdShare)
        const prices = new Map(priceRows.map((row) => [toIsoDate(row.tradeDate), finiteOrNull(row.close)]))
        const points = shareRows.map((row) => {
          const fundShare = finiteOrNull(row.fdShare)
          const shareChange = fundShare !== null && previousShare !== null ? fundShare - previousShare : null
          previousShare = fundShare
          const tradeDate = toIsoDate(row.tradeDate)
          const close = prices.get(tradeDate) ?? null
          return {
            tradeDate,
            fundShare,
            shareChange,
            estimatedNetFlow: shareChange !== null && close !== null ? shareChange * 10_000 * close : null,
            close,
            isEstimated: true as const,
            algorithmVersion: 'etf-flow-estimate.v1' as const,
          }
        })
        const sampled = recordSampling('ETF_FLOW', points, effectiveSeriesPoints, seriesStatsBySection)
        etfFlow = sectionOk(sampled)
        setSeriesDates('ETF_FLOW', sampled, 'tradeDate', dataThroughBySection, coverageStartBySection)
        warnings.push({
          code: 'ETF_FLOW_IS_ESTIMATED',
          message: 'ETF 资金流为份额变化乘以同日收盘价的估算，不是基金公司披露的精确申赎金额',
          affectedFields: ['etfFlow.estimatedNetFlow'],
        })
      }
    }

    coverageStartBySection.NAV ??= bounds.navStart ? toIsoDate(bounds.navStart.navDate) : null
    coverageStartBySection.PRICE ??= bounds.priceStart ? toIsoDate(bounds.priceStart.tradeDate) : null
    coverageStartBySection.SHARE ??= bounds.shareStart ? toIsoDate(bounds.shareStart.tradeDate) : null
    coverageStartBySection.ETF_FLOW ??= coverageStartBySection.SHARE
    coverageStartBySection.HOLDINGS ??= bounds.holdingsStart ? toIsoDate(bounds.holdingsStart.endDate) : null
    dataThroughBySection.NAV ??= bounds.navEnd ? toIsoDate(bounds.navEnd.navDate) : null
    dataThroughBySection.PRICE ??= bounds.priceEnd ? toIsoDate(bounds.priceEnd.tradeDate) : null
    dataThroughBySection.SHARE ??= bounds.shareEnd ? toIsoDate(bounds.shareEnd.tradeDate) : null
    dataThroughBySection.ETF_FLOW ??= dataThroughBySection.SHARE
    dataThroughBySection.HOLDINGS ??= bounds.holdingsEnd ? toIsoDate(bounds.holdingsEnd.annDate) : null

    return {
      data: {
        meta: {
          fundCode,
          name: basicRow.name,
          requestedAsOfDate: input.asOfDate ?? null,
          dataThroughBySection,
          coverageStartBySection,
          seriesStatsBySection,
        },
        basic,
        nav,
        price,
        share,
        holdings,
        etfFlow,
        units: {
          nav: 'CNY_PER_FUND_UNIT' as const,
          price: 'CNY_PER_FUND_UNIT' as const,
          fundShare: 'TEN_THOUSAND_FUND_UNITS' as const,
          estimatedNetFlow: 'CNY' as const,
          amount: 'CNY_THOUSAND' as const,
          vol: 'LOT' as const,
          holdingMarketValue: 'CNY' as const,
        },
      },
      warnings,
      truncated: Object.values(seriesStatsBySection).some((stat) => stat?.truncated),
    }
  }
}

function recordSampling<T>(
  section: string,
  values: T[],
  maximum: number,
  stats: Record<string, FundSeriesStat | null>,
): T[] {
  const sampled = deterministicEvenSample(values, maximum)
  stats[section] = {
    total: values.length,
    returned: sampled.length,
    sampling: sampled.length < values.length ? 'EVEN_WITH_ENDPOINTS' : 'NONE',
    truncated: sampled.length < values.length,
  }
  return sampled
}

function setSeriesDates<T extends Record<string, unknown>>(
  section: string,
  values: T[],
  field: keyof T,
  through: Record<string, string | null>,
  coverage: Record<string, string | null>,
): void {
  if (!values.length) return
  coverage[section] = String(values[0][field])
  through[section] = String(values[values.length - 1][field])
}
