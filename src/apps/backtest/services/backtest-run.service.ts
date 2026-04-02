import type { Prisma } from '@prisma/client'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { PrismaService } from 'src/shared/prisma.service'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { CreateBacktestRunDto } from '../dto/create-backtest-run.dto'
import { ValidateBacktestRunDto } from '../dto/backtest-validate.dto'
import { ListBacktestRunsDto } from '../dto/list-backtest-runs.dto'
import { BacktestTradeQueryDto } from '../dto/backtest-trade-query.dto'
import { BacktestPositionQueryDto } from '../dto/backtest-position-query.dto'
import { BacktestDataReadinessService } from './backtest-data-readiness.service'
import { BacktestConfig } from '../types/backtest-engine.types'
import { BacktestStrategyRegistryService } from './backtest-strategy-registry.service'

interface BacktestingJobData {
  runId: string
  userId: number
}

@Injectable()
export class BacktestRunService {
  private readonly logger = new Logger(BacktestRunService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataReadinessService: BacktestDataReadinessService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
    @InjectQueue(BACKTESTING_QUEUE)
    private readonly backtestingQueue: Queue<BacktestingJobData>,
  ) {}

  async validateRun(dto: ValidateBacktestRunDto) {
    this.assertValidDateRange(dto.startDate, dto.endDate)
    this.strategyRegistry.validateStrategyConfig(dto.strategyType, dto.strategyConfig)
    return this.dataReadinessService.checkReadiness(dto)
  }

  async createRun(dto: CreateBacktestRunDto, userId: number) {
    const { startDate, endDate } = this.assertValidDateRange(dto.startDate, dto.endDate)
    const strategyConfig = this.strategyRegistry.validateStrategyConfig(dto.strategyType, dto.strategyConfig)

    const run = await this.prisma.backtestRun.create({
      data: {
        userId,
        name: dto.name ?? null,
        strategyType: dto.strategyType,
        strategyConfig: strategyConfig as unknown as Prisma.InputJsonValue,
        startDate,
        endDate,
        benchmarkTsCode: dto.benchmarkTsCode ?? '000300.SH',
        universe: dto.universe ?? 'ALL_A',
        customUniverse: dto.customUniverseTsCodes
          ? (dto.customUniverseTsCodes as unknown as Prisma.InputJsonValue)
          : undefined,
        initialCapital: dto.initialCapital,
        rebalanceFrequency: dto.rebalanceFrequency ?? 'MONTHLY',
        priceMode: dto.priceMode ?? 'NEXT_OPEN',
        commissionRate: dto.commissionRate ?? 0.0003,
        stampDutyRate: dto.stampDutyRate ?? 0.0005,
        minCommission: dto.minCommission ?? 5,
        slippageBps: dto.slippageBps ?? 5,
        status: 'QUEUED',
        progress: 0,
      },
    })

    const job = await this.backtestingQueue.add(
      BacktestingJobName.RUN_BACKTEST,
      { runId: run.id, userId },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 30 },
      },
    )

    await this.prisma.backtestRun.update({
      where: { id: run.id },
      data: { jobId: job.id?.toString() },
    })

    this.logger.log(`Created backtest run id=${run.id} jobId=${job.id}`)

    return {
      runId: run.id,
      jobId: job.id?.toString() ?? '',
      status: 'QUEUED',
    }
  }

  async listRuns(dto: ListBacktestRunsDto, userId: number) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = { userId }
    if (dto.status) where.status = dto.status
    if (dto.strategyType) where.strategyType = dto.strategyType
    if (dto.keyword) where.name = { contains: dto.keyword, mode: 'insensitive' }

    const [total, items] = await Promise.all([
      this.prisma.backtestRun.count({ where }),
      this.prisma.backtestRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          strategyType: true,
          status: true,
          startDate: true,
          endDate: true,
          benchmarkTsCode: true,
          totalReturn: true,
          annualizedReturn: true,
          maxDrawdown: true,
          sharpeRatio: true,
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
        runId: r.id,
        name: r.name,
        strategyType: r.strategyType,
        status: r.status,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        benchmarkTsCode: r.benchmarkTsCode,
        totalReturn: r.totalReturn,
        annualizedReturn: r.annualizedReturn,
        maxDrawdown: r.maxDrawdown,
        sharpeRatio: r.sharpeRatio,
        progress: r.progress,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    }
  }

  async getRunDetail(runId: string) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    const strategyType = run.strategyType as BacktestConfig['strategyType']
    const strategyConfig = this.strategyRegistry.validateStrategyConfig(strategyType, run.strategyConfig)

    return {
      runId: run.id,
      jobId: run.jobId,
      name: run.name,
      status: run.status,
      progress: run.progress,
      failedReason: run.failedReason,
      strategyType,
      strategyConfig,
      startDate: run.startDate.toISOString().slice(0, 10),
      endDate: run.endDate.toISOString().slice(0, 10),
      benchmarkTsCode: run.benchmarkTsCode,
      universe: run.universe,
      initialCapital: Number(run.initialCapital),
      rebalanceFrequency: run.rebalanceFrequency,
      priceMode: run.priceMode,
      summary: {
        totalReturn: run.totalReturn,
        annualizedReturn: run.annualizedReturn,
        benchmarkReturn: run.benchmarkReturn,
        excessReturn: run.excessReturn,
        maxDrawdown: run.maxDrawdown,
        sharpeRatio: run.sharpeRatio,
        sortinoRatio: run.sortinoRatio,
        calmarRatio: run.calmarRatio,
        volatility: run.volatility,
        alpha: run.alpha,
        beta: run.beta,
        informationRatio: run.informationRatio,
        winRate: run.winRate,
        turnoverRate: run.turnoverRate,
        tradeCount: run.tradeCount,
      },
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
    }
  }

  async cancelRun(runId: string) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
      throw new BadRequestException(`Cannot cancel run with status ${run.status}`)
    }

    // Try to remove the job from queue
    if (run.jobId) {
      try {
        const job = await this.backtestingQueue.getJob(run.jobId)
        if (job) await job.remove()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Could not remove job ${run.jobId}: ${message}`)
      }
    }

    await this.prisma.backtestRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED' },
    })

    return { runId, status: 'CANCELLED' }
  }

  async getEquity(runId: string) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    const navs = await this.prisma.backtestDailyNav.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
    })

    return {
      points: navs.map((r) => ({
        tradeDate: r.tradeDate.toISOString().slice(0, 10),
        nav: Number(r.nav),
        benchmarkNav: Number(r.benchmarkNav ?? 1),
        drawdown: r.drawdown ?? 0,
        dailyReturn: r.dailyReturn ?? 0,
        benchmarkReturn: r.benchmarkReturn ?? 0,
        exposure: r.exposure ?? 0,
        cashRatio: r.cashRatio ?? 0,
      })),
    }
  }

  async getTrades(runId: string, dto: BacktestTradeQueryDto) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const skip = (page - 1) * pageSize

    const [total, items] = await Promise.all([
      this.prisma.backtestTrade.count({ where: { runId } }),
      this.prisma.backtestTrade.findMany({
        where: { runId },
        orderBy: { tradeDate: 'desc' },
        skip,
        take: pageSize,
      }),
    ])

    // Enrich with stock names
    const tsCodes = [...new Set(items.map((t) => t.tsCode))]
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(stocks.map((s) => [s.tsCode, s.name]))

    return {
      page,
      pageSize,
      total,
      items: items.map((t) => ({
        tradeDate: t.tradeDate.toISOString().slice(0, 10),
        tsCode: t.tsCode,
        name: nameMap.get(t.tsCode) ?? null,
        side: t.side,
        price: Number(t.price),
        quantity: t.quantity,
        amount: Number(t.amount),
        commission: Number(t.commission ?? 0),
        stampDuty: Number(t.stampDuty ?? 0),
        slippageCost: Number(t.slippageCost ?? 0),
        reason: t.reason,
      })),
    }
  }

  async getPositions(runId: string, dto: BacktestPositionQueryDto) {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    let tradeDate: Date
    if (dto.tradeDate) {
      tradeDate = this.parseDate(dto.tradeDate)
    } else {
      // Get latest snapshot date
      const latest = await this.prisma.backtestPositionSnapshot.findFirst({
        where: { runId },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) return { tradeDate: '', items: [] }
      tradeDate = latest.tradeDate
    }

    const snapshots = await this.prisma.backtestPositionSnapshot.findMany({
      where: { runId, tradeDate },
      orderBy: { marketValue: 'desc' },
    })

    const tsCodes = snapshots.map((s) => s.tsCode)
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(stocks.map((s) => [s.tsCode, s.name]))

    return {
      tradeDate: tradeDate.toISOString().slice(0, 10),
      items: snapshots.map((s) => ({
        tsCode: s.tsCode,
        name: nameMap.get(s.tsCode) ?? null,
        quantity: s.quantity,
        costPrice: Number(s.costPrice ?? 0),
        closePrice: Number(s.closePrice ?? 0),
        marketValue: Number(s.marketValue ?? 0),
        weight: s.weight ?? 0,
        unrealizedPnl: Number(s.unrealizedPnl ?? 0),
        holdingDays: s.holdingDays ?? 0,
      })),
    }
  }

  /** Load BacktestConfig from DB for the engine */
  async loadConfig(runId: string): Promise<BacktestConfig> {
    const run = await this.prisma.backtestRun.findUnique({ where: { id: runId } })
    if (!run) throw new NotFoundException(`BacktestRun ${runId} not found`)

    const strategyType = run.strategyType as BacktestConfig['strategyType']
    const strategyConfig = this.strategyRegistry.validateStrategyConfig(strategyType, run.strategyConfig)

    return {
      runId: run.id,
      strategyType,
      strategyConfig,
      startDate: run.startDate,
      endDate: run.endDate,
      benchmarkTsCode: run.benchmarkTsCode,
      universe: run.universe as BacktestConfig['universe'],
      customUniverseTsCodes: (run.customUniverse as string[]) ?? undefined,
      initialCapital: Number(run.initialCapital),
      rebalanceFrequency: run.rebalanceFrequency as BacktestConfig['rebalanceFrequency'],
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
  }

  private assertValidDateRange(startDateStr: string, endDateStr: string) {
    const startDate = this.parseDate(startDateStr)
    const endDate = this.parseDate(endDateStr)

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
      throw new BusinessException(ErrorEnum.INVALID_DATE_RANGE)
    }

    return { startDate, endDate }
  }

  private parseDate(dateStr: string): Date {
    return new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
  }
}
