import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ResearchNoteModule } from 'src/apps/research-note/research-note.module'
import { AgentReportConfig } from 'src/config/agent-report.config'
import { AgentQueueProducerModule } from 'src/queue/agent/agent-queue-producer.module'
import { ResearchReportController } from './research-report.controller'
import { LocalResearchReportStorage } from './local-storage.adapter'
import { ResearchReportService } from './research-report.service'
import { AGENT_REPORT_STORAGE } from './storage.port'

@Module({
  imports: [ConfigModule.forFeature(AgentReportConfig), AgentQueueProducerModule, ResearchNoteModule],
  controllers: [ResearchReportController],
  providers: [
    LocalResearchReportStorage,
    { provide: AGENT_REPORT_STORAGE, useExisting: LocalResearchReportStorage },
    ResearchReportService,
  ],
  exports: [ResearchReportService],
})
export class ResearchReportModule {}
