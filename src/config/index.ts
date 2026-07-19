import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'
import { TushareConfig, ITushareConfig } from './tushare.config'
import { ModelConfig, IModelConfig } from './model.config'
import { AgentExecutionConfig, IAgentExecutionConfig } from './agent-execution.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'
export * from './tushare.config'
export * from './model.config'
export * from './agent-execution.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
  tushare: ITushareConfig
  agentModel: IModelConfig
  agentExecution: IAgentExecutionConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
  TushareConfig,
  ModelConfig,
  AgentExecutionConfig,
}

export default configs
