import { Module } from '@nestjs/common'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'

@Module({
  imports: [WebsocketModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
