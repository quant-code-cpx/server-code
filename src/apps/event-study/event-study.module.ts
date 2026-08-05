import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { EVENT_STUDY_QUEUE } from 'src/constant/queue.constant'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { EventSignalScanProcessor } from './event-signal-scan.processor'
import { EventSignalScheduler } from './event-signal.scheduler'
import { EventSignalService } from './event-signal.service'
import { EventStudyController } from './event-study.controller'
import { EventStudyService } from './event-study.service'
import { EventStudyToolFacade } from './event-study-tool.facade'
import { EventStudyToolRepository } from './event-study-tool.repository'
import { buildProcessRoleConfig } from 'src/config/process-role.config'

const processRole = buildProcessRoleConfig(process.env)

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
  providers: [
    EventStudyService,
    EventStudyToolRepository,
    EventStudyToolFacade,
    EventSignalService,
    EventSignalScheduler,
    ...(processRole.queueWorkerEnabled ? [EventSignalScanProcessor] : []),
  ],
  exports: [EventStudyService, EventSignalService, EventStudyToolFacade],
})
export class EventStudyModule {}
