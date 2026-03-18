import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { BacktestingProcessor } from './backtesting/backtesting.processor'
import { BacktestingService } from './backtesting/backtesting.service'
import { BacktestingController } from './backtesting/backtesting.controller'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { WebsocketModule } from 'src/websocket/websocket.module'

@Module({
  imports: [
    // ConfigModule 已是全局模块，无需在 forRootAsync 里重复引入
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const { host, port } = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
        return { connection: { host, port } }
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: BACKTESTING_QUEUE }),
    WebsocketModule,
  ],
  controllers: [BacktestingController],
  providers: [BacktestingProcessor, BacktestingService],
  exports: [BacktestingService],
})
export class QueueModule {}
