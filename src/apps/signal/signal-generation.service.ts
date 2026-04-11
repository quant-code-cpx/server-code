import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestStrategyRegistryService } from 'src/apps/backtest/services/backtest-strategy-registry.service'
import { BacktestDataService } from 'src/apps/backtest/services/backtest-data.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { BacktestConfig, BacktestStrategyType, DailyBar, UNIVERSE_INDEX_CODE } from 'src/apps/backtest/types/backtest-engine.types'

@Injectable()
export class SignalGenerationService {
  private readonly logger = new Logger(SignalGenerationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
    private readonly dataService: BacktestDataService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * 由 TushareSyncService 在同步完成后异步调用。
   * 遍历所有激活策略，逐一生成信号。
   */
  async generateAllSignals(targetTradeDateStr?: string): Promise<void> {
    const latestTradeDate = await this.resolveTradeDate(targetTradeDateStr)
    if (!latestTradeDate) {
      this.logger.warn('无法获取最近交易日，跳过信号生成')
      return
    }

    const activations = await this.prisma.signalActivation.findMany({
      where: {
        isActive: true,
        NOT: { lastSignalDate: latestTradeDate },
      },
    })

    if (activations.length === 0) {
      this.logger.log('无待生成信号的激活策略')
      return
    }

    this.logger.log(`开始为 ${activations.length} 个激活策略生成信号，交易日：${latestTradeDate.toISOString().slice(0, 10)}`)

    for (const activation of activations) {
      try {
        await this.generateForActivation(activation.id, latestTradeDate)
      } catch (err) {
        this.logger.error(
          `策略 ${activation.strategyId} 信号生成失败：${(err as Error).message}`,
          (err as Error).stack,
        )
        // 不阻塞其他策略
      }
    }
  }

  /**
   * 为单个激活策略生成信号。
   */
  async generateForActivation(activationId: string, tradeDate?: Date): Promise<void> {
    const activation = await this.prisma.signalActivation.findUniqueOrThrow({
      where: { id: activationId },
    })

    const targetDate = tradeDate ?? (await this.resolveTradeDate(undefined))
    if (!targetDate) throw new Error('无法获取最近交易日')

    // 加载策略
    const strategy = await this.prisma.strategy.findUniqueOrThrow({
      where: { id: activation.strategyId },
      select: { id: true, name: true, strategyType: true, strategyConfig: true, backtestDefaults: true },
    })

    const strategyType = strategy.strategyType as BacktestStrategyType
    const strategyInstance = this.strategyRegistry.getStrategy(strategyType)

    // 构建 BacktestConfig（仅信号生成所需字段）
    const defaults = (strategy.backtestDefaults ?? {}) as Record<string, unknown>
    const config: BacktestConfig = {
      runId: `signal-${activation.id}-${targetDate.toISOString().slice(0, 10)}`,
      strategyType,
      strategyConfig: strategy.strategyConfig as BacktestConfig['strategyConfig'],
      startDate: new Date(targetDate.getTime() - activation.lookbackDays * 24 * 60 * 60 * 1000),
      endDate: targetDate,
      benchmarkTsCode: activation.benchmarkTsCode,
      universe: (activation.universe as BacktestConfig['universe']) ?? 'ALL_A',
      initialCapital: 1_000_000,
      rebalanceFrequency: 'MONTHLY',
      priceMode: 'NEXT_OPEN',
      commissionRate: 0.0003,
      stampDutyRate: 0.001,
      minCommission: 5,
      slippageBps: 5,
      maxPositions: 50,
      maxWeightPerStock: 0.2,
      minDaysListed: (defaults.minDaysListed as number) ?? 60,
      enableTradeConstraints: true,
      enableT1Restriction: true,
      partialFillEnabled: true,
    }

    // 初始化策略
    if (strategyInstance.initialize) {
      await strategyInstance.initialize(config, this.prisma)
    }

    // 解析股票宇宙
    const tsCodes = await this.resolveUniverse(config, targetDate)
    if (tsCodes.length === 0) {
      this.logger.warn(`策略 ${strategy.id} 的宇宙股池为空，跳过信号生成`)
      return
    }

    // 计算回看起始日
    const tradingDays = await this.dataService.getTradingDays(config.startDate, targetDate)
    const lookbackStart = tradingDays.length > 0 ? tradingDays[0] : config.startDate

    // 加载截面数据
    const allBarsMap = await this.dataService.loadDailyBars(tsCodes, lookbackStart, targetDate)

    // 构建当天 barData 和 historicalBars
    const targetDateStr = targetDate.toISOString().slice(0, 10)
    const barData = this.getTodayBars(allBarsMap, targetDateStr)
    const historicalBars = this.buildHistoricalBars(allBarsMap, targetDateStr)

    // 调用策略生成信号
    const signalOutput = await strategyInstance.generateSignal(targetDate, config, barData, historicalBars, this.prisma)

    if (!signalOutput.targets || signalOutput.targets.length === 0) {
      this.logger.log(`策略 ${strategy.id} 在 ${targetDateStr} 无信号目标`)
      await this.prisma.signalActivation.update({
        where: { id: activation.id },
        data: { lastSignalDate: targetDate },
      })
      return
    }

    // 若关联组合，获取当前持仓用于 action 判定
    const currentHoldings = await this.loadCurrentHoldings(activation.portfolioId)

    // 构建目标权重 Map
    const totalTargets = signalOutput.targets.length
    const targetWeightMap = new Map<string, number>()
    for (const t of signalOutput.targets) {
      targetWeightMap.set(t.tsCode, t.weight ?? 1 / totalTargets)
    }

    // 判定 action
    const signalRows = this.deriveActions(currentHoldings, targetWeightMap, !!activation.portfolioId)

    // 批量写入 TradingSignal（幂等）
    await this.prisma.tradingSignal.createMany({
      data: signalRows.map((s) => ({
        activationId: activation.id,
        strategyId: activation.strategyId,
        userId: activation.userId,
        tradeDate: targetDate,
        tsCode: s.tsCode,
        action: s.action,
        targetWeight: s.targetWeight,
        confidence: null,
      })),
      skipDuplicates: true,
    })

    // 更新 lastSignalDate
    await this.prisma.signalActivation.update({
      where: { id: activation.id },
      data: { lastSignalDate: targetDate },
    })

    // WebSocket 推送
    this.eventsGateway.emitToUser(activation.userId, 'signal_generated', {
      activationId: activation.id,
      strategyId: activation.strategyId,
      strategyName: strategy.name,
      tradeDate: targetDateStr,
      signalCount: signalRows.length,
    })

    this.logger.log(`策略 ${strategy.id} 在 ${targetDateStr} 生成 ${signalRows.length} 条信号`)
  }

  // ── 私有工具方法 ──────────────────────────────────────────────────────────

  private async resolveTradeDate(targetTradeDateStr?: string): Promise<Date | null> {
    if (targetTradeDateStr) {
      const s = targetTradeDateStr
      return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
    }
    const today = new Date()
    today.setHours(23, 59, 59, 0)
    const cal = await this.prisma.tradeCal.findFirst({
      where: { isOpen: '1', calDate: { lte: today } },
      orderBy: { calDate: 'desc' },
      select: { calDate: true },
    })
    return cal?.calDate ?? null
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

  private async loadCurrentHoldings(portfolioId: string | null): Promise<Set<string>> {
    if (!portfolioId) return new Set()
    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId },
      select: { tsCode: true },
    })
    return new Set(holdings.map((h) => h.tsCode))
  }

  private deriveActions(
    currentHoldings: Set<string>,
    newTargets: Map<string, number>,
    hasPortfolio: boolean,
  ): { tsCode: string; action: string; targetWeight: number }[] {
    if (!hasPortfolio) {
      // 无组合上下文，所有 targets 为 BUY
      return [...newTargets.entries()].map(([tsCode, weight]) => ({
        tsCode,
        action: 'BUY',
        targetWeight: weight,
      }))
    }

    const result: { tsCode: string; action: string; targetWeight: number }[] = []

    for (const [tsCode, weight] of newTargets) {
      result.push({
        tsCode,
        action: currentHoldings.has(tsCode) ? 'HOLD' : 'BUY',
        targetWeight: weight,
      })
    }

    for (const tsCode of currentHoldings) {
      if (!newTargets.has(tsCode)) {
        result.push({ tsCode, action: 'SELL', targetWeight: 0 })
      }
    }

    return result
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
}
