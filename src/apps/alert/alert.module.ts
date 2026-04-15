import { Module } from '@nestjs/common'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { NotificationModule } from 'src/apps/notification/notification.module'
import { AlertController } from './alert.controller'
import { AlertCalendarService } from './alert-calendar.service'
import { PriceAlertService } from './price-alert.service'
import { MarketAnomalyService } from './market-anomaly.service'

@Module({
  imports: [WebsocketModule, NotificationModule],
  controllers: [AlertController],
  providers: [AlertCalendarService, PriceAlertService, MarketAnomalyService],
})
export class AlertModule {}
