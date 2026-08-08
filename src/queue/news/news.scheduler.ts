import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Cron, Interval } from '@nestjs/schedule'
import { NewsIngestionService } from 'src/apps/news/news-ingestion.service'
import { NewsProviderRegistry } from 'src/apps/news/providers/news-provider.registry'
import { AKSHARE_FEEDS } from 'src/apps/news/providers/akshare-news.provider'
import { NewsQueueService } from './news-queue.service'

@Injectable()
export class NewsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NewsScheduler.name)
  private running = false

  constructor(
    private readonly registry: NewsProviderRegistry,
    private readonly queue: NewsQueueService,
    private readonly ingestion: NewsIngestionService,
  ) {}

  onApplicationBootstrap(): void {
    void this.scheduleDueFeeds()
  }

  @Interval('news-ingestion-scheduler', 30_000)
  async scheduleDueFeeds(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = new Date()
      for (const capability of this.registry.scheduledCapabilities()) {
        const intervalMs = (capability.expectedIntervalSeconds ?? 300) * 1_000
        const bucket = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString()
        await this.queue.ensureScheduledRun({
          providerKey: capability.providerKey,
          feedKey: capability.feedKey,
          partitionKey: partitionFor(capability.feedKey, now),
          bucket,
        })
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error))
    } finally {
      this.running = false
    }
  }

  @Cron('0 30 3 * * *', { name: 'news-retention-cleanup', timeZone: 'Asia/Shanghai' })
  async cleanup(): Promise<void> {
    await this.ingestion.cleanup()
  }
}

function partitionFor(feedKey: string, now: Date): string {
  if (feedKey === AKSHARE_FEEDS.NOTICE_TODAY) return shanghaiDate(now)
  if (feedKey === AKSHARE_FEEDS.NOTICE_PREVIOUS) return shanghaiDate(new Date(now.getTime() - 86_400_000))
  return 'default'
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(value)
    .replace(/-/g, '')
}
