import { DynamicModule, Module, Provider } from '@nestjs/common'
import { AgentModule } from 'src/apps/agent/agent.module'
import { AgentProcessor } from './agent.processor'
import { AgentReconcilerService } from './agent-reconciler.service'
import { AgentQueueProducerModule } from './agent-queue-producer.module'

export { buildAgentRedisConnection } from './agent-queue-producer.module'

export interface AgentQueueModuleOptions {
  workerEnabled: boolean
}

@Module({})
export class AgentQueueModule {
  static register(options: AgentQueueModuleOptions): DynamicModule {
    const workerProviders: Provider[] = options.workerEnabled ? [AgentProcessor, AgentReconcilerService] : []
    return {
      module: AgentQueueModule,
      imports: [AgentQueueProducerModule, AgentModule],
      providers: [...workerProviders],
      exports: [AgentQueueProducerModule],
    }
  }
}
