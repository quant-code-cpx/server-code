import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { EVENT_STUDY_QUEUE, EventStudyJobName } from 'src/constant/queue.constant'
import { EventSignalService } from './event-signal.service'
import { EventSignalScanJobData, EventSignalScanJobResult } from './event-signal-scan.types'

@Processor(EVENT_STUDY_QUEUE)
export class EventSignalScanProcessor extends WorkerHost {
  private readonly logger = new Logger(EventSignalScanProcessor.name)

  constructor(private readonly eventSignalService: EventSignalService) {
    super()
  }

  async process(job: Job<EventSignalScanJobData, EventSignalScanJobResult>): Promise<EventSignalScanJobResult> {
    this.logger.log(`Processing event-study job [${job.name}] id=${job.id}`)

    switch (job.name) {
      case EventStudyJobName.SCAN_SIGNAL_RULES:
        return this.scanSignalRules(job)
      default:
        throw new Error(`Unknown event-study job name: ${job.name}`)
    }
  }

  private async scanSignalRules(
    job: Job<EventSignalScanJobData, EventSignalScanJobResult>,
  ): Promise<EventSignalScanJobResult> {
    await job.updateProgress(10)
    const result = await this.eventSignalService.scanAndGenerate(job.data.tradeDate)
    await job.updateProgress(100)

    return {
      tradeDate: job.data.tradeDate,
      signalsGenerated: result.signalsGenerated,
      completedAt: new Date().toISOString(),
    }
  }
}
