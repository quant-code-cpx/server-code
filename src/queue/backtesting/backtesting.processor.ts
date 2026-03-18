import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { BacktestingJobData, BacktestingJobResult } from './backtesting.interface'
import { EventsGateway } from 'src/websocket/events.gateway'

@Processor(BACKTESTING_QUEUE)
export class BacktestingProcessor extends WorkerHost {
  private readonly logger = new Logger(BacktestingProcessor.name)

  constructor(private readonly eventsGateway: EventsGateway) {
    super()
  }

  async process(job: Job<BacktestingJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    this.logger.log(`Processing job [${job.name}] id=${job.id} strategyId=${job.data.strategyId}`)

    switch (job.name) {
      case BacktestingJobName.RUN_BACKTEST:
        return this.runBacktest(job)
      default:
        throw new Error(`Unknown job name: ${job.name}`)
    }
  }

  private async runBacktest(job: Job<BacktestingJobData, BacktestingJobResult>): Promise<BacktestingJobResult> {
    const { strategyId, startDate, endDate, initialCapital } = job.data
    const jobId = job.id!

    const emitProgress = async (pct: number) => {
      await job.updateProgress(pct)
      this.eventsGateway.emitBacktestProgress(jobId, pct, 'active')
    }

    await emitProgress(10)
    this.logger.log(`Running backtest strategy=${strategyId} [${startDate} ~ ${endDate}] capital=${initialCapital}`)

    // TODO: 接入真实回测引擎
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await emitProgress(100)

    const result: BacktestingJobResult = {
      strategyId,
      totalReturn: 0.25,
      annualizedReturn: 0.18,
      maxDrawdown: -0.12,
      sharpeRatio: 1.45,
      tradeCount: 120,
      completedAt: new Date().toISOString(),
    }

    this.eventsGateway.emitBacktestCompleted(jobId, result)
    this.logger.log(`Backtest completed strategy=${strategyId}`)
    return result
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BacktestingJobData>, error: Error) {
    const jobId = job.id!
    this.logger.error(`Backtest job failed id=${jobId}: ${error.message}`, error.stack)
    this.eventsGateway.emitBacktestFailed(jobId, error.message)
  }
}
