import { Module } from '@nestjs/common'
import { AgentAuditRepository } from './agent-audit.repository'
import { CitationRepository } from './citation.repository'

@Module({
  providers: [AgentAuditRepository, CitationRepository],
  exports: [AgentAuditRepository, CitationRepository],
})
export class AgentAuditModule {}
