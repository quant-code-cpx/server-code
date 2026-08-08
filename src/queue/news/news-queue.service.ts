import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { NewsIngestionOperation, NewsIngestionRunStatus, NewsIngestionTrigger, Prisma } from '@prisma/client'
import { Queue } from 'bullmq'
import { PrismaService } from 'src/shared/prisma.service'
import { NEWS_INGESTION_JOB, NEWS_INGESTION_QUEUE, type NewsIngestionJob } from './news-queue.constants'

@Injectable()
export class NewsQueueService {
  constructor(
    @InjectQueue(NEWS_INGESTION_QUEUE) private readonly queue: Queue<NewsIngestionJob>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(runId: string): Promise<void> {
    const existing = await this.queue.getJob(runId)
    if (existing) {
      const state = await existing.getState()
      if (!['completed', 'failed', 'unknown'].includes(state)) return
      await existing.remove()
    }
    await this.queue.add(NEWS_INGESTION_JOB, { schemaVersion: 1, runId }, { jobId: runId })
  }

  async enqueueMany(runIds: readonly string[]): Promise<void> {
    for (const runId of runIds) await this.enqueue(runId)
  }

  async ensureScheduledRun(input: {
    providerKey: string
    feedKey: string
    partitionKey: string
    bucket: string
  }): Promise<string> {
    const idempotencyKey = `scheduled:${input.providerKey}:${input.feedKey}:${input.partitionKey}:${input.bucket}`
    const run = await this.prisma.newsIngestionRun.upsert({
      where: { idempotencyKey },
      create: {
        idempotencyKey,
        operation: NewsIngestionOperation.POLL_FEED,
        providerKey: input.providerKey,
        feedKey: input.feedKey,
        partitionKey: input.partitionKey,
        trigger: NewsIngestionTrigger.SCHEDULED,
        status: NewsIngestionRunStatus.QUEUED,
      },
      update: {},
      select: { id: true, status: true },
    })
    if (
      new Set<NewsIngestionRunStatus>([NewsIngestionRunStatus.QUEUED, NewsIngestionRunStatus.FAILED]).has(run.status)
    ) {
      await this.enqueue(run.id)
    }
    return run.id
  }

  async queueStats(): Promise<Record<string, number>> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
    return counts as Record<string, number>
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
