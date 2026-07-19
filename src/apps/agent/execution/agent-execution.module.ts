import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentEventRepository } from './agent-event.repository'
import { AgentRunRepository } from './agent-run.repository'
import { AgentStateMachineService } from './agent-state-machine.service'

@Module({
  imports: [ConfigModule.forFeature(AgentExecutionConfig)],
  providers: [AgentStateMachineService, AgentEventRepository, AgentRunRepository],
  exports: [AgentStateMachineService, AgentEventRepository, AgentRunRepository],
})
export class AgentExecutionModule {}
