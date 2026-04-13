import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { PrismaService } from 'src/shared/prisma.service'
import {
  BacktestConfig,
  BacktestResult,
  DailyBar,
  DailyNavRecord,
  PortfolioState,
  PositionSnapshot,
  RebalanceFrequency,
  SignalOutput,
  UNIVERSE_INDEX_CODE,
} from '../types/backtest-engine.types'
import { BacktestDataService } from './backtest-data.service'
import { BacktestExecutionService } from './backtest-execution.service'
import { BacktestMetricsService } from './backtest-metrics.service'
import { BacktestStrategyRegistryService } from './backtest-strategy-registry.service'

@Injectable()
export class BacktestEngineService {
  private readonly logger = new Logger(BacktestEngineService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataService: BacktestDataService,
    private readonly executionService: BacktestExecutionService,
    private readonly metricsService: BacktestMetricsService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
  ) {}

  async runBacktest(
    config: BacktestConfig,
    onProgress?: (pct: number, step: string) => Promise<void>,
  ): Promise<BacktestResult> {
    this.logger.log(`Starting backtest runId=${config.runId} strategy=${config.strategyType}`)

    // ── 1. Load trading days ─────────────────────────────────────────────────
    await onProgress?.(5, 'loading-data')
    const tradingDays = await this.dataService.getTradingDays(config.startDate, config.endDate)
    if (tradingDays.length === 0) {
      throw new BusinessException(ErrorEnum.BACKTEST_NO_TRADING_DAYS)
    }

    // ── 2. Determine initial universe ────────────────────────────────────────
    const universe = await this.resolveUniverse(config, tradingDays[0])

    // ── 3. Load all bar data upfront ─────────────────────────────────────────
    // For efficiency, load a wider date range to support MA lookback
    const lookbackDays = 60
    const dataStartDate = new Date(config.startDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000)

    await onProgress?.(10, 'loading-data')
    this.logger.log(`Loading bars for ${universe.length} stocks`)

    // Load in batches to avoid memory pressure
    const BATCH_SIZE = 500
    const allBarsMap = new Map<string, Map<string, DailyBar>>()
    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
      const batch = universe.slice(i, i + BATCH_SIZE)
      const batchBars = await this.dataService.loadDailyBars(batch, dataStartDate, config.endDate)
      for (const [code, bars] of batchBars) {
        allBarsMap.set(code, bars)
      }
    }

    const benchmarkBars = await this.dataService.loadBenchmarkBars(
      config.benchmarkTsCode,
      config.startDate,
      config.endDate,
    )

    // ── 4. Initialize strategy ───────────────────────────────────────────────
    const strategy = this.strategyRegistry.getStrategy(config.strategyType)
    if (strategy.initialize) {
      await strategy.initialize(config, this.prisma)
    }

    // ── 5. Initialize portfolio state ────────────────────────────────────────
    const portfolio: PortfolioState = {
      cash: config.initialCapital,
      positions: new Map(),
      nav: config.initialCapital,
    }

    const navRecords: DailyNavRecord[] = []
    const allTrades = []
    const allPositionSnapshots: PositionSnapshot[] = []
    const allRebalanceLogs = []

    let highWaterMark = config.initialCapital
    let benchmarkBase: number | null = null

    let pendingSignal: { signal: SignalOutput; signalDate: Date } | null = null

    const isRebalanceDay = (date: Date, idx: number) =>
      this.checkRebalanceDay(date, tradingDays, idx, config.rebalanceFrequency)

    await onProgress?.(20, 'generating-signals')

    // ── 6. Main backtest loop ────────────────────────────────────────────────
    for (let idx = 0; idx < tradingDays.length; idx++) {
      const today = tradingDays[idx]
      const todayStr = today.toISOString().slice(0, 10)

      // Build today's bar snapshot
      const todayBars = this.getTodayBars(allBarsMap, todayStr)

      // Adjust cost price and quantity for stock splits/dividends before mark-to-market
      if (idx > 0) {
        const prevTodayStr = tradingDays[idx - 1].toISOString().slice(0, 10)
        const prevBars = this.getTodayBars(allBarsMap, prevTodayStr)
        this.adjustCostPriceForSplits(portfolio, todayBars, prevBars)
      }

      // Execute pending signal (T+1 execution)
      if (pendingSignal) {
        const { trades, rebalanceLog } = this.executionService.executeTrades(
          portfolio,
          pendingSignal.signal,
          todayBars,
          config,
          pendingSignal.signalDate,
          today,
        )
        allTrades.push(...trades)
        allRebalanceLogs.push(rebalanceLog)
        pendingSignal = null

        // Save position snapshot after rebalance
        const posSnapshot = this.buildPositionSnapshots(portfolio, todayBars, today)
        allPositionSnapshots.push(...posSnapshot)
      }

      // Generate signal for today (will be executed T+1)
      if (isRebalanceDay(today, idx)) {
        const historicalBars = this.buildHistoricalBars(allBarsMap, todayStr)

        // If universe changes with time (index), refresh it
        if (!['ALL_A', 'CUSTOM'].includes(config.universe)) {
          const freshUniverse = await this.resolveUniverse(config, today)
          // Ensure we have bars for new stocks
          const missingCodes = freshUniverse.filter((c) => !allBarsMap.has(c))
          if (missingCodes.length > 0) {
            const newBars = await this.dataService.loadDailyBars(missingCodes, dataStartDate, config.endDate)
            for (const [code, bars] of newBars) allBarsMap.set(code, bars)
          }
        }

        const signal = await strategy.generateSignal(today, config, todayBars, historicalBars, this.prisma)
        pendingSignal = { signal, signalDate: today }
      }

      // ── Daily mark-to-market ─────────────────────────────────────────────
      const posValue = this.computePositionValueWithAdjFactor(portfolio, todayBars)
      const nav = portfolio.cash + posValue

      const benchmarkClose = benchmarkBars.get(todayStr) ?? null
      if (benchmarkBase === null && benchmarkClose !== null) benchmarkBase = benchmarkClose

      const benchmarkNav = benchmarkBase && benchmarkClose ? benchmarkClose / benchmarkBase : 1

      const prevRecord = navRecords[navRecords.length - 1]
      const dailyReturn = prevRecord ? nav / prevRecord.nav - 1 : 0
      const prevBenchmarkNav = prevRecord ? prevRecord.benchmarkNav : 1
      const benchmarkReturn = benchmarkNav / prevBenchmarkNav - 1

      highWaterMark = Math.max(highWaterMark, nav)
      const drawdown = highWaterMark > 0 ? nav / highWaterMark - 1 : 0
      const exposure = nav > 0 ? posValue / nav : 0
      const cashRatio = nav > 0 ? portfolio.cash / nav : 1

      navRecords.push({
        tradeDate: today,
        nav,
        benchmarkNav,
        dailyReturn,
        benchmarkReturn,
        drawdown,
        cash: portfolio.cash,
        positionValue: posValue,
        exposure,
        cashRatio,
      })

      portfolio.nav = nav

      const pct = 20 + Math.round((idx / tradingDays.length) * 60)
      if (idx % 20 === 0) await onProgress?.(pct, 'generating-signals')
    }

    // ── 7. Compute metrics ───────────────────────────────────────────────────
    await onProgress?.(85, 'computing-metrics')
    const metrics = this.metricsService.computeMetrics(navRecords, allTrades, config)

    this.logger.log(
      `Backtest complete runId=${config.runId}: return=${(metrics.totalReturn * 100).toFixed(2)}% sharpe=${metrics.sharpeRatio.toFixed(2)}`,
    )

    return {
      navRecords,
      trades: allTrades,
      positions: allPositionSnapshots,
      rebalanceLogs: allRebalanceLogs,
      metrics,
    }
  }

  private async resolveUniverse(config: BacktestConfig, date: Date): Promise<string[]> {
    if (config.universe === 'ALL_A') {
      return this.dataService.getAllListedStocks(date, config.minDaysListed)
    }
    if (config.universe === 'CUSTOM') {
      return config.customUniverseTsCodes ?? []
    }
    const indexCode = UNIVERSE_INDEX_CODE[config.universe]
    if (!indexCode) return []
    return this.dataService.getIndexConstituents(indexCode, date)
  }

  private getTodayBars(allBarsMap: Map<string, Map<string, DailyBar>>, todayStr: string): Map<string, DailyBar> {
    const result = new Map<string, DailyBar>()
    for (const [tsCode, dateMap] of allBarsMap) {
      const bar = dateMap.get(todayStr)
      if (bar) result.set(tsCode, bar)
    }
    return result
  }

  private buildHistoricalBars(
    allBarsMap: Map<string, Map<string, DailyBar>>,
    upToDateStr: string,
  ): Map<string, DailyBar[]> {
    const result = new Map<string, DailyBar[]>()
    for (const [tsCode, dateMap] of allBarsMap) {
      const bars = [...dateMap.entries()]
        .filter(([d]) => d <= upToDateStr)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, bar]) => bar)
      if (bars.length > 0) result.set(tsCode, bars)
    }
    return result
  }

  private computePositionValueWithAdjFactor(portfolio: PortfolioState, todayBars: Map<string, DailyBar>): number {
    let value = 0
    for (const [tsCode, pos] of portfolio.positions) {
      const bar = todayBars.get(tsCode)
      const price = bar?.close ?? null
      if (price !== null) value += pos.quantity * price
      else value += pos.quantity * pos.costPrice // fallback
    }
    return value
  }

  private buildPositionSnapshots(
    portfolio: PortfolioState,
    todayBars: Map<string, DailyBar>,
    date: Date,
  ): PositionSnapshot[] {
    const totalValue =
      portfolio.cash +
      [...portfolio.positions.values()].reduce((s, p) => {
        const bar = todayBars.get(p.tsCode)
        return s + p.quantity * (bar?.close ?? p.costPrice)
      }, 0)

    const snapshots: PositionSnapshot[] = []
    for (const [tsCode, pos] of portfolio.positions) {
      const bar = todayBars.get(tsCode)
      const closePrice = bar?.close ?? null
      const marketValue = closePrice ? pos.quantity * closePrice : null
      const weight = marketValue !== null && totalValue > 0 ? marketValue / totalValue : null
      const unrealizedPnl = closePrice !== null ? pos.quantity * (closePrice - pos.costPrice) : null
      const holdingDays = Math.round((date.getTime() - pos.entryDate.getTime()) / (1000 * 60 * 60 * 24))

      snapshots.push({
        tradeDate: date,
        tsCode,
        quantity: pos.quantity,
        costPrice: pos.costPrice,
        closePrice,
        marketValue,
        weight,
        unrealizedPnl,
        holdingDays,
      })
    }
    return snapshots
  }

  /**
   * Adjust existing position cost price and quantity when adjFactor changes (splits/dividends).
   * Called once per trading day before mark-to-market.
   */
  private adjustCostPriceForSplits(
    portfolio: PortfolioState,
    todayBars: Map<string, DailyBar>,
    yesterdayBars: Map<string, DailyBar>,
  ): void {
    for (const [tsCode, pos] of portfolio.positions) {
      const todayBar = todayBars.get(tsCode)
      const yesterdayBar = yesterdayBars.get(tsCode)
      if (
        todayBar?.adjFactor !== null &&
        todayBar?.adjFactor !== undefined &&
        yesterdayBar?.adjFactor !== null &&
        yesterdayBar?.adjFactor !== undefined &&
        yesterdayBar.adjFactor !== 0 &&
        todayBar.adjFactor !== yesterdayBar.adjFactor
      ) {
        const ratio = todayBar.adjFactor / yesterdayBar.adjFactor
        pos.costPrice = pos.costPrice / ratio
        pos.quantity = Math.round(pos.quantity * ratio)
      }
    }
  }

  private checkRebalanceDay(date: Date, tradingDays: Date[], idx: number, frequency: RebalanceFrequency): boolean {
    if (frequency === 'DAILY') return true

    const prev = idx > 0 ? tradingDays[idx - 1] : null

    if (frequency === 'WEEKLY') {
      // First trading day of the week
      if (!prev) return true
      // Compare ISO week numbers: new week when week number changes
      const getISOWeek = (d: Date) => {
        const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
        return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
      }
      const getISOYear = (d: Date) => {
        const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
        return tmp.getUTCFullYear()
      }
      return getISOWeek(date) !== getISOWeek(prev) || getISOYear(date) !== getISOYear(prev)
    }

    if (frequency === 'MONTHLY') {
      if (!prev) return true
      return date.getMonth() !== prev.getMonth()
    }

    if (frequency === 'QUARTERLY') {
      if (!prev) return true
      const month = date.getMonth()
      const prevMonth = prev.getMonth()
      if (month === prevMonth) return false
      // Quarter starts: Jan(0), Apr(3), Jul(6), Oct(9)
      return month === 0 || month === 3 || month === 6 || month === 9
    }

    return false
  }
}
