import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Job, UnrecoverableError } from 'bullmq'
import { NewsIngestionService } from 'src/apps/news/news-ingestion.service'
import { buildNewsConfig } from 'src/config/news.config'
import { NewsProviderError } from 'src/apps/news/providers/news-provider.errors'
import { NEWS_INGESTION_JOB, NEWS_INGESTION_QUEUE, type NewsIngestionJob } from './news-queue.constants'

const workerConfig = buildNewsConfig(process.env)

@Injectable()
@Processor(NEWS_INGESTION_QUEUE, {
  concurrency: workerConfig.queueConcurrency,
  lockDuration: 60_000,
  settings: { backoffStrategy: newsProviderBackoffStrategy },
})
export class NewsProcessor extends WorkerHost {
  constructor(private readonly ingestion: NewsIngestionService) {
    super()
  }

  async process(job: Job<NewsIngestionJob>): Promise<void> {
    if (job.name !== NEWS_INGESTION_JOB) throw new UnrecoverableError(`未知 News job: ${job.name}`)
    if (job.data?.schemaVersion !== 1 || !/^[a-z0-9]{20,32}$/.test(job.data.runId) || job.id !== job.data.runId) {
      throw new UnrecoverableError('News job payload 非法')
    }
    try {
      await this.ingestion.executeRun(job.data.runId)
    } catch (error) {
      if (error instanceof NewsProviderError && !error.retryable) throw new UnrecoverableError(error.message)
      throw error
    }
  }
}

export function newsProviderBackoffStrategy(attemptsMade: number, type?: string, error?: Error): number {
  if (type !== 'news-provider') return -1
  const retryAfterMs = error instanceof NewsProviderError ? error.retryAfterMs : undefined
  if (retryAfterMs != null) return Math.max(0, Math.min(retryAfterMs, 15 * 60_000))
  return [5_000, 30_000, 120_000][Math.max(0, Math.min(attemptsMade - 1, 2))]
}
