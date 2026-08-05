import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { FactorSourceType, Prisma } from '@prisma/client'
import {
  MarketMultiAssetToolError,
  compactToIsoDate,
  isoToCompactDate,
  parseIsoDate,
  requireInteger,
  validateDateRange,
} from 'src/apps/market-multi-asset/market-multi-asset.types'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorAnalysisService } from './services/factor-analysis.service'
import { FactorComputeService } from './services/factor-compute.service'

export const FACTOR_ANALYSIS_TYPES = ['VALUES', 'IC', 'QUANTILE', 'DECAY', 'DISTRIBUTION', 'CORRELATION'] as const
export type FactorAnalysisType = (typeof FACTOR_ANALYSIS_TYPES)[number]
export const FACTOR_UNIVERSES = ['ALL', 'HS300', 'ZZ500', 'ZZ1000'] as const
export type FactorUniverse = (typeof FACTOR_UNIVERSES)[number]

export interface FactorAnalysisToolInput {
  analysis: FactorAnalysisType
  factorNames: string[]
  asOfDate?: string
  startDate?: string
  endDate?: string
  universe?: FactorUniverse
  forwardDays?: number
  icMethod?: 'SPEARMAN' | 'PEARSON'
  quantiles?: number
  rebalanceDays?: number
  decayPeriods?: number[]
  bins?: number
  page?: number
  pageSize?: number
}

@Injectable()
export class FactorAnalysisToolFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
    private readonly analysisService: FactorAnalysisService,
  ) {}

  async analyze(input: FactorAnalysisToolInput) {
    if (!FACTOR_ANALYSIS_TYPES.includes(input.analysis)) {
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'analysis 不受支持')
    }
    assertRelevantFields(input)
    const factorNames = normalizeFactorNames(input.analysis, input.factorNames)
    const definitions = await this.prisma.factorDefinition.findMany({
      where: { name: { in: factorNames }, isBuiltin: true, isEnabled: true },
      orderBy: { name: 'asc' },
    })
    if (
      definitions.length !== factorNames.length ||
      definitions.some((item) => item.sourceType === FactorSourceType.CUSTOM_SQL)
    ) {
      const found = new Set(
        definitions.filter((item) => item.sourceType !== FactorSourceType.CUSTOM_SQL).map((item) => item.name),
      )
      throw new MarketMultiAssetToolError(
        'INVALID_ARGUMENT',
        `仅允许已启用的内置/预计算因子：${factorNames.filter((name) => !found.has(name)).join('、')}`,
      )
    }

    const universe = input.universe ?? 'ALL'
    if (!FACTOR_UNIVERSES.includes(universe))
      throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'universe 不受支持')
    const universeCode = UNIVERSE_CODE[universe]
    const pointInTimeAnalysis = ['VALUES', 'DISTRIBUTION', 'CORRELATION'].includes(input.analysis)
    const requestedAsOf = pointInTimeAnalysis ? parseIsoDate(input.asOfDate, 'asOfDate') : null
    const analysisRange = pointInTimeAnalysis ? null : normalizeAnalysisRange(input.startDate, input.endDate)
    const dataThroughCompact = pointInTimeAnalysis
      ? await this.resolveCommonTradeDate(
          definitions.map((item) => item.name),
          requestedAsOf ? isoToCompactDate(input.asOfDate!) : undefined,
        )
      : analysisRange!.endCompact
    if (!dataThroughCompact) throw new MarketMultiAssetToolError('DATA_NOT_READY', '请求因子没有共同可用快照日期')

    let result: unknown
    let algorithmVersion: string
    if (input.analysis === 'VALUES') {
      const page = input.page ?? 1
      const pageSize = input.pageSize ?? 50
      requireInteger(page, 'page', 1, 1_000)
      requireInteger(pageSize, 'pageSize', 10, 200)
      const definition = definitions[0]
      result = await this.compute.getFactorValues(
        {
          factorName: definition.name,
          tradeDate: dataThroughCompact,
          universe: universeCode,
          page,
          pageSize,
          sortOrder: 'desc',
        },
        definition.sourceType,
        definition.name,
      )
      algorithmVersion = 'factor-values.v1'
    } else if (input.analysis === 'DISTRIBUTION') {
      const bins = input.bins ?? 50
      requireInteger(bins, 'bins', 10, 100)
      result = await this.analysisService.getDistribution({
        factorName: definitions[0].name,
        tradeDate: dataThroughCompact,
        universe: universeCode,
        bins,
      })
      algorithmVersion = 'factor-distribution.v1'
    } else if (input.analysis === 'CORRELATION') {
      result = await this.analysisService.getCorrelation({
        factorNames: definitions.map((item) => item.name),
        tradeDate: dataThroughCompact,
        universe: universeCode,
        method: input.icMethod === 'PEARSON' ? 'pearson' : 'spearman',
      })
      algorithmVersion = 'factor-correlation.v2-average-ties'
    } else {
      const { startCompact, endCompact } = analysisRange!
      if (input.analysis === 'IC') {
        const forwardDays = input.forwardDays ?? 5
        requireInteger(forwardDays, 'forwardDays', 1, 60)
        result = await this.analysisService.getIcAnalysis({
          factorName: definitions[0].name,
          startDate: startCompact,
          endDate: endCompact,
          universe: universeCode,
          forwardDays,
          icMethod: input.icMethod === 'PEARSON' ? 'normal' : 'rank',
        })
        algorithmVersion = 'factor-ic.v2-average-ties'
      } else if (input.analysis === 'QUANTILE') {
        const quantiles = input.quantiles ?? 5
        const rebalanceDays = input.rebalanceDays ?? 5
        requireInteger(quantiles, 'quantiles', 3, 10)
        requireInteger(rebalanceDays, 'rebalanceDays', 1, 20)
        result = await this.analysisService.getQuantileAnalysis({
          factorName: definitions[0].name,
          startDate: startCompact,
          endDate: endCompact,
          universe: universeCode,
          quantiles,
          rebalanceDays,
        })
        algorithmVersion = 'factor-quantile.v1'
      } else {
        const periods = normalizeDecayPeriods(input.decayPeriods)
        result = await this.analysisService.getDecayAnalysis({
          factorName: definitions[0].name,
          startDate: startCompact,
          endDate: endCompact,
          universe: universeCode,
          periods,
        })
        algorithmVersion = 'factor-decay.v2-average-ties'
      }
    }

    const sampleCount = await this.resolveSampleCount(
      input.analysis,
      result,
      definitions[0].name,
      dataThroughCompact,
      universeCode,
    )
    return {
      data: {
        analysis: input.analysis,
        factorDefinitions: definitions.map((definition) => ({
          name: definition.name,
          label: definition.label,
          direction: null,
          unit: null,
          sourceType: definition.sourceType,
          definitionVersion: 'factor-definition.v1',
          definitionHash: hashDefinition(definition),
        })),
        universe,
        requestedAsOfDate: pointInTimeAnalysis ? (input.asOfDate ?? null) : null,
        dataThrough: compactToIsoDate(dataThroughCompact),
        sampleCount,
        result,
        algorithmVersion,
      },
      warnings: [],
      truncated:
        input.analysis === 'VALUES' &&
        typeof result === 'object' &&
        result !== null &&
        Number((result as { total?: number }).total ?? 0) > Number((result as { pageSize?: number }).pageSize ?? 0),
    }
  }

  private async resolveCommonTradeDate(factorNames: string[], maximumDate?: string): Promise<string | null> {
    const maximum = maximumDate ? Prisma.sql`AND trade_date <= ${maximumDate}` : Prisma.empty
    const rows = await this.prisma.$queryRaw<Array<{ trade_date: string }>>(Prisma.sql`
      SELECT trade_date
      FROM factor_snapshots
      WHERE factor_name IN (${Prisma.join(factorNames)})
      ${maximum}
      GROUP BY trade_date
      HAVING COUNT(DISTINCT factor_name) = ${factorNames.length}
      ORDER BY trade_date DESC
      LIMIT 1
    `)
    return rows[0]?.trade_date ?? null
  }

  private async resolveSampleCount(
    analysis: FactorAnalysisType,
    result: unknown,
    factorName: string,
    tradeDate: string,
    universeCode?: string,
  ): Promise<number> {
    const value = result as {
      total?: number
      stats?: { count?: number }
      nMatrix?: number[][]
      series?: Array<{ stockCount: number }>
      groups?: Array<{ averageSampleCount?: number }>
    }
    if (analysis === 'VALUES') return Number(value.total ?? 0)
    if (analysis === 'DISTRIBUTION') return Number(value.stats?.count ?? 0)
    if (analysis === 'CORRELATION')
      return Math.max(0, ...(value.nMatrix?.map((row: number[], index: number) => row[index]) ?? [0]))
    if (analysis === 'IC')
      return Math.max(0, ...(value.series?.map((item: { stockCount: number }) => item.stockCount) ?? [0]))
    if (analysis === 'QUANTILE')
      return Math.round(Math.max(0, ...(value.groups?.map((item) => item.averageSampleCount ?? 0) ?? [0])))
    const universeJoin = universeCode
      ? Prisma.sql`INNER JOIN index_constituent_weights iw ON iw.con_code = fs.ts_code
          AND iw.index_code = ${universeCode}
          AND iw.trade_date = (
            SELECT MAX(trade_date) FROM index_constituent_weights
            WHERE index_code = ${universeCode} AND trade_date <= ${tradeDate}
          )`
      : Prisma.empty
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM factor_snapshots fs
      ${universeJoin}
      WHERE fs.factor_name = ${factorName}
        AND fs.trade_date = ${tradeDate}
        AND fs.value IS NOT NULL
    `)
    return Number(rows[0]?.count ?? 0)
  }
}

const UNIVERSE_CODE: Record<FactorUniverse, string | undefined> = {
  ALL: undefined,
  HS300: '000300.SH',
  ZZ500: '000905.SH',
  ZZ1000: '000852.SH',
}

function assertRelevantFields(input: FactorAnalysisToolInput): void {
  const common = ['analysis', 'factorNames', 'universe']
  const byAnalysis: Record<FactorAnalysisType, string[]> = {
    VALUES: ['asOfDate', 'page', 'pageSize'],
    IC: ['startDate', 'endDate', 'forwardDays', 'icMethod'],
    QUANTILE: ['startDate', 'endDate', 'quantiles', 'rebalanceDays'],
    DECAY: ['startDate', 'endDate', 'decayPeriods'],
    DISTRIBUTION: ['asOfDate', 'bins'],
    CORRELATION: ['asOfDate', 'icMethod'],
  }
  const allowed = new Set([...common, ...byAnalysis[input.analysis]])
  const irrelevant = Object.keys(input).filter((field) => !allowed.has(field))
  if (irrelevant.length) {
    throw new MarketMultiAssetToolError(
      'INVALID_ARGUMENT',
      `${input.analysis} 不接受字段：${irrelevant.sort().join('、')}`,
    )
  }
}

function normalizeFactorNames(analysis: FactorAnalysisType, values: string[]): string[] {
  if (!Array.isArray(values)) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'factorNames 必填')
  const factorNames = values.map((value) => value.trim()).filter(Boolean)
  const required =
    analysis === 'CORRELATION' ? factorNames.length >= 2 && factorNames.length <= 10 : factorNames.length === 1
  if (!required || new Set(factorNames).size !== factorNames.length) {
    throw new MarketMultiAssetToolError(
      'INVALID_ARGUMENT',
      analysis === 'CORRELATION' ? 'CORRELATION 需要 2-10 个不重复因子' : `${analysis} 需要且仅允许 1 个因子`,
    )
  }
  if (factorNames.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name))) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'factorNames 包含非法名称')
  }
  return factorNames
}

function normalizeAnalysisRange(startDate?: string, endDate?: string) {
  const start = parseIsoDate(startDate, 'startDate')
  const end = parseIsoDate(endDate, 'endDate')
  if (!start || !end) throw new MarketMultiAssetToolError('INVALID_ARGUMENT', '该 analysis 必须传 startDate 和 endDate')
  validateDateRange(start, end, 1_096)
  return { startCompact: isoToCompactDate(startDate!), endCompact: isoToCompactDate(endDate!) }
}

function normalizeDecayPeriods(values?: number[]): number[] {
  const periods = values?.length ? values : [1, 3, 5, 10, 20]
  if (
    periods.length < 1 ||
    periods.length > 10 ||
    new Set(periods).size !== periods.length ||
    periods.some((value) => !Number.isInteger(value) || value < 1 || value > 60)
  ) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', 'decayPeriods 必须包含 1-10 个不重复的 1-60 整数')
  }
  return periods
}

function hashDefinition(definition: {
  name: string
  label: string
  category: unknown
  sourceType: unknown
  sourceTable: string | null
  sourceField: string | null
  expression: string | null
  params: unknown
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: definition.name,
        label: definition.label,
        category: definition.category,
        sourceType: definition.sourceType,
        sourceTable: definition.sourceTable,
        sourceField: definition.sourceField,
        expression: definition.expression,
        params: definition.params,
      }),
    )
    .digest('hex')
}
