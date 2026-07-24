import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentObservabilityConfig } from 'src/config/agent-observability.config'
import { AgentCostService } from './agent-cost.service'
import { AgentMetricsService } from './agent-metrics.service'
import { AgentTracingService } from './agent-tracing.service'

@Global()
@Module({
  imports: [ConfigModule.forFeature(AgentObservabilityConfig)],
  providers: [AgentMetricsService, AgentCostService, AgentTracingService],
  exports: [AgentMetricsService, AgentCostService, AgentTracingService],
})
export class AgentObservabilityModule {}
