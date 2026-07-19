import { Inject, Injectable } from '@nestjs/common'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CORE_INDEX_NAME_MAP } from 'src/constant/tushare.constant'
import { CacheService } from 'src/shared/cache.service'
import { MarketService } from './market.service'

export type MarketSnapshotSection =
  | 'INDEX_QUOTES'
  | 'BREADTH'
  | 'VALUATION'
  | 'SENTIMENT'
  | 'MONEY_FLOW'
  | 'HSGT'
  | 'SECTOR_RANKING'
  | 'DATA_DATES'

export interface MarketSnapshotInput {
  tradeDate?: string
  sections: MarketSnapshotSection[]
  sectorType?: 'INDUSTRY' | 'CONCEPT'
  topN: number
}

export interface MarketMetric {
  key: string
  value: string | number | boolean | null
  unit: string | null
}

export interface MarketSnapshotRow {
  key: string
  name: string | null
  category: string | null
  metrics: MarketMetric[]
}

export interface MarketSnapshotSectionResult {
  section: MarketSnapshotSection
  status: 'OK' | 'MISSING' | 'ERROR'
  asOf: string | null
  facts: MarketMetric[]
  rows: MarketSnapshotRow[]
  warning: string | null
}

const MARKET_SNAPSHOT_SCHEMA_VERSION = 'market-snapshot-v1'

@Injectable()
export class MarketToolFacade {
  constructor(
    private readonly marketService: MarketService,
    private readonly cacheService: CacheService,
    @Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig,
  ) {}

  async snapshot(input: MarketSnapshotInput) {
    const normalized = {
      tradeDate: input.tradeDate ?? null,
      sections: [...new Set(input.sections)],
      sectorType: input.sectorType ?? 'INDUSTRY',
      topN: input.topN,
      schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
    }
    const key = this.cacheService.buildKey('agent:market-snapshot', normalized)
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.MARKET,
      key,
      ttlSeconds: this.config.marketCacheTtlSeconds,
      loader: async () => {
        const sections = await Promise.all(normalized.sections.map((section) => this.loadSection(section, normalized)))
        return {
          data: {
            requestedTradeDate: input.tradeDate ?? null,
            sectorType: normalized.sectorType,
            topN: normalized.topN,
            sections,
          },
          asOf:
            sections
              .map((section) => section.asOf)
              .filter((value): value is string => value !== null)
              .sort()
              .at(-1) ?? null,
          sourceModels: sourceModelsForSections(normalized.sections),
        }
      },
    })
  }

  private async loadSection(
    section: MarketSnapshotSection,
    input: {
      tradeDate: string | null
      sectorType: 'INDUSTRY' | 'CONCEPT'
      topN: number
    },
  ): Promise<MarketSnapshotSectionResult> {
    const trade_date = input.tradeDate?.replaceAll('-', '')
    try {
      if (section === 'INDEX_QUOTES') {
        const rows = await this.marketService.getIndexQuote({ trade_date })
        const resultRows = rows.map((row) => ({
          key: row.tsCode,
          name: CORE_INDEX_NAME_MAP[row.tsCode] ?? row.tsCode,
          category: 'INDEX',
          metrics: metricsFromRecord(row, ['open', 'high', 'low', 'close', 'preClose', 'pctChg', 'vol', 'amount'], {
            amount: 'CNY_THOUSAND',
          }),
        }))
        return sectionResult(section, dateFromRows(rows), [], resultRows)
      }

      if (section === 'BREADTH') {
        const value = await this.marketService.getMarketBreadth({ trade_date })
        const facts = value
          ? metricsFromRecord(value, [
              'limitUp',
              'limitDown',
              'bigRise',
              'rise',
              'flat',
              'fall',
              'bigFall',
              'total',
              'limitUpBroken',
            ])
          : []
        return sectionResult(section, toIsoDate(value?.tradeDate), facts, [])
      }

      if (section === 'VALUATION') {
        const value = await this.marketService.getMarketValuation({ trade_date })
        const facts = flattenMetrics(value, ['tradeDate'])
        return sectionResult(section, toIsoDate(value.tradeDate), facts, [])
      }

      if (section === 'SENTIMENT') {
        const value = await this.marketService.getMarketSentiment({ trade_date })
        const facts = value ? metricsFromRecord(value, ['bigRise', 'rise', 'flat', 'fall', 'bigFall', 'total']) : []
        return sectionResult(section, toIsoDate(value?.tradeDate), facts, [])
      }

      if (section === 'MONEY_FLOW') {
        const value = await this.marketService.getMarketMoneyFlow({ trade_date })
        if (!value || Array.isArray(value)) return sectionResult(section, null, [], [])
        return sectionResult(section, toIsoDate(value.tradeDate), flattenMetrics(value, ['tradeDate']), [])
      }

      if (section === 'HSGT') {
        const value = await this.marketService.getHsgtFlow({ trade_date, days: 1 })
        const rows = value.history.map((row, index) => ({
          key: `hsgt-${index + 1}`,
          name: '沪深港通资金流',
          category: 'HSGT',
          metrics: flattenMetrics(row, ['tradeDate']).map((metric) => ({
            ...metric,
            unit: /ggt|hgt|sgt|money/i.test(metric.key) ? 'CNY_MILLION' : metric.unit,
          })),
        }))
        return sectionResult(section, dateFromRows(value.history) ?? toIsoDate(value.tradeDate), [], rows)
      }

      if (section === 'SECTOR_RANKING') {
        const value = await this.marketService.getSectorFlowRanking({
          trade_date,
          content_type: input.sectorType,
          sort_by: 'pct_change',
          limit: input.topN,
          dual: true,
        })
        const dualValue = value as Extract<typeof value, { topInflow: unknown[] }>
        const rows = [
          ...dualValue.topInflow.map((row) => marketRow(row.tsCode, row.name, 'TOP', row)),
          ...dualValue.topOutflow.map((row) => marketRow(row.tsCode, row.name, 'BOTTOM', row)),
        ]
        return sectionResult(section, toIsoDate(value.tradeDate), [], rows)
      }

      const value = await this.marketService.getDataDates()
      const facts = Object.entries(value).map(([key, item]) => ({
        key,
        value: compactToIsoDate(item),
        unit: null,
      }))
      const asOf =
        facts
          .map((fact) => fact.value)
          .filter((item): item is string => typeof item === 'string')
          .sort()
          .at(-1) ?? null
      return sectionResult(section, asOf, facts, [])
    } catch {
      return {
        section,
        status: 'ERROR',
        asOf: null,
        facts: [],
        rows: [],
        warning: '该市场分区暂时不可用',
      }
    }
  }
}

function sectionResult(
  section: MarketSnapshotSection,
  asOf: string | null,
  facts: MarketMetric[],
  rows: MarketSnapshotRow[],
): MarketSnapshotSectionResult {
  const hasValue =
    facts.some((fact) => fact.value !== null) || rows.some((row) => row.metrics.some((metric) => metric.value !== null))
  return {
    section,
    status: hasValue ? 'OK' : 'MISSING',
    asOf,
    facts,
    rows,
    warning: hasValue ? null : '该市场分区在请求时点无数据',
  }
}

function marketRow(
  key: string,
  name: string | null,
  category: string,
  value: Record<string, unknown>,
): MarketSnapshotRow {
  return { key, name, category, metrics: flattenMetrics(value, ['tsCode', 'name']) }
}

function metricsFromRecord(
  value: object,
  fields: string[],
  unitOverrides: Record<string, string> = {},
): MarketMetric[] {
  const record = value as Record<string, unknown>
  return fields.map((key) => ({
    key,
    value: normalizeMetricValue(record[key]),
    unit: unitOverrides[key] ?? metricUnit(key),
  }))
}

function flattenMetrics(value: object, ignoredKeys: string[], prefix = ''): MarketMetric[] {
  const metrics: MarketMetric[] = []
  for (const [key, item] of Object.entries(value)) {
    if (ignoredKeys.includes(key) || Array.isArray(item) || item instanceof Date) continue
    const metricKey = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !isDecimalLike(item)) {
      metrics.push(...flattenMetrics(item, ignoredKeys, metricKey))
      continue
    }
    metrics.push({ key: metricKey, value: normalizeMetricValue(item), unit: metricUnit(metricKey) })
  }
  return metrics
}

function normalizeMetricValue(value: unknown): string | number | boolean | null {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (isDecimalLike(value)) return Number(value.toString())
  return String(value)
}

function isDecimalLike(value: unknown): value is { toString(): string } {
  return Boolean(value && typeof value === 'object' && value.constructor?.name === 'Decimal')
}

function metricUnit(key: string): string | null {
  if (/pct|rate|percentile/i.test(key)) return 'PERCENT'
  if (/amount|money/i.test(key)) return 'CNY'
  if (/vol/i.test(key)) return 'LOT'
  if (/close|open|high|low|point/i.test(key)) return 'POINT'
  if (/count|total|rise|fall|flat|limit/i.test(key)) return 'COUNT'
  return null
}

function dateFromRows(rows: Array<{ tradeDate?: Date | string | null }>): string | null {
  return (
    rows
      .map((row) => toIsoDate(row.tradeDate))
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  )
}

function compactToIsoDate(value: string | null): string | null {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string' && /^\d{8}$/.test(value)) return compactToIsoDate(value)
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function sourceModelsForSections(sections: MarketSnapshotSection[]): string[] {
  const models = new Set<string>()
  for (const section of sections) {
    if (section === 'INDEX_QUOTES' || section === 'DATA_DATES') models.add('IndexDaily')
    if (section === 'BREADTH' || section === 'SENTIMENT' || section === 'DATA_DATES') models.add('Daily')
    if (section === 'VALUATION' || section === 'DATA_DATES') models.add('ValuationDailyMedian')
    if (section === 'MONEY_FLOW' || section === 'DATA_DATES') models.add('Moneyflow')
    if (section === 'HSGT' || section === 'DATA_DATES') models.add('MoneyflowHsgt')
    if (section === 'SECTOR_RANKING' || section === 'DATA_DATES') models.add('MoneyflowIndDc')
  }
  return [...models]
}
