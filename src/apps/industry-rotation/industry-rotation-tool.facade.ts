import { Injectable } from '@nestjs/common'
import { stableDescendingRanks } from 'src/apps/market-multi-asset/market-multi-asset.calculation'
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
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import {
  IndustryRotationResearchRepository,
  type IndustryResearchBarRow,
} from './industry-rotation-research.repository'

export const INDUSTRY_ROTATION_SECTIONS = ['RETURN', 'MOMENTUM', 'FLOW', 'VALUATION', 'HEATMAP', 'DETAIL'] as const
export type IndustryRotationSection = (typeof INDUSTRY_ROTATION_SECTIONS)[number]

export interface IndustryRotationResearchInput {
  sections?: IndustryRotationSection[]
  industryCodes?: string[]
  asOfDate?: string
  periods?: number[]
  topN?: number
  heatmapTradeDays?: number
}

interface IndustryMetricBase {
  industryCode: string
  name: string
  tradeDate: string
  sampleStockCount: number | null
  source: string
}

@Injectable()
export class IndustryRotationToolFacade {
  constructor(private readonly repository: IndustryRotationResearchRepository) {}

  async getRotation(input: IndustryRotationResearchInput) {
    const sections = normalizeSections(input.sections, INDUSTRY_ROTATION_SECTIONS, ['RETURN', 'MOMENTUM'])
    const industryCodes = normalizeIndustryCodes(input.industryCodes)
    const periods = normalizePeriods(input.periods)
    const topN = input.topN ?? 20
    const heatmapTradeDays = input.heatmapTradeDays ?? 20
    requireInteger(topN, 'topN', 1, 50)
    requireInteger(heatmapTradeDays, 'heatmapTradeDays', 5, 250)
    const requestedAsOf = parseIsoDate(input.asOfDate, 'asOfDate')
    const latest = await this.repository.findLatestTradeDate(requestedAsOf ?? undefined)
    if (!latest) throw new MarketMultiAssetToolError('DATA_NOT_READY', '本地库没有 THS 行业日线')
    const asOfDate = requestedAsOf ?? latest.tradeDate

    const catalog = await this.repository.findCatalog(industryCodes)
    if (industryCodes?.length && catalog.length !== industryCodes.length) {
      const found = new Set(catalog.map((item) => item.tsCode))
      const missing = industryCodes.filter((code) => !found.has(code))
      throw new MarketMultiAssetToolError('DATA_NOT_FOUND', `THS 行业代码不存在：${missing.join('、')}`)
    }
    const allCatalog = industryCodes?.length ? await this.repository.findCatalog() : catalog
    const maxRows = Math.max(...periods, heatmapTradeDays) + 1
    const rows = await this.repository.findBars(asOfDate, maxRows)
    const barsByCode = groupBars(rows)
    const catalogByCode = new Map(allCatalog.map((item) => [item.tsCode, item]))
    const baseItems = allCatalog.map((item) => buildReturnItem(item, barsByCode.get(item.tsCode) ?? [], periods))
    const primaryPeriod = periods.includes(20) ? 20 : periods[periods.length - 1]
    const rankedReturns = stableDescendingRanks(
      baseItems,
      (item) => item.returns[String(primaryPeriod)] ?? null,
      (item) => item.industryCode,
    )
    const rankedMomentum = stableDescendingRanks(
      baseItems.map((item) => ({
        ...item,
        momentumScore: averageNullable(periods.map((period) => item.returns[String(period)] ?? null)),
      })),
      (item) => item.momentumScore,
      (item) => item.industryCode,
    )
    const filterCodes = industryCodes ? new Set(industryCodes) : null
    const selectRanked = <T extends { industryCode: string }>(items: T[]) =>
      items.filter((item) => !filterCodes || filterCodes.has(item.industryCode)).slice(0, topN)
    const selectedReturns = selectRanked(rankedReturns)
    const selectedMomentum = selectRanked(rankedMomentum)
    const warnings: MarketMultiAssetWarning[] = []
    let heatmapWasTruncated = false
    const dataThroughBySection: Record<string, string | null> = Object.fromEntries(
      INDUSTRY_ROTATION_SECTIONS.map((section) => [section, null]),
    )

    const returns = sections.includes('RETURN')
      ? selectedReturns.length
        ? sectionOk(selectedReturns)
        : sectionNotReady('指定时点前没有足够 THS 行业行情')
      : sectionNotRequested()
    if (selectedReturns.length) dataThroughBySection.RETURN = selectedReturns[0].tradeDate

    const momentum = sections.includes('MOMENTUM')
      ? selectedMomentum.length
        ? sectionOk(selectedMomentum)
        : sectionNotReady('指定时点前没有足够 THS 行业行情')
      : sectionNotRequested()
    if (selectedMomentum.length) dataThroughBySection.MOMENTUM = selectedMomentum[0].tradeDate

    let flow: ResearchSectionResult<unknown[]> = sectionNotRequested()
    if (sections.includes('FLOW')) {
      try {
        const flowDays = Math.max(...periods)
        const flowRows = await this.repository.findFlows(
          allCatalog.map((item) => item.name),
          asOfDate,
          flowDays,
        )
        const catalogByName = new Map(allCatalog.map((item) => [item.name, item]))
        const ranked = stableDescendingRanks(
          flowRows.flatMap((row) => {
            const industry = catalogByName.get(row.name)
            if (!industry) return []
            return [
              {
                industryCode: industry.tsCode,
                name: industry.name,
                tradeDate: toIsoDate(row.trade_date),
                sampleStockCount: industry.count,
                source: 'EASTMONEY_EXACT_NAME_MATCH',
                sampleDays: Number(row.sample_days),
                cumulativeNetAmountCny: finiteOrNull(row.cumulative_net),
                averageNetAmountCny: finiteOrNull(row.average_net),
                latestNetAmountRatePct: finiteOrNull(row.latest_net_rate),
              },
            ]
          }),
          (item) => item.cumulativeNetAmountCny,
          (item) => item.industryCode,
        )
        const selected = selectRanked(ranked)
        flow = selected.length ? sectionOk(selected) : sectionNotReady('THS 行业名称无法与本地东财行业资金流精确匹配')
        dataThroughBySection.FLOW = selected[0]?.tradeDate ?? null
        warnings.push({
          code: 'INDUSTRY_FLOW_SOURCE_NAME_MATCHED',
          message: '资金流来源为东财行业口径，仅返回与 THS 行业名称完全一致的匹配项',
          affectedFields: ['flow'],
        })
      } catch {
        flow = sectionError('行业资金流查询失败')
      }
    }

    let valuation: ResearchSectionResult<unknown[]> = sectionNotRequested()
    if (sections.includes('VALUATION')) {
      try {
        const rows = await this.repository.findValuations(
          allCatalog.map((item) => item.name),
          asOfDate,
        )
        const catalogByName = new Map(allCatalog.map((item) => [item.name, item]))
        const ranked = stableDescendingRanks(
          rows.flatMap((row) => {
            const industry = catalogByName.get(row.scope)
            if (!industry) return []
            const stockCount = row.stock_count ?? null
            const expected = industry.count ?? null
            return [
              {
                industryCode: industry.tsCode,
                name: industry.name,
                tradeDate: toIsoDate(row.trade_date),
                sampleStockCount: stockCount,
                source: 'VALUATION_MEDIAN_EXACT_NAME_MATCH',
                peTtmMedian: finiteOrNull(row.pe_ttm_median),
                pbMedian: finiteOrNull(row.pb_median),
                nullCoverageRate:
                  expected && stockCount !== null ? Math.max(0, Math.min(1, 1 - stockCount / expected)) : null,
              },
            ]
          }),
          (item) => (item.peTtmMedian === null ? null : -item.peTtmMedian),
          (item) => item.industryCode,
        )
        const selected = selectRanked(ranked)
        valuation = selected.length ? sectionOk(selected) : sectionNotReady('没有可与 THS 行业名称精确匹配的估值中位数')
        dataThroughBySection.VALUATION = selected[0]?.tradeDate ?? null
        warnings.push({
          code: 'INDUSTRY_VALUATION_NAME_MATCHED',
          message: '估值中位数按行业名称与 THS 目录精确匹配；未匹配行业不会被臆测映射',
          affectedFields: ['valuation'],
        })
      } catch {
        valuation = sectionError('行业估值查询失败')
      }
    }

    let heatmap: ResearchSectionResult<unknown[]> = sectionNotRequested()
    if (sections.includes('HEATMAP')) {
      const selectedCodes = new Set(selectedMomentum.map((item) => item.industryCode))
      const allCells = rows
        .filter((row) => selectedCodes.has(row.ts_code) && Number(row.rn) <= heatmapTradeDays)
        .map((row) => ({
          industryCode: row.ts_code,
          name: row.name,
          tradeDate: toIsoDate(row.trade_date),
          pctChg: finiteOrNull(row.pct_chg),
          close: finiteOrNull(row.close),
          source: 'TUSHARE_THS_DAILY',
        }))
        .sort(
          (left, right) =>
            left.tradeDate.localeCompare(right.tradeDate) || left.industryCode.localeCompare(right.industryCode),
        )
      const reservedDetailRows = sections.includes('DETAIL') ? topN : 0
      const heatmapBudget = Math.max(
        0,
        3_000 -
          sectionArrayLength(returns) -
          sectionArrayLength(momentum) -
          sectionArrayLength(flow) -
          sectionArrayLength(valuation) -
          reservedDetailRows,
      )
      const cells =
        allCells.length > heatmapBudget ? (heatmapBudget > 0 ? allCells.slice(-heatmapBudget) : []) : allCells
      heatmapWasTruncated = cells.length < allCells.length
      if (heatmapWasTruncated) {
        warnings.push({
          code: 'INDUSTRY_HEATMAP_TRUNCATED',
          message: '多 section 总行数受 3,000 行限制，热力图仅保留最近 cells',
          affectedFields: ['heatmap'],
        })
      }
      heatmap = cells.length ? sectionOk(cells) : sectionNotReady('没有可生成热力图的行业行情')
      dataThroughBySection.HEATMAP = cells[cells.length - 1]?.tradeDate ?? null
    }

    let detail: ResearchSectionResult<unknown[]> = sectionNotRequested()
    if (sections.includes('DETAIL')) {
      const selected = selectRanked(rankedReturns).map((item) => {
        const latestBar = barsByCode.get(item.industryCode)?.[0]
        return {
          ...item,
          open: finiteOrNull(latestBar?.open),
          high: finiteOrNull(latestBar?.high),
          low: finiteOrNull(latestBar?.low),
          close: finiteOrNull(latestBar?.close),
          preClose: finiteOrNull(latestBar?.pre_close),
          pctChg: finiteOrNull(latestBar?.pct_chg),
          vol: finiteOrNull(latestBar?.vol),
          turnoverRate: finiteOrNull(latestBar?.turnover_rate),
          catalogMemberCount: catalogByCode.get(item.industryCode)?.count ?? null,
        }
      })
      detail = selected.length ? sectionOk(selected) : sectionNotReady('没有行业详情数据')
      dataThroughBySection.DETAIL = selected[0]?.tradeDate ?? null
    }

    return {
      data: {
        meta: {
          classification: 'THS' as const,
          requestedAsOfDate: input.asOfDate ?? null,
          dataThroughBySection,
          algorithmVersion: 'industry-rotation.v1',
          primaryReturnPeriod: primaryPeriod,
          rankingPopulation: allCatalog.length,
        },
        returns,
        momentum,
        flow,
        valuation,
        heatmap,
        detail,
      },
      warnings,
      truncated:
        rankedReturns.length > selectedReturns.length ||
        rankedMomentum.length > selectedMomentum.length ||
        heatmapWasTruncated,
    }
  }
}

function normalizeIndustryCodes(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined
  if (values.length < 1 || values.length > 20 || new Set(values).size !== values.length) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'industryCodes 必须包含 1-20 个不重复代码')
  }
  const normalized = values.map((value) => value.trim().toUpperCase())
  if (normalized.some((value) => !/^[A-Z0-9]{4,12}\.[A-Z]{2}$/.test(value))) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'industryCodes 包含非法 THS 行业代码')
  }
  return normalized
}

function normalizePeriods(values: number[] | undefined): number[] {
  const periods = values?.length ? [...values] : [5, 20, 60]
  if (
    periods.length < 1 ||
    periods.length > 5 ||
    new Set(periods).size !== periods.length ||
    periods.some((value) => !Number.isInteger(value) || value < 1 || value > 250)
  ) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'periods 必须包含 1-5 个不重复的 1-250 整数')
  }
  return periods.sort((left, right) => left - right)
}

function groupBars(rows: IndustryResearchBarRow[]): Map<string, IndustryResearchBarRow[]> {
  const grouped = new Map<string, IndustryResearchBarRow[]>()
  for (const row of rows) {
    const values = grouped.get(row.ts_code) ?? []
    values.push(row)
    grouped.set(row.ts_code, values)
  }
  return grouped
}

function buildReturnItem(
  catalog: { tsCode: string; name: string; count: number | null },
  bars: IndustryResearchBarRow[],
  periods: number[],
): IndustryMetricBase & { returns: Record<string, number | null> } {
  const latest = bars[0]
  const latestClose = finiteOrNull(latest?.close)
  const returns: Record<string, number | null> = {}
  for (const period of periods) {
    const baseClose = finiteOrNull(bars[period]?.close)
    returns[String(period)] =
      latestClose !== null && baseClose ? Math.round((latestClose / baseClose - 1) * 100_000_000) / 1_000_000 : null
  }
  return {
    industryCode: catalog.tsCode,
    name: catalog.name,
    tradeDate: latest ? toIsoDate(latest.trade_date) : '',
    sampleStockCount: catalog.count,
    source: 'TUSHARE_THS_DAILY',
    returns,
  }
}

function averageNullable(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function sectionArrayLength(section: ResearchSectionResult<unknown[]>): number {
  return section.status === 'OK' ? section.data.length : 0
}
