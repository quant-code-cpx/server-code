import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import { AgentAuditRepository } from './audit/agent-audit.repository'
import { CitationRepository } from './audit/citation.repository'
import { AgentConversationRepository } from './conversation/agent-conversation.repository'
import { AgentMessageRepository } from './conversation/agent-message.repository'
import { AgentExecutionModule } from './execution/agent-execution.module'
import { ModelGatewayModule } from './model-gateway/model-gateway.module'
import { AGENT_TOOL_DEFINITIONS, ToolRegistryService } from './tools/tool-registry.service'
import { TOOL_EXECUTION_OBSERVER } from './tools/contracts/tool-observer'
import { ToolExecutorService } from './tools/tool-executor.service'
import { ToolPolicyService } from './tools/tool-policy.service'
import { ToolRunLimiterService } from './tools/tool-run-limiter.service'
import { ToolSchemaValidator } from './tools/tool-schema-validator'

@Module({
  imports: [ConfigModule.forFeature(AgentToolsConfig), ModelGatewayModule, AgentExecutionModule],
  providers: [
    AgentConversationRepository,
    AgentMessageRepository,
    AgentAuditRepository,
    CitationRepository,
    ToolSchemaValidator,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
    { provide: AGENT_TOOL_DEFINITIONS, useValue: Object.freeze([]) },
    { provide: TOOL_EXECUTION_OBSERVER, useValue: Object.freeze({}) },
  ],
  exports: [
    ModelGatewayModule,
    AgentExecutionModule,
    AgentConversationRepository,
    AgentMessageRepository,
    AgentAuditRepository,
    CitationRepository,
    ToolRegistryService,
    ToolPolicyService,
    ToolRunLimiterService,
    ToolExecutorService,
  ],
})
export class AgentModule {}
