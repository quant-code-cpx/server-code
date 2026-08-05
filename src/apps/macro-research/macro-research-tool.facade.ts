import { Injectable } from '@nestjs/common'
import {
  MarketMultiAssetToolError,
  type MarketMultiAssetWarning,
  finiteOrNull,
  normalizeSections,
  parseIsoDate,
  requireInteger,
  sectionNotReady,
  sectionNotRequested,
  sectionOk,
  toIsoDate,
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import { MacroResearchRepository } from './macro-research.repository'

export const MACRO_SERIES = ['CPI', 'PPI', 'GDP', 'SHIBOR'] as const
export type MacroSeries = (typeof MACRO_SERIES)[number]
export const MACRO_SECTIONS = ['LATEST', 'HISTORY'] as const
export type MacroSection = (typeof MACRO_SECTIONS)[number]

export interface MacroSnapshotInput {
  series?: MacroSeries[]
  sections?: MacroSection[]
  startPeriod?: string
  endPeriod?: string
  historyLimit?: number
}

interface MacroObservation {
  period: string
  values: Record<string, number | null>
  officialPublicationDate: null
  systemKnownAt: string
}

@Injectable()
export class MacroResearchToolFacade {
  constructor(private readonly repository: MacroResearchRepository) {}

  async getSnapshot(input: MacroSnapshotInput) {
    const series = normalizeSeries(input.series)
    const sections = normalizeSections(input.sections, MACRO_SECTIONS, ['LATEST'])
    const historyLimit = input.historyLimit ?? 60
    requireInteger(historyLimit, 'historyLimit', 1, 500)
    if (series.length > 1 && (input.startPeriod || input.endPeriod)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', '多 series 查询不能传 startPeriod/endPeriod')
    }
    if (series.length === 1) validatePeriodRange(series[0], input.startPeriod, input.endPeriod)

    const requestedLimit = sections.includes('HISTORY') ? historyLimit : 1
    const observations = new Map<MacroSeries, MacroObservation[]>()
    await Promise.all(
      series.map(async (item) => {
        observations.set(item, await this.loadSeries(item, input.startPeriod, input.endPeriod, requestedLimit))
      }),
    )

    const latestData: Record<string, MacroObservation | null> = {}
    const historyData: Record<string, MacroObservation[]> = {}
    const dataThroughBySeries: Record<string, string | null> = {}
    const coverageStartBySeries: Record<string, string | null> = {}
    for (const item of series) {
      const values = observations.get(item) ?? []
      latestData[item] = values[values.length - 1] ?? null
      historyData[item] = values
      coverageStartBySeries[item] = values[0]?.period ?? null
      dataThroughBySeries[item] = values[values.length - 1]?.period ?? null
    }
    const anyData = series.some((item) => observations.get(item)?.length)
    const warnings: MarketMultiAssetWarning[] = [
      {
        code: 'OFFICIAL_PUBLICATION_DATE_UNAVAILABLE',
        message: '本地宏观表没有官方发布日期；systemKnownAt 仅表示系统同步时间，不能用于历史点时回测',
        affectedFields: ['latest', 'history', 'officialPublicationDate', 'systemKnownAt'],
      },
    ]

    return {
      data: {
        requestedSeries: series,
        dataThroughBySeries,
        coverageStartBySeries,
        latest: sections.includes('LATEST')
          ? anyData
            ? sectionOk(latestData)
            : sectionNotReady('请求的宏观序列没有数据')
          : sectionNotRequested(),
        history: sections.includes('HISTORY')
          ? anyData
            ? sectionOk(historyData)
            : sectionNotReady('请求的宏观序列没有历史数据')
          : sectionNotRequested(),
        unitsByField: MACRO_UNITS,
      },
      warnings,
      truncated: false,
    }
  }

  private async loadSeries(
    series: MacroSeries,
    startPeriod: string | undefined,
    endPeriod: string | undefined,
    limit: number,
  ): Promise<MacroObservation[]> {
    if (series === 'CPI') {
      const rows = await this.repository.findCpi(startPeriod, endPeriod, limit)
      return rows.reverse().map((row) => ({
        period: row.month,
        values: {
          nationalValue: finiteOrNull(row.ntVal),
          nationalYoy: finiteOrNull(row.ntYoy),
          nationalMom: finiteOrNull(row.ntMom),
          nationalAccumulated: finiteOrNull(row.ntAccu),
          townYoy: finiteOrNull(row.townYoy),
          ruralYoy: finiteOrNull(row.cntYoy),
        },
        officialPublicationDate: null,
        systemKnownAt: row.syncedAt.toISOString(),
      }))
    }
    if (series === 'PPI') {
      const rows = await this.repository.findPpi(startPeriod, endPeriod, limit)
      return rows.reverse().map((row) => ({
        period: row.month,
        values: {
          ppiYoy: finiteOrNull(row.ppiYoy),
          ppiMom: finiteOrNull(row.ppiMom),
          ppiAccumulated: finiteOrNull(row.ppiAccu),
          meansOfProductionYoy: finiteOrNull(row.ppiMpYoy),
          consumerGoodsYoy: finiteOrNull(row.ppiCgYoy),
        },
        officialPublicationDate: null,
        systemKnownAt: row.syncedAt.toISOString(),
      }))
    }
    if (series === 'GDP') {
      const rows = await this.repository.findGdp(startPeriod, endPeriod, limit)
      return rows.reverse().map((row) => ({
        period: row.quarter,
        values: {
          gdp: finiteOrNull(row.gdp),
          gdpYoy: finiteOrNull(row.gdpYoy),
          primaryIndustry: finiteOrNull(row.pi),
          primaryIndustryYoy: finiteOrNull(row.piYoy),
          secondaryIndustry: finiteOrNull(row.si),
          secondaryIndustryYoy: finiteOrNull(row.siYoy),
          tertiaryIndustry: finiteOrNull(row.ti),
          tertiaryIndustryYoy: finiteOrNull(row.tiYoy),
        },
        officialPublicationDate: null,
        systemKnownAt: row.syncedAt.toISOString(),
      }))
    }
    const startDate = startPeriod ? (parseIsoDate(startPeriod, 'startPeriod') ?? undefined) : undefined
    const endDate = endPeriod ? (parseIsoDate(endPeriod, 'endPeriod') ?? undefined) : undefined
    const rows = await this.repository.findShibor(startDate, endDate, limit)
    return rows.reverse().map((row) => ({
      period: toIsoDate(row.date),
      values: {
        overnight: finiteOrNull(row.on),
        oneWeek: finiteOrNull(row.w1),
        twoWeeks: finiteOrNull(row.w2),
        oneMonth: finiteOrNull(row.m1),
        threeMonths: finiteOrNull(row.m3),
        sixMonths: finiteOrNull(row.m6),
        nineMonths: finiteOrNull(row.m9),
        oneYear: finiteOrNull(row.y1),
      },
      officialPublicationDate: null,
      systemKnownAt: row.syncedAt.toISOString(),
    }))
  }
}

const MACRO_UNITS: Record<string, string> = Object.freeze({
  'CPI.nationalValue': 'INDEX_POINT',
  'CPI.nationalYoy': 'PERCENT',
  'CPI.nationalMom': 'PERCENT',
  'CPI.nationalAccumulated': 'INDEX_POINT',
  'CPI.townYoy': 'PERCENT',
  'CPI.ruralYoy': 'PERCENT',
  'PPI.ppiYoy': 'PERCENT',
  'PPI.ppiMom': 'PERCENT',
  'PPI.ppiAccumulated': 'PERCENT',
  'PPI.meansOfProductionYoy': 'PERCENT',
  'PPI.consumerGoodsYoy': 'PERCENT',
  'GDP.gdp': 'CNY_HUNDRED_MILLION',
  'GDP.gdpYoy': 'PERCENT',
  'GDP.primaryIndustry': 'CNY_HUNDRED_MILLION',
  'GDP.primaryIndustryYoy': 'PERCENT',
  'GDP.secondaryIndustry': 'CNY_HUNDRED_MILLION',
  'GDP.secondaryIndustryYoy': 'PERCENT',
  'GDP.tertiaryIndustry': 'CNY_HUNDRED_MILLION',
  'GDP.tertiaryIndustryYoy': 'PERCENT',
  'SHIBOR.overnight': 'PERCENT',
  'SHIBOR.oneWeek': 'PERCENT',
  'SHIBOR.twoWeeks': 'PERCENT',
  'SHIBOR.oneMonth': 'PERCENT',
  'SHIBOR.threeMonths': 'PERCENT',
  'SHIBOR.sixMonths': 'PERCENT',
  'SHIBOR.nineMonths': 'PERCENT',
  'SHIBOR.oneYear': 'PERCENT',
})

function normalizeSeries(values: readonly string[] | undefined): MacroSeries[] {
  const series = values?.length ? [...values] : [...MACRO_SERIES]
  if (series.length < 1 || series.length > MACRO_SERIES.length) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'series 必须包含 1-4 项')
  }
  if (new Set(series).size !== series.length || series.some((value) => !MACRO_SERIES.includes(value as MacroSeries))) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `series 仅支持 ${MACRO_SERIES.join('、')} 且不能重复`)
  }
  return series as MacroSeries[]
}

function validatePeriodRange(series: MacroSeries, startPeriod?: string, endPeriod?: string): void {
  const pattern =
    series === 'CPI' || series === 'PPI' ? /^\d{6}$/ : series === 'GDP' ? /^\d{4}Q[1-4]$/ : /^\d{4}-\d{2}-\d{2}$/
  for (const [field, value] of [
    ['startPeriod', startPeriod],
    ['endPeriod', endPeriod],
  ] as const) {
    if (value && !pattern.test(value)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${field} 与 ${series} 的 period 格式不兼容`)
    }
  }
  if (startPeriod && endPeriod && startPeriod > endPeriod) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'startPeriod 不能晚于 endPeriod')
  }
}
