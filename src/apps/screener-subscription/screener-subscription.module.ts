import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE } from 'src/constant/queue.constant'
import { StockModule } from 'src/apps/stock/stock.module'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { ScreenerSubscriptionController } from './screener-subscription.controller'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import { ScreenerSubscriptionProcessor } from './screener-subscription.processor'
import { ScreenerSubscriptionScheduler } from './screener-subscription.scheduler'

@Module({
  imports: [BullModule.registerQueue({ name: SCREENER_SUBSCRIPTION_QUEUE }), StockModule, WebsocketModule],
  controllers: [ScreenerSubscriptionController],
  providers: [ScreenerSubscriptionService, ScreenerSubscriptionProcessor, ScreenerSubscriptionScheduler],
})
export class ScreenerSubscriptionModule {}
