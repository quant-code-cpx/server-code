import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'
import { TushareConfig, ITushareConfig } from './tushare.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'
export * from './tushare.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
  tushare: ITushareConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
  TushareConfig,
}

export default configs
