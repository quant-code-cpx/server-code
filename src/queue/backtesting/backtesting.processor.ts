import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { BacktestingJobData, BacktestingJobResult } from './backtesting.interface'
import { EventsGateway } from 'src/websocket/events.gateway'
import { BacktestEngineService } from 'src/apps/backtest/services/backtest-engine.service'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { BacktestReportService } from 'src/apps/backtest/services/backtest-report.service'
import { BacktestWalkForwardService } from 'src/apps/backtest/services/backtest-walk-forward.service'
import { BacktestComparisonService } from 'src/apps/backtest/services/backtest-comparison.service'
import { PrismaService } from 'src/shared/prisma.service'

interface WalkForwardJobData {
  wfRunId: string
  userId: number
}

interface ComparisonJobData {
  groupId: string
  userId: number
}

@Processor(BACKTESTING_QUEUE)
export class BacktestingProcessor extends WorkerHost {
  private readonly logger = new Logger(BacktestingProcessor.name)

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly engineService: BacktestEngineService,
    private readonly runService: BacktestRunService,
    private readonly reportService: BacktestReportService,
    private readonly walkForwardService: BacktestWalkForwardService,
    private readonly comparisonService: BacktestComparisonService,
    private readonly prisma: PrismaService,
  ) {
    super()
  }

  async process(
    job: Job<BacktestingJobData | WalkForwardJobData | ComparisonJobData, BacktestingJobResult>,
  ): Promise<BacktestingJobResult> {
    this.logger.log(`Processing job [${job.name}] id=${job.id}`)

    switch (job.name) {
      case BacktestingJobName.RUN_BACKTEST:
        return this.runBacktest(job as Job<BacktestingJobData, BacktestingJobResult>)
      case BacktestingJobName.RUN_WALK_FORWARD:
        return this.runWalkForward(job as Job<WalkForwardJobData, BacktestingJobResult>)
      case BacktestingJobName.RUN_COMPARISON:
        return this.runComparison(job as Job<ComparisonJobData, BacktestingJobResult>)
      default:
        throw new BusinessException(ErrorEnum.BACKTEST_UNKNOWN_JOB)
    }
  }

  private async runBacktest(job: Job<BacktestingJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    const { runId } = job.data
    const jobId = job.id ?? 'unknown'

    const emitProgress = async (pct: number, step: string) => {
      await job.updateProgress(pct)
      this.eventsGateway.emitBacktestProgress(jobId, pct, step)
    }

    // Mark as RUNNING
    await this.prisma.backtestRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    })

    await emitProgress(5, 'loading-data')
    this.logger.log(`Starting backtest runId=${runId}`)

    // Load config from DB
    const config = await this.runService.loadConfig(runId)

    // Run engine
    const result = await this.engineService.runBacktest(config, async (pct, step) => {
      await emitProgress(pct, step)
    })

    // Save report and update status to COMPLETED
    await emitProgress(90, 'persisting-report')
    await this.reportService.saveReport(runId, result)

    const completedAt = new Date().toISOString()
    this.eventsGateway.emitBacktestCompleted(jobId, { runId, completedAt })
    this.logger.log(`Backtest completed runId=${runId}`)

    return { runId, completedAt }
  }

  private async runWalkForward(job: Job<WalkForwardJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    const { wfRunId } = job.data
    const jobId = job.id ?? 'unknown'

    const emitProgress = async (pct: number, step: string) => {
      await job.updateProgress(pct)
      this.eventsGateway.emitBacktestProgress(jobId, pct, step)
    }

    this.logger.log(`Starting WalkForward wfRunId=${wfRunId}`)

    try {
      await this.walkForwardService.runWalkForward(wfRunId, emitProgress)
    } catch (err) {
      await this.prisma.backtestWalkForwardRun.update({
        where: { id: wfRunId },
        data: { status: 'FAILED', failedReason: err instanceof Error ? err.message : String(err) },
      })
      throw err
    }

    const completedAt = new Date().toISOString()
    this.eventsGateway.emitBacktestCompleted(jobId, { runId: wfRunId, completedAt })
    this.logger.log(`WalkForward completed wfRunId=${wfRunId}`)

    return { runId: wfRunId, completedAt }
  }

  private async runComparison(job: Job<ComparisonJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    const { groupId } = job.data
    const jobId = job.id ?? 'unknown'

    const emitProgress = async (pct: number, step: string) => {
      await job.updateProgress(pct)
      this.eventsGateway.emitBacktestProgress(jobId, pct, step)
    }

    this.logger.log(`Starting Comparison groupId=${groupId}`)

    try {
      await this.comparisonService.runComparison(groupId, emitProgress)
    } catch (err) {
      await this.prisma.backtestComparisonGroup.update({
        where: { id: groupId },
        data: { status: 'FAILED' },
      })
      throw err
    }

    const completedAt = new Date().toISOString()
    this.eventsGateway.emitBacktestCompleted(jobId, { runId: groupId, completedAt })
    this.logger.log(`Comparison completed groupId=${groupId}`)

    return { runId: groupId, completedAt }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<BacktestingJobData | WalkForwardJobData | ComparisonJobData>, error: Error) {
    const jobId = job.id ?? 'unknown'
    const data = job.data as BacktestingJobData & WalkForwardJobData & ComparisonJobData
    this.logger.error(`Backtest job failed id=${jobId}: ${error.message}`, error.stack)

    try {
      switch (job.name) {
        case BacktestingJobName.RUN_BACKTEST:
          if (data?.runId) {
            await this.prisma.backtestRun.update({
              where: { id: data.runId },
              data: { status: 'FAILED', failedReason: error.message },
            })
          }
          break
        case BacktestingJobName.RUN_WALK_FORWARD:
          if (data?.wfRunId) {
            await this.prisma.backtestWalkForwardRun.update({
              where: { id: data.wfRunId },
              data: { status: 'FAILED', failedReason: error.message },
            })
          }
          break
        case BacktestingJobName.RUN_COMPARISON:
          if (data?.groupId) {
            await this.prisma.backtestComparisonGroup.update({
              where: { id: data.groupId },
              data: { status: 'FAILED' },
            })
          }
          break
      }
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : String(updateError)
      this.logger.error(`Failed to update job status for id=${jobId}: ${message}`)
    }

    this.eventsGateway.emitBacktestFailed(jobId, error.message)
  }
}
