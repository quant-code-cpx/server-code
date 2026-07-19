import { DynamicModule, Module, Provider } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ConfigModule, ConfigService } from '@nestjs/config'
import type { ConnectionOptions } from 'bullmq'
import { AgentModule } from 'src/apps/agent/agent.module'
import {
  AGENT_QUEUE_CONFIG_TOKEN,
  AgentQueueConfig,
  buildAgentQueueConfig,
  type IAgentQueueConfig,
} from 'src/config/agent-queue.config'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { AgentProcessor } from './agent.processor'
import { AgentQueueMetricsService } from './agent-queue-metrics.service'
import { AgentQueueService } from './agent-queue.service'
import { AgentReconcilerService } from './agent-reconciler.service'
import { AGENT_BULL_CONFIG_KEY, AGENT_EXECUTION_QUEUE } from './agent.queue.constants'

export interface AgentQueueModuleOptions {
  workerEnabled: boolean
}

const queueOptions = buildAgentQueueConfig(process.env)

@Module({})
export class AgentQueueModule {
  static register(options: AgentQueueModuleOptions): DynamicModule {
    const workerProviders: Provider[] = options.workerEnabled ? [AgentProcessor, AgentReconcilerService] : []
    return {
      module: AgentQueueModule,
      imports: [
        ConfigModule.forFeature(AgentQueueConfig),
        BullModule.forRootAsync(AGENT_BULL_CONFIG_KEY, {
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => {
            const agent = configService.get<IAgentQueueConfig>(AGENT_QUEUE_CONFIG_TOKEN)
            const redis = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
            if (!agent || !redis) throw new Error('[AgentQueue] Redis 或 Agent queue 配置缺失')
            return { connection: buildAgentRedisConnection(agent, redis), prefix: agent.prefix }
          },
        }),
        BullModule.registerQueue({
          configKey: AGENT_BULL_CONFIG_KEY,
          name: AGENT_EXECUTION_QUEUE,
          defaultJobOptions: {
            attempts: queueOptions.jobAttempts,
            backoff: { type: 'exponential', delay: queueOptions.jobBackoffMs },
            removeOnComplete: { count: 200 },
            removeOnFail: { count: 500 },
          },
        }),
        AgentModule,
      ],
      providers: [AgentQueueService, AgentQueueMetricsService, ...workerProviders],
      exports: [AgentQueueService],
    }
  }
}

export function buildAgentRedisConnection(agent: IAgentQueueConfig, redis: IRedisConfig): ConnectionOptions {
  if (!agent.redisUrl) {
    return {
      host: redis.host,
      port: redis.port,
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
    }
  }
  const url = new URL(agent.redisUrl)
  const dbText = url.pathname.replace(/^\//, '')
  const db = dbText ? Number.parseInt(dbText, 10) : 0
  if (!Number.isInteger(db) || db < 0) throw new Error('[AgentQueue] AGENT_QUEUE_REDIS_URL DB 编号非法')
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  }
}
