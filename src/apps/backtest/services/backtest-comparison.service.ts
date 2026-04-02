import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { BacktestEngineService } from './backtest-engine.service'
import { BacktestReportService } from './backtest-report.service'
import {
  BacktestConfig,
  BacktestStrategyType,
  RebalanceFrequency,
  Universe,
} from '../types/backtest-engine.types'
import { CreateBacktestComparisonDto } from '../dto/backtest-comparison.dto'

interface ComparisonJobData {
  groupId: string
  userId: number
}

@Injectable()
export class BacktestComparisonService {
  private readonly logger = new Logger(BacktestComparisonService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly engineService: BacktestEngineService,
    private readonly reportService: BacktestReportService,
    @InjectQueue(BACKTESTING_QUEUE)
    private readonly queue: Queue<ComparisonJobData>,
  ) {}

  async createComparison(dto: CreateBacktestComparisonDto, userId: number) {
    const startDate = this.parseDate(dto.startDate)
    const endDate = this.parseDate(dto.endDate)
    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate')
    }

    // Pre-create all BacktestRun records so the processor can reference them
    const runIds: string[] = []
    for (let i = 0; i < dto.strategies.length; i++) {
      const strategy = dto.strategies[i]
      const run = await this.prisma.backtestRun.create({
        data: {
          userId,
          name: strategy.label ?? `Comparison-s${i + 1}`,
          strategyType: strategy.strategyType,
          strategyConfig: strategy.strategyConfig as unknown as Prisma.InputJsonValue,
          startDate,
          endDate,
          benchmarkTsCode: dto.benchmarkTsCode ?? '000300.SH',
          universe: dto.universe ?? 'ALL_A',
          initialCapital: dto.initialCapital,
          rebalanceFrequency: strategy.rebalanceFrequency ?? 'MONTHLY',
          priceMode: 'NEXT_OPEN',
          status: 'QUEUED',
          progress: 0,
        },
      })
      runIds.push(run.id)
    }

    const group = await this.prisma.backtestComparisonGroup.create({
      data: {
        userId,
        name: dto.name ?? null,
        startDate,
        endDate,
        benchmarkTsCode: dto.benchmarkTsCode ?? '000300.SH',
        universe: dto.universe ?? 'ALL_A',
        initialCapital: dto.initialCapital,
        status: 'QUEUED',
        runIds: runIds as unknown as Prisma.InputJsonValue,
      },
    })

    const job = await this.queue.add(
      BacktestingJobName.RUN_COMPARISON,
      { groupId: group.id, userId },
      {
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    )

    this.logger.log(`Created comparison group id=${group.id} jobId=${job.id}`)
    return { groupId: group.id, jobId: job.id?.toString() ?? '', status: 'QUEUED' }
  }

  async runComparison(
    groupId: string,
    onProgress?: (pct: number, step: string) => Promise<void>,
  ): Promise<void> {
    const group = await this.prisma.backtestComparisonGroup.findUnique({ where: { id: groupId } })
    if (!group) throw new NotFoundException(`ComparisonGroup ${groupId} not found`)

    await this.prisma.backtestComparisonGroup.update({
      where: { id: groupId },
      data: { status: 'RUNNING' },
    })

    const runIds = (group.runIds as string[]) ?? []
    const runs = await this.prisma.backtestRun.findMany({ where: { id: { in: runIds } } })

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]
      const pct = Math.round(10 + (i / runs.length) * 80)
      await onProgress?.(pct, `running-strategy-${i + 1}/${runs.length}`)

      const config: BacktestConfig = {
        runId: run.id,
        strategyType: run.strategyType as BacktestStrategyType,
        strategyConfig: run.strategyConfig as BacktestConfig['strategyConfig'],
        startDate: run.startDate,
        endDate: run.endDate,
        benchmarkTsCode: run.benchmarkTsCode,
        universe: run.universe as Universe,
        initialCapital: Number(run.initialCapital),
        rebalanceFrequency: run.rebalanceFrequency as RebalanceFrequency,
        priceMode: run.priceMode as BacktestConfig['priceMode'],
        commissionRate: Number(run.commissionRate ?? 0.0003),
        stampDutyRate: Number(run.stampDutyRate ?? 0.0005),
        minCommission: Number(run.minCommission ?? 5),
        slippageBps: run.slippageBps ?? 5,
        maxPositions: 20,
        maxWeightPerStock: 0.1,
        minDaysListed: 60,
        enableTradeConstraints: true,
        enableT1Restriction: true,
        partialFillEnabled: true,
      }

      try {
        await this.prisma.backtestRun.update({
          where: { id: run.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        })
        const result = await this.engineService.runBacktest(config)
        await this.reportService.saveReport(run.id, result)
        await this.prisma.backtestRun.update({
          where: { id: run.id },
          data: { status: 'COMPLETED', progress: 100, completedAt: new Date() },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Comparison backtest failed for runId=${run.id}: ${msg}`)
        await this.prisma.backtestRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', failedReason: msg },
        })
      }
    }

    await this.prisma.backtestComparisonGroup.update({
      where: { id: groupId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
  }

  async getComparisonDetail(groupId: string) {
    const group = await this.prisma.backtestComparisonGroup.findUnique({ where: { id: groupId } })
    if (!group) throw new NotFoundException(`ComparisonGroup ${groupId} not found`)

    const runIds = (group.runIds as string[]) ?? []
    const runs = await this.prisma.backtestRun.findMany({
      where: { id: { in: runIds } },
      orderBy: { createdAt: 'asc' },
    })

    const metrics = runs.map((r) => ({
      runId: r.id,
      label: r.name,
      strategyType: r.strategyType,
      totalReturn: r.totalReturn,
      annualizedReturn: r.annualizedReturn,
      benchmarkReturn: r.benchmarkReturn,
      excessReturn: r.excessReturn,
      maxDrawdown: r.maxDrawdown,
      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      calmarRatio: r.calmarRatio,
      volatility: r.volatility,
      alpha: r.alpha,
      beta: r.beta,
      informationRatio: r.informationRatio,
      winRate: r.winRate,
      turnoverRate: r.turnoverRate,
      tradeCount: r.tradeCount,
    }))

    return {
      groupId: group.id,
      name: group.name,
      status: group.status,
      startDate: group.startDate.toISOString().slice(0, 10),
      endDate: group.endDate.toISOString().slice(0, 10),
      benchmarkTsCode: group.benchmarkTsCode,
      metrics,
      createdAt: group.createdAt.toISOString(),
      completedAt: group.completedAt?.toISOString() ?? null,
    }
  }

  async getComparisonEquity(groupId: string) {
    const group = await this.prisma.backtestComparisonGroup.findUnique({ where: { id: groupId } })
    if (!group) throw new NotFoundException(`ComparisonGroup ${groupId} not found`)

    const runIds = (group.runIds as string[]) ?? []
    const runs = await this.prisma.backtestRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, name: true },
    })

    const series = await Promise.all(
      runs.map(async (r) => {
        const navRows = await this.prisma.backtestDailyNav.findMany({
          where: { runId: r.id },
          orderBy: { tradeDate: 'asc' },
          select: { tradeDate: true, nav: true },
        })
        return {
          runId: r.id,
          label: r.name,
          points: navRows.map((n) => ({
            tradeDate: n.tradeDate.toISOString().slice(0, 10),
            nav: Number(n.nav),
          })),
        }
      }),
    )

    return { series }
  }

  private parseDate(dateStr: string): Date {
    return new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
  }
}
