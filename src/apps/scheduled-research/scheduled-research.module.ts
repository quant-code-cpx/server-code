import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentModule } from 'src/apps/agent/agent.module'
import { AgentSchedulerConfig } from 'src/config/agent-scheduler.config'
import { ProcessRoleConfig } from 'src/config/process-role.config'
import { ScheduledResearchController } from './scheduled-research.controller'
import { ScheduledResearchRepository } from './scheduled-research.repository'
import { ScheduledResearchScheduler } from './scheduled-research.scheduler'
import { ScheduledResearchService } from './scheduled-research.service'

@Module({
  imports: [ConfigModule.forFeature(AgentSchedulerConfig), ConfigModule.forFeature(ProcessRoleConfig), AgentModule],
  controllers: [ScheduledResearchController],
  providers: [ScheduledResearchRepository, ScheduledResearchService, ScheduledResearchScheduler],
})
export class ScheduledResearchModule {}
