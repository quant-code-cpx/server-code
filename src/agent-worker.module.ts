import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import configs from './config'
import { AgentQueueModule } from './queue/agent/agent-queue.module'
import { MetricsModule } from './shared/metrics/metrics.module'
import { SharedModule } from './shared/shared.module'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from './config/redis.config'

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: ['.env'], isGlobal: true, load: [...Object.values(configs)] }),
    SharedModule,
    MetricsModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
        if (!redis) throw new Error('[Worker] Redis 配置缺失')
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            username: process.env.REDIS_USERNAME || undefined,
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
          },
        }
      },
    }),
    AgentQueueModule.register({ workerEnabled: true }),
  ],
})
export class AgentWorkerModule {}
