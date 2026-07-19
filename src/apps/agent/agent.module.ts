import { Module } from '@nestjs/common'
import { AgentConversationRepository } from './conversation/agent-conversation.repository'
import { AgentMessageRepository } from './conversation/agent-message.repository'

@Module({
  providers: [AgentConversationRepository, AgentMessageRepository],
  exports: [AgentConversationRepository, AgentMessageRepository],
})
export class AgentModule {}
