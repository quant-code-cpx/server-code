import { DynamicModule, Module, Provider } from '@nestjs/common'
import { AgentModule } from 'src/apps/agent/agent.module'
import { NotificationModule } from 'src/apps/notification/notification.module'
import { ResearchReportModule } from 'src/apps/agent/research/research-report.module'
import { AgentNotificationProcessor } from './agent-notification.processor'
import { AgentNotificationQueueService } from './agent-notification-queue.service'
import { AgentNotificationReconcilerService } from './agent-notification-reconciler.service'
import { AgentProcessor } from './agent.processor'
import { AgentReconcilerService } from './agent-reconciler.service'
import { AgentQueueProducerModule } from './agent-queue-producer.module'
import { AgentResearchReportProcessor } from './agent-research-report.processor'
import { AgentResearchReportReconcilerService } from './agent-research-report-reconciler.service'

export { buildAgentRedisConnection } from './agent-queue-producer.module'

export interface AgentQueueModuleOptions {
  workerEnabled: boolean
}

@Module({})
export class AgentQueueModule {
  static register(options: AgentQueueModuleOptions): DynamicModule {
    const workerProviders: Provider[] = options.workerEnabled
      ? [
          AgentProcessor,
          AgentReconcilerService,
          AgentNotificationProcessor,
          AgentNotificationReconcilerService,
          AgentResearchReportProcessor,
          AgentResearchReportReconcilerService,
        ]
      : []
    return {
      module: AgentQueueModule,
      imports: [AgentQueueProducerModule, AgentModule, NotificationModule, ResearchReportModule],
      providers: [AgentNotificationQueueService, ...workerProviders],
      exports: [AgentQueueProducerModule],
    }
  }
}
