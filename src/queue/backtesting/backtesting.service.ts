import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { BACKTESTING_QUEUE, BacktestingJobName } from 'src/constant/queue.constant'
import { BacktestingJobData } from './backtesting.interface'
import { SubmitBacktestingDto } from './dto/submit-backtesting.dto'

@Injectable()
export class BacktestingService {
  private readonly logger = new Logger(BacktestingService.name)

  constructor(
    @InjectQueue(BACKTESTING_QUEUE)
    private readonly backtestingQueue: Queue<BacktestingJobData>,
  ) {}

  async submit(dto: SubmitBacktestingDto, userId: number) {
    const job = await this.backtestingQueue.add(
      BacktestingJobName.RUN_BACKTEST,
      {
        runId: dto.strategyId, // legacy: use strategyId as runId placeholder
        userId,
      },
      {
        attempts: 3, // 失败重试 3 次
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    )

    this.logger.log(`Submitted backtest job id=${job.id} strategyId=${dto.strategyId}`)
    return { jobId: job.id, strategyId: dto.strategyId, status: 'queued' }
  }

  async getJobStatus(jobId: string) {
    const job = await this.backtestingQueue.getJob(jobId)
    if (!job) return { jobId, status: 'not_found' }

    const state = await job.getState()
    const progress = job.progress

    return {
      jobId,
      state,
      progress,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    }
  }
}
