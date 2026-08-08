import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import configs from './config'
import { EventStudyModule } from './apps/event-study/event-study.module'
import { ScreenerSubscriptionModule } from './apps/screener-subscription/screener-subscription.module'
import { QueueModule } from './queue/queue.module'
import { MetricsModule } from './shared/metrics/metrics.module'
import { SharedModule } from './shared/shared.module'
import { NewsModule } from './apps/news/news.module'
import { WorkerReadinessModule } from './shared/health/worker-readiness.module'

/** Hosts non-Agent BullMQ processors without exposing an HTTP listener. */
@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: ['.env'], isGlobal: true, load: [...Object.values(configs)] }),
    SharedModule,
    WorkerReadinessModule,
    MetricsModule,
    QueueModule,
    EventStudyModule,
    ScreenerSubscriptionModule,
    NewsModule,
  ],
})
export class QueueWorkerModule {}
