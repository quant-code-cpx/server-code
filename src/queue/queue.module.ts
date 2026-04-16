import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { BacktestingProcessor } from './backtesting/backtesting.processor'
import { QueueMetricsService } from './queue-metrics.service'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { BacktestModule } from 'src/apps/backtest/backtest.module'

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const { host, port } = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
        const username = process.env.REDIS_USERNAME || undefined
        const password = process.env.REDIS_PASSWORD || undefined
        return { connection: { host, port, username, password } }
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: BACKTESTING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: false, // 保留失败任务供审查（DLQ 语义）
      },
    }),
    WebsocketModule,
    BacktestModule,
  ],
  controllers: [],
  providers: [BacktestingProcessor, QueueMetricsService],
  exports: [],
})
export class QueueModule {}
