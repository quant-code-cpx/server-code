import { Module } from '@nestjs/common'
import { AgentAuditRepository } from './audit/agent-audit.repository'
import { CitationRepository } from './audit/citation.repository'
import { AgentConversationRepository } from './conversation/agent-conversation.repository'
import { AgentMessageRepository } from './conversation/agent-message.repository'
import { ModelGatewayModule } from './model-gateway/model-gateway.module'

@Module({
  imports: [ModelGatewayModule],
  providers: [AgentConversationRepository, AgentMessageRepository, AgentAuditRepository, CitationRepository],
  exports: [
    ModelGatewayModule,
    AgentConversationRepository,
    AgentMessageRepository,
    AgentAuditRepository,
    CitationRepository,
  ],
})
export class AgentModule {}
