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
import { PrismaService } from 'src/shared/prisma.service'

@Processor(BACKTESTING_QUEUE)
export class BacktestingProcessor extends WorkerHost {
  private readonly logger = new Logger(BacktestingProcessor.name)

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly engineService: BacktestEngineService,
    private readonly runService: BacktestRunService,
    private readonly reportService: BacktestReportService,
    private readonly prisma: PrismaService,
  ) {
    super()
  }

  async process(job: Job<BacktestingJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    this.logger.log(`Processing job [${job.name}] id=${job.id} runId=${job.data.runId}`)

    switch (job.name) {
      case BacktestingJobName.RUN_BACKTEST:
        return this.runBacktest(job)
      default:
        throw new BusinessException(ErrorEnum.BACKTEST_UNKNOWN_JOB)
    }
  }

  private async runBacktest(job: Job<BacktestingJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    const { runId } = job.data
    const jobId = job.id!

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

  @OnWorkerEvent('failed')
  async onFailed(job: Job<BacktestingJobData>, error: Error) {
    const jobId = job.id!
    const runId = job.data?.runId
    this.logger.error(`Backtest job failed id=${jobId} runId=${runId}: ${error.message}`, error.stack)

    if (runId) {
      try {
        await this.prisma.backtestRun.update({
          where: { id: runId },
          data: { status: 'FAILED', failedReason: error.message },
        })
      } catch (updateError) {
        const message = updateError instanceof Error ? updateError.message : String(updateError)
        this.logger.error(`Failed to update run status for runId=${runId}: ${message}`)
      }
    }

    this.eventsGateway.emitBacktestFailed(jobId, error.message)
  }
}
