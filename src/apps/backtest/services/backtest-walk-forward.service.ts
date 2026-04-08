import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { BacktestEngineService } from './backtest-engine.service'
import { BacktestMetricsService } from './backtest-metrics.service'
import { BacktestReportService } from './backtest-report.service'
import { BacktestDataService } from './backtest-data.service'
import {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  BacktestStrategyType,
  DailyNavRecord,
  RebalanceFrequency,
  TradeRecord,
  Universe,
} from '../types/backtest-engine.types'
import { CreateWalkForwardRunDto, ParamSearchSpaceItemDto } from '../dto/walk-forward.dto'

type ProgressCallback = (pct: number, step: string) => Promise<void>

interface ParamSearchSpace {
  [paramName: string]: ParamSearchSpaceItemDto
}

interface WalkForwardJobData {
  wfRunId: string
  userId: number
}

@Injectable()
export class BacktestWalkForwardService {
  private readonly logger = new Logger(BacktestWalkForwardService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly engineService: BacktestEngineService,
    private readonly metricsService: BacktestMetricsService,
    private readonly reportService: BacktestReportService,
    private readonly dataService: BacktestDataService,
    @InjectQueue(BACKTESTING_QUEUE)
    private readonly queue: Queue<WalkForwardJobData>,
  ) {}

  async createWalkForwardRun(dto: CreateWalkForwardRunDto, userId: number) {
    const fullStartDate = this.parseDate(dto.fullStartDate)
    const fullEndDate = this.parseDate(dto.fullEndDate)
    if (fullStartDate >= fullEndDate) {
      throw new BadRequestException('fullStartDate must be before fullEndDate')
    }

    const wfRun = await this.prisma.backtestWalkForwardRun.create({
      data: {
        userId,
        name: dto.name ?? null,
        baseStrategyType: dto.baseStrategyType,
        baseStrategyConfig: dto.baseStrategyConfig as unknown as Prisma.InputJsonValue,
        paramSearchSpace: dto.paramSearchSpace as unknown as Prisma.InputJsonValue,
        optimizeMetric: dto.optimizeMetric ?? 'sharpeRatio',
        fullStartDate,
        fullEndDate,
        inSampleDays: dto.inSampleDays,
        outOfSampleDays: dto.outOfSampleDays,
        stepDays: dto.stepDays,
        benchmarkTsCode: dto.benchmarkTsCode ?? '000300.SH',
        universe: dto.universe ?? 'ALL_A',
        initialCapital: dto.initialCapital,
        rebalanceFrequency: dto.rebalanceFrequency ?? 'MONTHLY',
        status: 'QUEUED',
        progress: 0,
      },
    })

    const job = await this.queue.add(
      BacktestingJobName.RUN_WALK_FORWARD,
      { wfRunId: wfRun.id, userId },
      {
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    )

    this.logger.log(`Created WalkForward run id=${wfRun.id} jobId=${job.id}`)
    return { wfRunId: wfRun.id, jobId: job.id?.toString() ?? '', status: 'QUEUED' }
  }

  async listWalkForwardRuns(userId: number, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize
    const where = { userId }
    const [total, items] = await Promise.all([
      this.prisma.backtestWalkForwardRun.count({ where }),
      this.prisma.backtestWalkForwardRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          baseStrategyType: true,
          status: true,
          fullStartDate: true,
          fullEndDate: true,
          oosSharpeRatio: true,
          oosAnnualizedReturn: true,
          oosMaxDrawdown: true,
          progress: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ])

    return {
      page,
      pageSize,
      total,
      items: items.map((r) => ({
        wfRunId: r.id,
        name: r.name,
        baseStrategyType: r.baseStrategyType,
        status: r.status,
        fullStartDate: r.fullStartDate.toISOString().slice(0, 10),
        fullEndDate: r.fullEndDate.toISOString().slice(0, 10),
        oosSharpeRatio: r.oosSharpeRatio,
        oosAnnualizedReturn: r.oosAnnualizedReturn,
        oosMaxDrawdown: r.oosMaxDrawdown,
        progress: r.progress,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    }
  }

  async getWalkForwardRunDetail(wfRunId: string) {
    const wfRun = await this.prisma.backtestWalkForwardRun.findUnique({
      where: { id: wfRunId },
      include: { windows: { orderBy: { windowIndex: 'asc' } } },
    })
    if (!wfRun) throw new NotFoundException(`WalkForwardRun ${wfRunId} not found`)

    return {
      wfRunId: wfRun.id,
      name: wfRun.name,
      baseStrategyType: wfRun.baseStrategyType,
      status: wfRun.status,
      progress: wfRun.progress,
      failedReason: wfRun.failedReason,
      fullStartDate: wfRun.fullStartDate.toISOString().slice(0, 10),
      fullEndDate: wfRun.fullEndDate.toISOString().slice(0, 10),
      inSampleDays: wfRun.inSampleDays,
      outOfSampleDays: wfRun.outOfSampleDays,
      stepDays: wfRun.stepDays,
      optimizeMetric: wfRun.optimizeMetric,
      windowCount: wfRun.windowCount,
      completedWindows: wfRun.completedWindows,
      oosAnnualizedReturn: wfRun.oosAnnualizedReturn,
      oosSharpeRatio: wfRun.oosSharpeRatio,
      oosMaxDrawdown: wfRun.oosMaxDrawdown,
      isOosReturnVsIs: wfRun.isOosReturnVsIs,
      windows: wfRun.windows.map((w) => ({
        windowIndex: w.windowIndex,
        isStartDate: w.isStartDate.toISOString().slice(0, 10),
        isEndDate: w.isEndDate.toISOString().slice(0, 10),
        oosStartDate: w.oosStartDate.toISOString().slice(0, 10),
        oosEndDate: w.oosEndDate.toISOString().slice(0, 10),
        optimizedParams: w.optimizedParams as Record<string, unknown> | null,
        isReturn: w.isReturn,
        isSharpe: w.isSharpe,
        oosReturn: w.oosReturn,
        oosSharpe: w.oosSharpe,
        oosMaxDrawdown: w.oosMaxDrawdown,
      })),
      createdAt: wfRun.createdAt.toISOString(),
      completedAt: wfRun.completedAt?.toISOString() ?? null,
    }
  }

  async getWalkForwardEquity(wfRunId: string) {
    const wfRun = await this.prisma.backtestWalkForwardRun.findUnique({
      where: { id: wfRunId },
      include: { windows: { orderBy: { windowIndex: 'asc' } } },
    })
    if (!wfRun) throw new NotFoundException(`WalkForwardRun ${wfRunId} not found`)

    const points: Array<{ tradeDate: string; nav: number; windowIndex: number }> = []

    for (const win of wfRun.windows) {
      if (!win.oosBacktestRunId) continue
      const navRows = await this.prisma.backtestDailyNav.findMany({
        where: { runId: win.oosBacktestRunId },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, nav: true },
      })
      for (const r of navRows) {
        points.push({
          tradeDate: r.tradeDate.toISOString().slice(0, 10),
          nav: Number(r.nav),
          windowIndex: win.windowIndex,
        })
      }
    }

    return { points }
  }

  /**
   * Main Walk-Forward execution. Called by the BullMQ processor.
   */
  async runWalkForward(wfRunId: string, onProgress?: ProgressCallback): Promise<void> {
    const wfRun = await this.prisma.backtestWalkForwardRun.findUnique({ where: { id: wfRunId } })
    if (!wfRun) throw new NotFoundException(`WalkForwardRun ${wfRunId} not found`)

    await this.prisma.backtestWalkForwardRun.update({
      where: { id: wfRunId },
      data: { status: 'RUNNING' },
    })

    // Build windows
    const windows = this.buildWindows(
      wfRun.fullStartDate,
      wfRun.fullEndDate,
      wfRun.inSampleDays,
      wfRun.outOfSampleDays,
      wfRun.stepDays,
    )

    await this.prisma.backtestWalkForwardRun.update({
      where: { id: wfRunId },
      data: { windowCount: windows.length },
    })

    const paramSearchSpace = wfRun.paramSearchSpace as unknown as ParamSearchSpace
    const combinations = this.generateParamCombinations(paramSearchSpace)
    const optimizeMetric = wfRun.optimizeMetric

    const baseConfig: Omit<BacktestConfig, 'runId' | 'startDate' | 'endDate' | 'strategyConfig'> = {
      strategyType: wfRun.baseStrategyType as BacktestStrategyType,
      benchmarkTsCode: wfRun.benchmarkTsCode,
      universe: wfRun.universe as Universe,
      initialCapital: Number(wfRun.initialCapital),
      rebalanceFrequency: wfRun.rebalanceFrequency as RebalanceFrequency,
      priceMode: 'NEXT_OPEN',
      commissionRate: 0.0003,
      stampDutyRate: 0.0005,
      minCommission: 5,
      slippageBps: 5,
      maxPositions: 20,
      maxWeightPerStock: 0.1,
      minDaysListed: 60,
      enableTradeConstraints: true,
      enableT1Restriction: true,
      partialFillEnabled: true,
    }

    const oosNavRecordsAll: DailyNavRecord[] = []
    const oosTradesAll: TradeRecord[] = []

    for (let i = 0; i < windows.length; i++) {
      const win = windows[i]
      const pct = Math.round(10 + (i / windows.length) * 80)
      await onProgress?.(pct, `window-${i + 1}/${windows.length}`)

      // IS phase: grid search
      let bestParams: Record<string, unknown> = combinations[0] ?? {}
      let bestMetricValue = -Infinity
      let isResult: BacktestResult | null = null

      for (const params of combinations) {
        const strategyConfig = { ...(wfRun.baseStrategyConfig as Record<string, unknown>), ...params }
        const tempRunId = `wf-${wfRunId}-is-w${i}-${Date.now()}`
        const config: BacktestConfig = {
          ...baseConfig,
          runId: tempRunId,
          startDate: win.isStart,
          endDate: win.isEnd,
          strategyConfig: strategyConfig as BacktestConfig['strategyConfig'],
        }
        try {
          const result = await this.engineService.runBacktest(config)
          const metricValue = this.extractMetric(result.metrics, optimizeMetric)
          if (metricValue > bestMetricValue) {
            bestMetricValue = metricValue
            bestParams = params
            isResult = result
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.warn(`WF IS backtest failed for window ${i} params=${JSON.stringify(params)}: ${msg}`)
        }
      }

      // Create IS backtest run record and save report
      let isRunId: string | null = null
      if (isResult) {
        const isRun = await this.prisma.backtestRun.create({
          data: {
            userId: wfRun.userId,
            name: `WF-${wfRunId}-IS-w${i}`,
            strategyType: wfRun.baseStrategyType,
            strategyConfig: {
              ...(wfRun.baseStrategyConfig as Record<string, unknown>),
              ...bestParams,
            } as unknown as Prisma.InputJsonValue,
            startDate: win.isStart,
            endDate: win.isEnd,
            benchmarkTsCode: wfRun.benchmarkTsCode,
            universe: wfRun.universe,
            initialCapital: wfRun.initialCapital,
            rebalanceFrequency: wfRun.rebalanceFrequency,
            priceMode: 'NEXT_OPEN',
            status: 'COMPLETED',
            progress: 100,
          },
        })
        isRunId = isRun.id
        await this.reportService.saveReport(isRun.id, isResult)
      }

      // OOS phase: run with best params
      let oosRunId: string | null = null
      let oosMetrics: BacktestMetrics | null = null

      const oosStrategyConfig = { ...(wfRun.baseStrategyConfig as Record<string, unknown>), ...bestParams }
      const oosConfig: BacktestConfig = {
        ...baseConfig,
        runId: `wf-${wfRunId}-oos-w${i}-${Date.now()}`,
        startDate: win.oosStart,
        endDate: win.oosEnd,
        strategyConfig: oosStrategyConfig as BacktestConfig['strategyConfig'],
      }

      try {
        const oosResult = await this.engineService.runBacktest(oosConfig)
        oosMetrics = oosResult.metrics
        oosNavRecordsAll.push(...oosResult.navRecords)
        oosTradesAll.push(...oosResult.trades)

        const oosRun = await this.prisma.backtestRun.create({
          data: {
            userId: wfRun.userId,
            name: `WF-${wfRunId}-OOS-w${i}`,
            strategyType: wfRun.baseStrategyType,
            strategyConfig: oosStrategyConfig as unknown as Prisma.InputJsonValue,
            startDate: win.oosStart,
            endDate: win.oosEnd,
            benchmarkTsCode: wfRun.benchmarkTsCode,
            universe: wfRun.universe,
            initialCapital: wfRun.initialCapital,
            rebalanceFrequency: wfRun.rebalanceFrequency,
            priceMode: 'NEXT_OPEN',
            status: 'COMPLETED',
            progress: 100,
          },
        })
        oosRunId = oosRun.id
        await this.reportService.saveReport(oosRun.id, oosResult)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`WF OOS backtest failed for window ${i}: ${msg}`)
      }

      // Save window record
      await this.prisma.backtestWalkForwardWindow.create({
        data: {
          wfRunId,
          windowIndex: i,
          isStartDate: win.isStart,
          isEndDate: win.isEnd,
          oosStartDate: win.oosStart,
          oosEndDate: win.oosEnd,
          optimizedParams: bestParams as unknown as Prisma.InputJsonValue,
          isBacktestRunId: isRunId,
          oosBacktestRunId: oosRunId,
          isReturn: isResult?.metrics.totalReturn ?? null,
          isSharpe: isResult?.metrics.sharpeRatio ?? null,
          oosReturn: oosMetrics?.totalReturn ?? null,
          oosSharpe: oosMetrics?.sharpeRatio ?? null,
          oosMaxDrawdown: oosMetrics?.maxDrawdown ?? null,
        },
      })

      await this.prisma.backtestWalkForwardRun.update({
        where: { id: wfRunId },
        data: { completedWindows: { increment: 1 } },
      })
    }

    // Compute aggregated OOS metrics
    const aggregatedMetrics = this.computeAggregatedOosMetrics(oosNavRecordsAll, oosTradesAll)

    // Compute IS/OOS return ratio
    const allWindows = await this.prisma.backtestWalkForwardWindow.findMany({ where: { wfRunId } })
    const validIsReturns = allWindows.map((w) => w.isReturn).filter((r): r is number => r !== null)
    const avgIsReturn =
      validIsReturns.length > 0 ? validIsReturns.reduce((a, b) => a + b, 0) / validIsReturns.length : null
    const isOosReturnVsIs =
      avgIsReturn !== null && avgIsReturn !== 0 ? (aggregatedMetrics.annualizedReturn ?? 0) / avgIsReturn : null

    await this.prisma.backtestWalkForwardRun.update({
      where: { id: wfRunId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        oosAnnualizedReturn: aggregatedMetrics.annualizedReturn,
        oosSharpeRatio: aggregatedMetrics.sharpeRatio,
        oosMaxDrawdown: aggregatedMetrics.maxDrawdown,
        isOosReturnVsIs,
        progress: 100,
      },
    })
  }

  /** Divide the full period into IS/OOS windows */
  private buildWindows(
    fullStart: Date,
    fullEnd: Date,
    inSampleDays: number,
    outOfSampleDays: number,
    stepDays: number,
  ) {
    const msPerDay = 24 * 60 * 60 * 1000
    const windows: Array<{ isStart: Date; isEnd: Date; oosStart: Date; oosEnd: Date }> = []
    let cursor = fullStart.getTime()

    while (true) {
      const isStart = new Date(cursor)
      const isEnd = new Date(cursor + inSampleDays * msPerDay)
      const oosStart = isEnd
      const oosEnd = new Date(oosStart.getTime() + outOfSampleDays * msPerDay)
      if (oosEnd > fullEnd) break
      windows.push({ isStart, isEnd, oosStart, oosEnd })
      cursor += stepDays * msPerDay
    }

    return windows
  }

  /**
   * Generate all parameter combinations (Cartesian product) from the search space.
   * Throws if combinations exceed 1000.
   */
  generateParamCombinations(searchSpace: ParamSearchSpace): Record<string, unknown>[] {
    const paramNames = Object.keys(searchSpace)
    if (paramNames.length === 0) return [{}]

    const paramValues: unknown[][] = paramNames.map((name) => {
      const spec = searchSpace[name]
      if (spec.type === 'range') {
        const { min = 0, max = 0, step = 1 } = spec
        const count = Math.round((max - min) / step) + 1
        const values: number[] = []
        for (let i = 0; i < count; i++) {
          values.push(min + i * step)
        }
        return values
      } else {
        return spec.values ?? []
      }
    })

    const total = paramValues.reduce((acc, vals) => acc * vals.length, 1)
    if (total > 1000) {
      throw new BadRequestException(
        `Parameter search space is too large (${total} combinations). Please reduce the search space to ≤ 1000.`,
      )
    }

    const combinations = this.cartesianProduct(paramValues)
    return combinations.map((combo) => {
      const result: Record<string, unknown> = {}
      for (let i = 0; i < paramNames.length; i++) {
        result[paramNames[i]] = combo[i]
      }
      return result
    })
  }

  private cartesianProduct(arrays: unknown[][]): unknown[][] {
    return arrays.reduce<unknown[][]>((acc, arr) => acc.flatMap((combo) => arr.map((val) => [...combo, val])), [[]])
  }

  private extractMetric(metrics: BacktestMetrics, metricName: string): number {
    const key = metricName as keyof BacktestMetrics
    const val = metrics[key]
    return typeof val === 'number' ? val : -Infinity
  }

  private computeAggregatedOosMetrics(navRecords: DailyNavRecord[], _trades: TradeRecord[]): BacktestMetrics {
    if (navRecords.length === 0) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        benchmarkReturn: 0,
        excessReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        volatility: 0,
        alpha: 0,
        beta: 0,
        informationRatio: 0,
        winRate: 0,
        turnoverRate: 0,
        tradeCount: 0,
      }
    }

    // Simple aggregated metrics from concatenated nav records
    const firstNav = navRecords[0].nav
    const lastNav = navRecords[navRecords.length - 1].nav
    const totalReturn = lastNav / firstNav - 1

    const returns = navRecords.map((r) => r.dailyReturn).filter((r) => !isNaN(r))
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length
    const volatility = Math.sqrt(variance * 252)
    const annualizedReturn = Math.pow(1 + totalReturn, 252 / navRecords.length) - 1
    const sharpeRatio = volatility > 0 ? (annualizedReturn - 0.02) / volatility : 0

    let maxDrawdown = 0
    let peak = navRecords[0].nav
    for (const r of navRecords) {
      if (r.nav > peak) peak = r.nav
      const dd = peak > 0 ? r.nav / peak - 1 : 0
      if (dd < maxDrawdown) maxDrawdown = dd
    }

    return {
      totalReturn,
      annualizedReturn,
      benchmarkReturn: 0,
      excessReturn: 0,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio: 0,
      calmarRatio: maxDrawdown !== 0 ? annualizedReturn / Math.abs(maxDrawdown) : 0,
      volatility,
      alpha: 0,
      beta: 0,
      informationRatio: 0,
      winRate: 0,
      turnoverRate: 0,
      tradeCount: 0,
    }
  }

  private parseDate(dateStr: string): Date {
    return new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
  }
}
