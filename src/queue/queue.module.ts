import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { BacktestingProcessor } from './backtesting/backtesting.processor'
import { BacktestingService } from './backtesting/backtesting.service'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { BacktestModule } from 'src/apps/backtest/backtest.module'

@Module({
  imports: [
    // ConfigModule 已是全局模块，无需在 forRootAsync 里重复引入
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const { host, port } = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
        const username = process.env.REDIS_USERNAME || undefined
        const password = process.env.REDIS_PASSWORD || undefined
        return { connection: { host, port, username, password } }
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: BACKTESTING_QUEUE }),
    WebsocketModule,
    BacktestModule,
  ],
  // BacktestingController (旧模板 /backtesting/submit) 已被 BacktestModule 的 /backtests 端点取代，不再挂载
  controllers: [],
  providers: [BacktestingProcessor, BacktestingService],
  exports: [BacktestingService],
})
export class QueueModule {}
