import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'
import { TushareConfig, ITushareConfig } from './tushare.config'
import { ModelConfig, IModelConfig } from './model.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'
export * from './tushare.config'
export * from './model.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
  tushare: ITushareConfig
  agentModel: IModelConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
  TushareConfig,
  ModelConfig,
}

export default configs
