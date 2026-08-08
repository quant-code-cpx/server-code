import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { buildProcessRoleConfig } from 'src/config/process-role.config'
import { NewsProcessor } from 'src/queue/news/news.processor'
import { NEWS_INGESTION_QUEUE } from 'src/queue/news/news-queue.constants'
import { NewsQueueService } from 'src/queue/news/news-queue.service'
import { NewsScheduler } from 'src/queue/news/news.scheduler'
import { NEWS_CLOCK, NEWS_FEED_PROVIDERS, NEWS_HTTP_TRANSPORT, type NewsClock } from './domain/news.types'
import { NewsAdminController } from './news-admin.controller'
import { NewsAdminService } from './news-admin.service'
import { NewsCircuitBreakerService } from './news-circuit-breaker.service'
import { NewsController } from './news.controller'
import { NewsCoverageService } from './news-coverage.service'
import { NewsIngestionService } from './news-ingestion.service'
import { NEWS_HIGHLIGHTS_COVERAGE, NewsHighlightsService } from './news-highlights.service'
import { NewsQueryService } from './news-query.service'
import { NewsRepository } from './news.repository'
import { NewsStrictBodyGuard } from './news-strict-body.guard'
import { MarketNewsToolFacade } from './market-news-tool.facade'
import { AkshareNewsProvider } from './providers/akshare-news.provider'
import { DefaultNewsHttpTransport } from './providers/default-news-http.transport'
import { GdeltNewsProvider } from './providers/gdelt-news.provider'
import { NewsProviderRegistry } from './providers/news-provider.registry'

const processRole = buildProcessRoleConfig(process.env)

@Module({
  imports: [
    BullModule.registerQueue({
      name: NEWS_INGESTION_QUEUE,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'news-provider' },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    }),
  ],
  controllers: [NewsController, NewsAdminController],
  providers: [
    NewsRepository,
    NewsQueryService,
    NewsCoverageService,
    NewsIngestionService,
    NewsHighlightsService,
    { provide: NEWS_HIGHLIGHTS_COVERAGE, useExisting: NewsCoverageService },
    NewsAdminService,
    MarketNewsToolFacade,
    NewsCircuitBreakerService,
    NewsStrictBodyGuard,
    NewsQueueService,
    NewsProviderRegistry,
    DefaultNewsHttpTransport,
    AkshareNewsProvider,
    GdeltNewsProvider,
    { provide: NEWS_CLOCK, useValue: { now: () => new Date() } satisfies NewsClock },
    { provide: NEWS_HTTP_TRANSPORT, useExisting: DefaultNewsHttpTransport },
    {
      provide: NEWS_FEED_PROVIDERS,
      useFactory: (akshare: AkshareNewsProvider, gdelt: GdeltNewsProvider) => [akshare, gdelt],
      inject: [AkshareNewsProvider, GdeltNewsProvider],
    },
    ...(processRole.queueWorkerEnabled ? [NewsProcessor] : []),
    ...(processRole.schedulerEnabled ? [NewsScheduler] : []),
  ],
  exports: [NewsQueryService, NewsCoverageService, NewsHighlightsService, NewsAdminService, MarketNewsToolFacade],
})
export class NewsModule {}
