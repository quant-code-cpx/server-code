import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentEventRepository } from './agent-event.repository'
import { AgentRunCompletionRepository } from './agent-run-completion.repository'
import { AgentRunRepository } from './agent-run.repository'
import { AgentStateMachineService } from './agent-state-machine.service'

@Module({
  imports: [ConfigModule.forFeature(AgentExecutionConfig)],
  providers: [AgentStateMachineService, AgentEventRepository, AgentRunRepository, AgentRunCompletionRepository],
  exports: [AgentStateMachineService, AgentEventRepository, AgentRunRepository, AgentRunCompletionRepository],
})
export class AgentExecutionModule {}
