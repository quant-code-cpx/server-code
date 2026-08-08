import { Injectable } from '@nestjs/common'
import type { PortfolioDailySnapshot, PortfolioPositionSnapshot } from '@prisma/client'
import { type SectionResult, notReady, notRequested, ok } from 'src/apps/stock-deep-research/stock-deep-research.types'
import { PORTFOLIO_NAV_ALGORITHM_VERSION } from './portfolio-snapshot.service'
import { PortfolioAnalyticsRepository } from './portfolio-analytics.repository'

export const PORTFOLIO_ANALYTICS_SECTIONS = ['OVERVIEW', 'PERFORMANCE', 'PNL', 'DRIFT', 'TRADES'] as const
export type PortfolioAnalyticsSection = (typeof PORTFOLIO_ANALYTICS_SECTIONS)[number]

export interface PortfolioAnalyticsToolInput {
  portfolioId: string
  sections?: PortfolioAnalyticsSection[]
  asOfDate?: string
  startDate?: string
  endDate?: string
  benchmarkCode?: '000300.SH' | '000905.SH' | '000852.SH'
  targetWeights?: Record<string, number>
  tradePage?: number
  tradePageSize?: number
  maxSeriesPoints?: number
}

interface PortfolioOverview {
  totalAssets: number
  marketValue: number
  cash: number
  holdingCount: number
  topPositions: Array<{ tsCode: string; name: string | null; weight: number | null }>
}

interface PortfolioPerformance {
  totalReturn: number | null
  annualizedReturn: number | null
  benchmarkReturn: number | null
  excessReturn: number | null
  volatility: number | null
  maxDrawdown: number | null
  sharpeRatio: number | null
  beta: number | null
  series: Array<{ tradeDate: string; nav: number; benchmarkNav: number | null; drawdown: number | null }>
}

@Injectable()
export class PortfolioAnalyticsToolFacade {
  constructor(private readonly repository: PortfolioAnalyticsRepository) {}

  async analyze(userId: number, input: PortfolioAnalyticsToolInput) {
    const command = normalizeInput(input)
    const portfolio = await this.repository.findOwnedPortfolio(command.portfolioId, userId)
    if (!portfolio) throw new PortfolioAnalyticsToolError('DATA_NOT_FOUND', '组合不存在或无权访问')
    const coverage = await this.repository.getCoverage(command.portfolioId, userId)
    if (!coverage.coverageStart || !coverage.dataThrough) {
      throw new PortfolioAnalyticsToolError('DATA_NOT_READY', '组合点时快照尚未生成')
    }

    const requestedAsOf = command.asOfDate ? parseDate(command.asOfDate, 'asOfDate') : coverage.dataThrough
    const effectiveEnd = command.endDate ? parseDate(command.endDate, 'endDate') : requestedAsOf
    const defaultStart = new Date(effectiveEnd)
    defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - 1)
    const effectiveStart = command.startDate
      ? parseDate(command.startDate, 'startDate')
      : maxDate(defaultStart, coverage.coverageStart)
    if (effectiveStart > effectiveEnd) throw invalid('startDate 不能晚于 endDate')
    if (dayDiff(effectiveStart, effectiveEnd) > 366 * 5) throw invalid('组合分析区间不能超过 5 年')
    if (effectiveStart < coverage.coverageStart) {
      throw new PortfolioAnalyticsToolError('DATA_NOT_READY', '请求区间早于点时持仓覆盖起点', false, {
        coverageStart: toIsoDate(coverage.coverageStart),
      })
    }

    const asOfSnapshot = await this.repository.getSnapshotAtOrBefore(command.portfolioId, userId, requestedAsOf)
    if (!asOfSnapshot || asOfSnapshot.tradeDate < coverage.coverageStart) {
      throw new PortfolioAnalyticsToolError('DATA_NOT_READY', '请求时点无组合快照')
    }
    const [snapshots, positions, previous, benchmarkCloses] = await Promise.all([
      this.repository.getSnapshots(command.portfolioId, userId, effectiveStart, effectiveEnd),
      this.repository.getPositions(command.portfolioId, userId, asOfSnapshot.tradeDate),
      this.repository.getPreviousSnapshot(command.portfolioId, userId, asOfSnapshot.tradeDate),
      this.repository.getBenchmarkCloses(command.benchmarkCode, effectiveStart, effectiveEnd),
    ])
    if (snapshots.length > 1_250) throw new PortfolioAnalyticsToolError('RESULT_TOO_LARGE', '组合快照超过服务端上限')
    const names = await this.repository.getNames(positions.map((row) => row.tsCode))
    const requested = new Set(command.sections)
    const overview = requested.has('OVERVIEW')
      ? ok<PortfolioOverview>({
          totalAssets: Number(asOfSnapshot.totalAssets),
          marketValue: Number(asOfSnapshot.marketValue),
          cash: Number(asOfSnapshot.cash),
          holdingCount: positions.length,
          topPositions: positions.slice(0, 20).map((position) => ({
            tsCode: position.tsCode,
            name: names.get(position.tsCode) ?? null,
            weight: finiteOrNull(position.weight),
          })),
        })
      : notRequested()
    const performance = requested.has('PERFORMANCE')
      ? snapshots.length >= 2
        ? ok(computePerformance(snapshots, benchmarkCloses, command.maxSeriesPoints))
        : notReady('绩效计算至少需要两个组合快照')
      : notRequested()
    const pnl = requested.has('PNL')
      ? ok(computePnl(portfolio.initialCash.toNumber(), asOfSnapshot, previous, positions))
      : notRequested()
    const drift = requested.has('DRIFT')
      ? command.targetWeights
        ? ok(computeDrift(positions, command.targetWeights))
        : notReady('持仓漂移分析需要 targetWeights')
      : notRequested()
    const trades = requested.has('TRADES')
      ? ok(await this.loadTrades(command.portfolioId, userId, command.tradePage, command.tradePageSize))
      : notRequested()
    const qualityFlags = uniqueStrings([
      ...jsonStrings(asOfSnapshot.qualityFlags),
      ...positions.flatMap((position) => jsonStrings(position.qualityFlags)),
      ...(requested.has('PERFORMANCE') && benchmarkCloses.length === 0 ? ['BENCHMARK_DATA_NOT_READY'] : []),
    ])

    return {
      data: {
        meta: {
          portfolioId: portfolio.id,
          name: portfolio.name,
          coverageStart: toIsoDate(coverage.coverageStart),
          requestedAsOfDate: command.asOfDate ?? null,
          dataThrough: toIsoDate(asOfSnapshot.tradeDate),
          benchmarkCode: command.benchmarkCode,
          algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
          ownerScoped: true as const,
        },
        overview,
        performance,
        pnl,
        drift,
        trades,
      },
      asOf: toIsoDate(asOfSnapshot.tradeDate),
      sourceModels: [
        'Portfolio',
        'PortfolioHoldingEvent',
        'PortfolioDailySnapshot',
        'PortfolioPositionSnapshot',
        'IndexDaily',
      ],
      warnings: qualityFlags.map((code) => ({ code, message: qualityMessage(code) })),
      rowCount: snapshots.length + positions.length + (trades.status === 'OK' ? trades.data.items.length : 0),
    }
  }

  private async loadTrades(portfolioId: string, userId: number, page: number, pageSize: number) {
    const result = await this.repository.getEvents(portfolioId, userId, page, pageSize)
    return {
      total: result.total,
      page,
      pageSize,
      items: result.items.map((event) => ({
        id: event.id,
        tsCode: event.tsCode,
        action: event.action,
        quantityDelta: event.quantityDelta,
        price: event.price?.toNumber() ?? null,
        beforeQuantity: event.beforeQuantity,
        afterQuantity: event.afterQuantity,
        effectiveDate: toIsoDate(event.effectiveDate),
        occurredAt: event.occurredAt.toISOString(),
        source: event.source,
      })),
    }
  }
}

export class PortfolioAnalyticsToolError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'DATA_NOT_FOUND' | 'DATA_NOT_READY' | 'RESULT_TOO_LARGE' | 'UPSTREAM_FAILED',
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message)
    this.name = PortfolioAnalyticsToolError.name
  }
}

function normalizeInput(input: PortfolioAnalyticsToolInput) {
  if (!input || typeof input !== 'object') throw invalid('输入必须为对象')
  const portfolioId = input.portfolioId?.trim()
  if (!portfolioId || portfolioId.length > 32) throw invalid('portfolioId 长度必须为 1-32')
  const sections = input.sections?.length
    ? input.sections
    : (['OVERVIEW', 'PERFORMANCE'] as PortfolioAnalyticsSection[])
  if (
    sections.length < 1 ||
    sections.length > 5 ||
    new Set(sections).size !== sections.length ||
    sections.some((section) => !PORTFOLIO_ANALYTICS_SECTIONS.includes(section))
  ) {
    throw invalid('sections 非法或重复')
  }
  const tradePage = input.tradePage ?? 1
  const tradePageSize = input.tradePageSize ?? 50
  const maxSeriesPoints = input.maxSeriesPoints ?? 500
  if (!Number.isInteger(tradePage) || tradePage < 1) throw invalid('tradePage 必须为正整数')
  if (!Number.isInteger(tradePageSize) || tradePageSize < 1 || tradePageSize > 100)
    throw invalid('tradePageSize 必须为 1-100')
  if (!Number.isInteger(maxSeriesPoints) || maxSeriesPoints < 20 || maxSeriesPoints > 1_000) {
    throw invalid('maxSeriesPoints 必须为 20-1000')
  }
  const targetWeights = input.targetWeights
  if (targetWeights) {
    const entries = Object.entries(targetWeights)
    if (
      entries.length > 100 ||
      entries.some(
        ([code, weight]) => !/^\d{6}\.(SH|SZ|BJ)$/.test(code) || !Number.isFinite(weight) || weight < 0 || weight > 1,
      )
    ) {
      throw invalid('targetWeights 最多 100 项，代码或权重非法')
    }
    const sum = entries.reduce((value, [, weight]) => value + weight, 0)
    if (Math.abs(sum - 1) > 0.0001) throw invalid('targetWeights 权重和必须约等于 1')
  }
  return {
    portfolioId,
    sections,
    asOfDate: input.asOfDate,
    startDate: input.startDate,
    endDate: input.endDate,
    benchmarkCode: input.benchmarkCode ?? ('000300.SH' as const),
    targetWeights,
    tradePage,
    tradePageSize,
    maxSeriesPoints,
  }
}

function computePerformance(
  rows: PortfolioDailySnapshot[],
  benchmarkRows: Array<{ tradeDate: Date; close: number | null }>,
  maxPoints: number,
): PortfolioPerformance {
  const first = rows[0]
  const last = rows.at(-1) as PortfolioDailySnapshot
  const firstNav = Number(first.nav)
  const lastNav = Number(last.nav)
  const totalReturn = firstNav > 0 ? lastNav / firstNav - 1 : null
  const periods = rows.length - 1
  const annualizedReturn =
    totalReturn == null || 1 + totalReturn <= 0 ? null : Math.pow(1 + totalReturn, 252 / periods) - 1
  const returns = rows
    .map((row) => row.dailyReturn)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const benchmarkNavs = alignBenchmarkNav(rows, benchmarkRows)
  const returnPairs = rows.flatMap((row, index) => {
    if (index === 0 || row.dailyReturn == null || !Number.isFinite(row.dailyReturn)) return []
    const previousNav = benchmarkNavs[index - 1]
    const currentNav = benchmarkNavs[index]
    if (previousNav == null || currentNav == null || previousNav <= 0) return []
    return [{ portfolio: row.dailyReturn, benchmark: currentNav / previousNav - 1 }]
  })
  const volatility = returns.length >= 2 ? stddev(returns) * Math.sqrt(252) : null
  const sharpeRatio = volatility && volatility > 0 ? (mean(returns) * 252) / volatility : null
  const firstBenchmark = benchmarkNavs[0]
  const lastBenchmark = benchmarkNavs.at(-1) ?? null
  const benchmarkReturn = firstBenchmark && lastBenchmark != null ? lastBenchmark / firstBenchmark - 1 : null
  const excessReturn = totalReturn != null && benchmarkReturn != null ? totalReturn - benchmarkReturn : null
  const pairedPortfolioReturns = returnPairs.map((pair) => pair.portfolio)
  const pairedBenchmarkReturns = returnPairs.map((pair) => pair.benchmark)
  const beta =
    returnPairs.length >= 2
      ? covariance(pairedPortfolioReturns, pairedBenchmarkReturns) / variance(pairedBenchmarkReturns)
      : null
  let peak = Number.NEGATIVE_INFINITY
  let maxDrawdown = 0
  const fullSeries = rows.map((row, index) => {
    const nav = Number(row.nav)
    peak = Math.max(peak, nav)
    const drawdown = peak > 0 ? nav / peak - 1 : null
    if (drawdown != null) maxDrawdown = Math.min(maxDrawdown, drawdown)
    return {
      tradeDate: toIsoDate(row.tradeDate),
      nav,
      benchmarkNav: benchmarkNavs[index] ?? null,
      drawdown,
    }
  })
  return {
    totalReturn,
    annualizedReturn,
    benchmarkReturn,
    excessReturn,
    volatility,
    maxDrawdown,
    sharpeRatio,
    beta: beta != null && Number.isFinite(beta) ? beta : null,
    series: evenlySample(fullSeries, maxPoints),
  }
}

function alignBenchmarkNav(
  snapshots: PortfolioDailySnapshot[],
  rows: Array<{ tradeDate: Date; close: number | null }>,
): Array<number | null> {
  let cursor = 0
  let lastClose: number | null = null
  let baseClose: number | null = null
  return snapshots.map((snapshot) => {
    while (cursor < rows.length && rows[cursor].tradeDate <= snapshot.tradeDate) {
      const close = rows[cursor].close
      if (close != null && Number.isFinite(close) && close > 0) {
        lastClose = close
        baseClose ??= close
      }
      cursor += 1
    }
    return lastClose != null && baseClose != null ? lastClose / baseClose : null
  })
}

function computePnl(
  initialCash: number,
  current: PortfolioDailySnapshot,
  previous: PortfolioDailySnapshot | null,
  positions: PortfolioPositionSnapshot[],
) {
  const totalPnl = Number(current.totalAssets) - initialCash
  const byPosition = positions.map((position) => {
    const marketValue = position.marketValue?.toNumber() ?? null
    const cost = position.avgCost.toNumber() * position.quantity
    const pnl = marketValue == null ? null : marketValue - cost
    return { tsCode: position.tsCode, pnl, contribution: pnl == null || totalPnl === 0 ? null : pnl / totalPnl }
  })
  const unrealizedPnl = byPosition.every((row) => row.pnl != null)
    ? byPosition.reduce((sum, row) => sum + (row.pnl as number), 0)
    : null
  return {
    totalPnl,
    realizedPnl: null,
    unrealizedPnl,
    dailyPnl: previous ? Number(current.totalAssets) - Number(previous.totalAssets) : null,
    byPosition,
  }
}

function computeDrift(positions: PortfolioPositionSnapshot[], targetWeights?: Record<string, number>) {
  const current = new Map(positions.map((position) => [position.tsCode, finiteOrNull(position.weight)]))
  const codes = [...new Set([...current.keys(), ...Object.keys(targetWeights ?? {})])].sort()
  return codes.map((tsCode) => {
    const currentWeight = current.get(tsCode) ?? 0
    const targetWeight = targetWeights?.[tsCode] ?? 0
    return { tsCode, currentWeight, targetWeight, drift: currentWeight == null ? null : currentWeight - targetWeight }
  })
}

function parseDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`${field} 必须为 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) throw invalid(`${field} 不是有效日期`)
  return parsed
}

function invalid(message: string): PortfolioAnalyticsToolError {
  return new PortfolioAnalyticsToolError('INVALID_ARGUMENT', message)
}

function evenlySample<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values
  return Array.from(
    { length: maximum },
    (_, index) => values[Math.round((index * (values.length - 1)) / (maximum - 1))],
  )
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function variance(values: number[]): number {
  if (values.length === 0) return 0
  const average = mean(values)
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
}

function stddev(values: number[]): number {
  return Math.sqrt(variance(values))
}

function covariance(left: number[], right: number[]): number {
  const leftMean = mean(left)
  const rightMean = mean(right)
  return left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0) / left.length
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function qualityMessage(code: string): string {
  if (code === 'POSITION_PRICE_STALE') return '停牌或缺行情日使用最近已知收盘价'
  if (code === 'BENCHMARK_PRICE_STALE') return '基准使用最近已知收盘价'
  if (code === 'REALIZED_PNL_NOT_AVAILABLE') return '事件账本不含完整成交现金流，已实现盈亏不可用'
  if (code === 'BENCHMARK_DATA_NOT_READY') return '请求区间缺少基准指数行情，基准收益和 Beta 不可用'
  return code
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? left : right
}

function dayDiff(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export type PortfolioAnalyticsSectionResult = SectionResult<unknown>
