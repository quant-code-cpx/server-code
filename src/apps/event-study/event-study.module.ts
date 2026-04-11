import { Module } from '@nestjs/common'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { EventSignalScheduler } from './event-signal.scheduler'
import { EventSignalService } from './event-signal.service'
import { EventStudyController } from './event-study.controller'
import { EventStudyService } from './event-study.service'

@Module({
  imports: [WebsocketModule],
  controllers: [EventStudyController],
  providers: [EventStudyService, EventSignalService, EventSignalScheduler],
  exports: [EventStudyService, EventSignalService],
})
export class EventStudyModule {}
