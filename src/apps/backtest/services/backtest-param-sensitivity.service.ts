import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { ParamSensitivityDto, ParamSensitivityCreateResponseDto, ParamSensitivityResultDto } from '../dto/param-sensitivity.dto'

@Injectable()
export class BacktestParamSensitivityService {
  private readonly logger = new Logger(BacktestParamSensitivityService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BACKTESTING_QUEUE)
    private readonly queue: Queue,
  ) {}

  async create(dto: ParamSensitivityDto, userId: number): Promise<ParamSensitivityCreateResponseDto> {
    // 1. Load and validate base run
    const baseRun = await this.prisma.backtestRun.findUnique({ where: { id: dto.runId } })
    if (!baseRun) throw new NotFoundException(`回测记录不存在: ${dto.runId}`)
    if (baseRun.userId !== userId) throw new ForbiddenException('无权访问该回测记录')
    if (baseRun.status !== 'COMPLETED') throw new BadRequestException('基准回测未完成，无法进行参数扫描')

    // 2. Validate grid size
    const xLen = dto.paramX.values.length
    const yLen = dto.paramY.values.length
    const total = xLen * yLen
    if (total > 100) throw new BadRequestException(`参数网格共 ${total} 个组合，超过上限 100`)

    // 3. Check active sweep limit (per user, max 3 running at once)
    const activeSweepCount = await this.prisma.paramSweep.count({
      where: { userId, status: { in: ['PENDING', 'RUNNING'] } },
    })
    if (activeSweepCount >= 3) throw new BadRequestException('同时进行的参数扫描不得超过 3 个')

    const metric = dto.metric ?? 'sharpeRatio'

    // 4. Create sweep record
    const sweep = await this.prisma.paramSweep.create({
      data: {
        userId,
        baseRunId: dto.runId,
        paramXKey: dto.paramX.paramKey,
        paramXLabel: dto.paramX.label ?? dto.paramX.paramKey,
        paramXValues: dto.paramX.values as unknown as Prisma.InputJsonValue,
        paramYKey: dto.paramY.paramKey,
        paramYLabel: dto.paramY.label ?? dto.paramY.paramKey,
        paramYValues: dto.paramY.values as unknown as Prisma.InputJsonValue,
        metric,
        status: 'PENDING',
        totalCount: total,
        completedCount: 0,
      },
    })

    // 5. Create child runs and enqueue
    const baseConfig = baseRun.strategyConfig as Record<string, unknown>

    for (let xi = 0; xi < xLen; xi++) {
      for (let yi = 0; yi < yLen; yi++) {
        const xVal = dto.paramX.values[xi]
        const yVal = dto.paramY.values[yi]
        const patchedConfig: Record<string, unknown> = {
          ...baseConfig,
          [dto.paramX.paramKey]: xVal,
          [dto.paramY.paramKey]: yVal,
        }

        const childRun = await this.prisma.backtestRun.create({
          data: {
            userId,
            name: `sweep-${sweep.id.slice(-6)}-x${xi}y${yi}`,
            strategyType: baseRun.strategyType,
            strategyConfig: patchedConfig as unknown as Prisma.InputJsonValue,
            startDate: baseRun.startDate,
            endDate: baseRun.endDate,
            benchmarkTsCode: baseRun.benchmarkTsCode,
            universe: baseRun.universe,
            ...(baseRun.customUniverse !== null && { customUniverse: baseRun.customUniverse }),
            initialCapital: baseRun.initialCapital,
            rebalanceFrequency: baseRun.rebalanceFrequency,
            priceMode: baseRun.priceMode,
            commissionRate: baseRun.commissionRate,
            stampDutyRate: baseRun.stampDutyRate,
            minCommission: baseRun.minCommission,
            slippageBps: baseRun.slippageBps,
            sweepId: sweep.id,
            sweepXIdx: xi,
            sweepYIdx: yi,
            status: 'QUEUED',
            progress: 0,
          },
        })

        await this.queue.add(
          BacktestingJobName.RUN_BACKTEST,
          { runId: childRun.id, userId },
          { attempts: 1, removeOnComplete: { count: 200 }, removeOnFail: { count: 100 } },
        )
      }
    }

    this.logger.log(`Created param sweep id=${sweep.id} totalCombinations=${total}`)

    return { sweepId: sweep.id, totalCombinations: total, status: 'PENDING', metric }
  }

  async getResult(sweepId: string, userId: number): Promise<ParamSensitivityResultDto> {
    const sweep = await this.prisma.paramSweep.findUnique({ where: { id: sweepId } })
    if (!sweep) throw new NotFoundException(`参数扫描任务不存在: ${sweepId}`)

    // Verify ownership via baseRunId
    const baseRun = await this.prisma.backtestRun.findUnique({
      where: { id: sweep.baseRunId },
      select: { userId: true },
    })
    if (!baseRun || baseRun.userId !== userId) throw new ForbiddenException('无权访问该扫描任务')

    // Load all child runs
    const childRuns = await this.prisma.backtestRun.findMany({
      where: { sweepId },
      select: {
        sweepXIdx: true,
        sweepYIdx: true,
        status: true,
        totalReturn: true,
        annualizedReturn: true,
        sharpeRatio: true,
        maxDrawdown: true,
        sortinoRatio: true,
      },
    })

    const xValues = sweep.paramXValues as number[]
    const yValues = sweep.paramYValues as number[]
    const xLen = xValues.length
    const yLen = yValues.length
    const total = xLen * yLen

    // Build heatmap[xIdx][yIdx]
    const heatmap: (number | null)[][] = Array.from({ length: xLen }, () => Array(yLen).fill(null))

    const completedRuns = childRuns.filter((r) => r.status === 'COMPLETED')
    for (const r of completedRuns) {
      if (r.sweepXIdx !== null && r.sweepYIdx !== null) {
        heatmap[r.sweepXIdx][r.sweepYIdx] = this.extractMetric(r, sweep.metric)
      }
    }

    // Derive status
    const completedCount = completedRuns.length
    let status: string
    if (completedCount === 0) {
      status = sweep.status
    } else if (completedCount < total) {
      status = 'PARTIAL'
    } else {
      status = 'COMPLETED'
    }

    // Find best (maxDrawdown: minimize; others: maximize)
    const isMinMetric = sweep.metric === 'maxDrawdown'
    let best: { xValue: number; yValue: number; metricValue: number } | null = null
    for (let xi = 0; xi < xLen; xi++) {
      for (let yi = 0; yi < yLen; yi++) {
        const val = heatmap[xi][yi]
        if (val === null) continue
        if (best === null || (isMinMetric ? val < best.metricValue : val > best.metricValue)) {
          best = { xValue: xValues[xi], yValue: yValues[yi], metricValue: val }
        }
      }
    }

    return {
      sweepId,
      baseRunId: sweep.baseRunId,
      status,
      totalCombinations: total,
      completedCount,
      metric: sweep.metric,
      paramX: { key: sweep.paramXKey, label: sweep.paramXLabel ?? sweep.paramXKey, values: xValues },
      paramY: { key: sweep.paramYKey, label: sweep.paramYLabel ?? sweep.paramYKey, values: yValues },
      heatmap,
      best,
    }
  }

  private extractMetric(
    run: {
      totalReturn: number | null
      annualizedReturn: number | null
      sharpeRatio: number | null
      maxDrawdown: number | null
      sortinoRatio: number | null
    },
    metric: string,
  ): number | null {
    switch (metric) {
      case 'totalReturn':
        return run.totalReturn
      case 'annualizedReturn':
        return run.annualizedReturn
      case 'sharpeRatio':
        return run.sharpeRatio
      case 'maxDrawdown':
        return run.maxDrawdown
      case 'sortinoRatio':
        return run.sortinoRatio
      default:
        return run.sharpeRatio
    }
  }
}
