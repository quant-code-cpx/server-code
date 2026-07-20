import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'
import { TushareConfig, ITushareConfig } from './tushare.config'
import { ModelConfig, IModelConfig } from './model.config'
import { AgentExecutionConfig, IAgentExecutionConfig } from './agent-execution.config'
import { AgentToolsConfig, IAgentToolsConfig } from './agent-tools.config'
import { WebSearchConfig, IWebSearchConfig } from './web-search.config'
import { AgentQueueConfig, IAgentQueueConfig } from './agent-queue.config'
import { ProcessRoleConfig, IProcessRoleConfig } from './process-role.config'
import { AgentApiConfig, IAgentApiConfig } from './agent-api.config'
import { AgentStreamConfig, IAgentStreamConfig } from './agent-stream.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'
export * from './tushare.config'
export * from './model.config'
export * from './agent-execution.config'
export * from './agent-tools.config'
export * from './web-search.config'
export * from './agent-queue.config'
export * from './process-role.config'
export * from './agent-api.config'
export * from './agent-stream.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
  tushare: ITushareConfig
  agentModel: IModelConfig
  agentExecution: IAgentExecutionConfig
  agentTools: IAgentToolsConfig
  webSearch: IWebSearchConfig
  agentQueue: IAgentQueueConfig
  processRole: IProcessRoleConfig
  agentApi: IAgentApiConfig
  agentStream: IAgentStreamConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
  TushareConfig,
  ModelConfig,
  AgentExecutionConfig,
  AgentToolsConfig,
  WebSearchConfig,
  AgentQueueConfig,
  ProcessRoleConfig,
  AgentApiConfig,
  AgentStreamConfig,
}

export default configs
