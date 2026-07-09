import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { EVENT_STUDY_QUEUE } from 'src/constant/queue.constant'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { EventSignalScanProcessor } from './event-signal-scan.processor'
import { EventSignalScheduler } from './event-signal.scheduler'
import { EventSignalService } from './event-signal.service'
import { EventStudyController } from './event-study.controller'
import { EventStudyService } from './event-study.service'

@Module({
  imports: [
    BullModule.registerQueue({
      name: EVENT_STUDY_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    }),
    WebsocketModule,
  ],
  controllers: [EventStudyController],
  providers: [EventStudyService, EventSignalService, EventSignalScheduler, EventSignalScanProcessor],
  exports: [EventStudyService, EventSignalService],
})
export class EventStudyModule {}
