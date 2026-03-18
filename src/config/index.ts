import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
}

export default configs
