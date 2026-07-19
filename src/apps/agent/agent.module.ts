import { Module } from '@nestjs/common'
import { AgentAuditRepository } from './audit/agent-audit.repository'
import { CitationRepository } from './audit/citation.repository'
import { AgentConversationRepository } from './conversation/agent-conversation.repository'
import { AgentMessageRepository } from './conversation/agent-message.repository'

@Module({
  providers: [AgentConversationRepository, AgentMessageRepository, AgentAuditRepository, CitationRepository],
  exports: [AgentConversationRepository, AgentMessageRepository, AgentAuditRepository, CitationRepository],
})
export class AgentModule {}
