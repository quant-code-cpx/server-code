import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { BacktestingProcessor } from 'src/queue/backtesting/backtesting.processor'
import { WebsocketModule } from 'src/websocket/websocket.module'

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      },
    }),
    BullModule.registerQueue({ name: BACKTESTING_QUEUE }),
    BacktestModule,
    WebsocketModule,
  ],
  providers: [BacktestingProcessor],
})
export class LegacyBacktestWorkerModule {}
